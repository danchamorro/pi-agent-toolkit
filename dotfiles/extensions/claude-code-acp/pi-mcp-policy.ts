import { lstat, realpath, stat } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import type { ClaudeCodeAcpMcpBridgeConfig } from "./config.ts";

export const PI_MCP_TOOL_NAMES = ["pi.files.read_text", "pi.files.list", "pi.files.search_text"] as const;

export type PiMcpToolName = (typeof PI_MCP_TOOL_NAMES)[number];

export type PiMcpDenyReason =
	| "invalid_path"
	| "outside_cwd"
	| "symlink_escape"
	| "secret_path"
	| "missing"
	| "not_file"
	| "not_directory"
	| "too_large"
	| "binary"
	| "timeout"
	| "too_many_results"
	| "invalid_query";

export interface PiMcpPolicyConfig {
	root: string;
	maxFileBytes: number;
	maxReturnedChars: number;
	maxSearchMatches: number;
	maxListEntries: number;
	toolTimeoutMs: number;
	maxConcurrentCalls: number;
}

export interface AllowedPath {
	root: string;
	absolutePath: string;
	realPath: string;
	relativePath: string;
}

export type PolicyResult<T> = { allowed: true; value: T } | { allowed: false; reason: PiMcpDenyReason };

const SECRET_PATH_PATTERN = /(^|[/\\])(?:\.env(?:\.|$)|\.ssh(?:[/\\]|$)|\.gnupg(?:[/\\]|$)|credentials?(?:\.|[/\\]|$)|secrets?(?:\.|[/\\]|$)|tokens?(?:\.|[/\\]|$)|.*(?:api[_-]?key|auth[_-]?token|private[_-]?key).*)/i;

export function createPiMcpPolicyConfig(root: string, bridge: ClaudeCodeAcpMcpBridgeConfig): PiMcpPolicyConfig {
	return {
		root: resolve(root),
		maxFileBytes: bridge.maxFileBytes,
		maxReturnedChars: bridge.maxReturnedChars,
		maxSearchMatches: bridge.maxSearchMatches,
		maxListEntries: bridge.maxListEntries,
		toolTimeoutMs: bridge.toolTimeoutMs,
		maxConcurrentCalls: bridge.maxConcurrentCalls,
	};
}

export function isAllowedToolName(name: string): name is PiMcpToolName {
	return PI_MCP_TOOL_NAMES.includes(name as PiMcpToolName);
}

export function isSecretLookingPath(path: string): boolean {
	return SECRET_PATH_PATTERN.test(path);
}

export function isPathWithinRoot(root: string, candidate: string): boolean {
	const relativePath = relative(root, candidate);
	return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export async function resolveAllowedPath(config: PiMcpPolicyConfig, requestedPath: string): Promise<PolicyResult<AllowedPath>> {
	if (!requestedPath.trim() || requestedPath.includes("\0")) return { allowed: false, reason: "invalid_path" };
	if (isSecretLookingPath(requestedPath)) return { allowed: false, reason: "secret_path" };

	const root = await realpath(config.root);
	const absolutePath = normalize(isAbsolute(requestedPath) ? requestedPath : resolve(root, requestedPath));
	if (!isPathWithinRoot(root, absolutePath)) return { allowed: false, reason: "outside_cwd" };

	let resolvedRealPath: string;
	try {
		resolvedRealPath = await realpath(absolutePath);
	} catch {
		return { allowed: false, reason: "missing" };
	}

	if (!isPathWithinRoot(root, resolvedRealPath)) return { allowed: false, reason: "symlink_escape" };

	const relativePath = relative(root, resolvedRealPath) || ".";
	if (isSecretLookingPath(relativePath.split(sep).join("/"))) return { allowed: false, reason: "secret_path" };

	return {
		allowed: true,
		value: {
			root,
			absolutePath,
			realPath: resolvedRealPath,
			relativePath,
		},
	};
}

export async function ensureRegularFile(path: AllowedPath, maxFileBytes: number): Promise<PolicyResult<AllowedPath>> {
	let fileStat;
	try {
		fileStat = await stat(path.realPath);
	} catch {
		return { allowed: false, reason: "missing" };
	}
	if (!fileStat.isFile()) return { allowed: false, reason: "not_file" };
	if (fileStat.size > maxFileBytes) return { allowed: false, reason: "too_large" };
	return { allowed: true, value: path };
}

export async function ensureDirectory(path: AllowedPath): Promise<PolicyResult<AllowedPath>> {
	let pathStat;
	try {
		pathStat = await lstat(path.realPath);
	} catch {
		return { allowed: false, reason: "missing" };
	}
	if (!pathStat.isDirectory()) return { allowed: false, reason: "not_directory" };
	return { allowed: true, value: path };
}

export function looksBinary(buffer: Buffer): boolean {
	return buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
}

export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
	if (text.length <= maxChars) return { text, truncated: false };
	return { text: text.slice(0, maxChars), truncated: true };
}

export function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	return {
		signal: controller.signal,
		cleanup: () => clearTimeout(timeout),
	};
}

export function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	const error = new Error("Operation timed out or was aborted.");
	error.name = "AbortError";
	throw error;
}
