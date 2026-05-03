import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createTimeoutSignal,
	ensureDirectory,
	ensureRegularFile,
	isSecretLookingPath,
	looksBinary,
	resolveAllowedPath,
	throwIfAborted,
	truncateText,
	type PiMcpDenyReason,
	type PiMcpPolicyConfig,
} from "./pi-mcp-policy.ts";

export interface PiMcpToolResult {
	ok: boolean;
	content: string;
	metadata: Record<string, string | number | boolean>;
}

interface SearchMatch {
	path: string;
	line: number;
	text: string;
}

const TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });

function denied(reason: PiMcpDenyReason): PiMcpToolResult {
	return {
		ok: false,
		content: `Denied by Pi MCP policy: ${reason}`,
		metadata: { reason },
	};
}

function failed(reason: string): PiMcpToolResult {
	return {
		ok: false,
		content: `Pi MCP bridge failed: ${reason}`,
		metadata: { reason },
	};
}

async function withTimeout<T>(config: PiMcpPolicyConfig, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
	const timeout = createTimeoutSignal(config.toolTimeoutMs);
	try {
		return await operation(timeout.signal);
	} finally {
		timeout.cleanup();
	}
}

export async function readTextFile(config: PiMcpPolicyConfig, requestedPath: string): Promise<PiMcpToolResult> {
	try {
		return await withTimeout(config, async (signal) => {
			const path = await resolveAllowedPath(config, requestedPath);
			if (!path.allowed) return denied(path.reason);
			const file = await ensureRegularFile(path.value, config.maxFileBytes);
			if (!file.allowed) return denied(file.reason);

			const buffer = await readFile(file.value.realPath, { signal });
			throwIfAborted(signal);
			if (looksBinary(buffer)) return denied("binary");

			const decoded = TEXT_DECODER.decode(buffer);
			const truncated = truncateText(decoded, config.maxReturnedChars);
			return {
				ok: true,
				content: truncated.text,
				metadata: {
					path: file.value.relativePath,
					bytes: buffer.byteLength,
					chars: decoded.length,
					truncated: truncated.truncated,
				},
			};
		});
	} catch (error) {
		return failed(isAbortError(error) ? "timeout" : "read_error");
	}
}

export async function listFiles(config: PiMcpPolicyConfig, requestedPath: string): Promise<PiMcpToolResult> {
	try {
		return await withTimeout(config, async (signal) => {
			const path = await resolveAllowedPath(config, requestedPath || ".");
			if (!path.allowed) return denied(path.reason);
			const directory = await ensureDirectory(path.value);
			if (!directory.allowed) return denied(directory.reason);

			const entries = await readdir(directory.value.realPath, { withFileTypes: true });
			throwIfAborted(signal);
			const visibleEntries = entries.filter((entry) => !isSecretLookingPath(entry.name));
			const limited = visibleEntries.slice(0, config.maxListEntries);
			const lines = limited.map((entry) => `${entry.isDirectory() ? "dir" : "file"}\t${entry.name}`);
			return {
				ok: true,
				content: lines.join("\n"),
				metadata: {
					path: directory.value.relativePath,
					entries: visibleEntries.length,
					returned: limited.length,
					truncated: visibleEntries.length > limited.length,
				},
			};
		});
	} catch {
		return failed("list_error");
	}
}

export async function searchText(config: PiMcpPolicyConfig, requestedPath: string, query: string): Promise<PiMcpToolResult> {
	if (!query.trim() || query.length > 200) return denied("invalid_query");

	try {
		return await withTimeout(config, async (signal) => {
			const path = await resolveAllowedPath(config, requestedPath || ".");
			if (!path.allowed) return denied(path.reason);
			const matches: SearchMatch[] = [];

			await searchPath(config, path.value.realPath, path.value.root, query, matches, signal);
			const limited = matches.slice(0, config.maxSearchMatches);
			return {
				ok: true,
				content: limited.map((match) => `${match.path}:${match.line}: ${match.text}`).join("\n"),
				metadata: {
					matches: matches.length,
					returned: limited.length,
					truncated: matches.length > limited.length,
				},
			};
		});
	} catch (error) {
		return failed(isAbortError(error) ? "timeout" : "search_error");
	}
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

async function searchPath(
	config: PiMcpPolicyConfig,
	absolutePath: string,
	root: string,
	query: string,
	matches: SearchMatch[],
	signal: AbortSignal,
): Promise<void> {
	throwIfAborted(signal);
	if (matches.length >= config.maxSearchMatches) return;

	const entries = await readdir(absolutePath, { withFileTypes: true }).catch(() => undefined);
	if (!entries) {
		await searchFile(config, absolutePath, root, query, matches, signal);
		return;
	}

	for (const entry of entries) {
		throwIfAborted(signal);
		if (matches.length >= config.maxSearchMatches) return;
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const childPath = join(absolutePath, entry.name);
		if (entry.isDirectory()) {
			await searchPath(config, childPath, root, query, matches, signal);
		} else if (entry.isFile()) {
			await searchFile(config, childPath, root, query, matches, signal);
		}
	}
}

async function searchFile(
	config: PiMcpPolicyConfig,
	absolutePath: string,
	root: string,
	query: string,
	matches: SearchMatch[],
	signal: AbortSignal,
): Promise<void> {
	const relativePath = absolutePath.startsWith(`${root}/`) ? absolutePath.slice(root.length + 1) : absolutePath;
	const policyPath = await resolveAllowedPath(config, relativePath);
	if (!policyPath.allowed) return;
	const file = await ensureRegularFile(policyPath.value, config.maxFileBytes);
	if (!file.allowed) return;

	const buffer = await readFile(file.value.realPath, { signal }).catch(() => undefined);
	if (!buffer || looksBinary(buffer)) return;
	const lines = TEXT_DECODER.decode(buffer).split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		if (matches.length >= config.maxSearchMatches) return;
		if (lines[index]?.includes(query)) {
			matches.push({ path: file.value.relativePath, line: index + 1, text: truncateText(lines[index] ?? "", 240).text });
		}
	}
}
