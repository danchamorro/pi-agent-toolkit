import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createPiMcpPolicyConfig, type PiMcpPolicyConfig } from "./pi-mcp-policy.ts";
import { listFiles, readTextFile, searchText, type PiMcpToolResult } from "./pi-mcp-tools.ts";

export interface PiMcpServerEnv {
	root: string;
	maxFileBytes: number;
	maxReturnedChars: number;
	maxSearchMatches: number;
	maxListEntries: number;
	toolTimeoutMs: number;
	maxConcurrentCalls: number;
}

export async function runPiMcpServer(env: PiMcpServerEnv): Promise<void> {
	const policy = createPiMcpPolicyConfig(env.root, {
		enabled: true,
		maxFileBytes: env.maxFileBytes,
		maxReturnedChars: env.maxReturnedChars,
		maxSearchMatches: env.maxSearchMatches,
		maxListEntries: env.maxListEntries,
		toolTimeoutMs: env.toolTimeoutMs,
		maxConcurrentCalls: env.maxConcurrentCalls,
	});
	const limiter = new ConcurrencyLimiter(policy.maxConcurrentCalls);
	const server = new McpServer(
		{
			name: "pi-readonly-bridge",
			version: "0.1.0",
		},
		{
			instructions:
				"Use these tools only for read-only file inspection under the Pi-approved workspace root. Do not request mutation, terminal, or arbitrary tool execution.",
		},
	);

	server.registerTool(
		"pi.files.read_text",
		{
			title: "Read text file",
			description: "Read one UTF-8 text file under the Pi-approved workspace root with strict safety limits.",
			inputSchema: {
				path: z.string().min(1).describe("Path relative to the workspace root."),
			},
		},
		async ({ path }) => formatToolResult(await limiter.run(() => readTextFile(policy, path))),
	);

	server.registerTool(
		"pi.files.list",
		{
			title: "List files",
			description: "List direct children of a directory under the Pi-approved workspace root.",
			inputSchema: {
				path: z.string().default(".").describe("Directory path relative to the workspace root."),
			},
		},
		async ({ path }) => formatToolResult(await limiter.run(() => listFiles(policy, path))),
	);

	server.registerTool(
		"pi.files.search_text",
		{
			title: "Search text",
			description: "Search text under a directory or file within the Pi-approved workspace root.",
			inputSchema: {
				path: z.string().default(".").describe("File or directory path relative to the workspace root."),
				query: z.string().min(1).max(200).describe("Literal text to search for."),
			},
		},
		async ({ path, query }) => formatToolResult(await limiter.run(() => searchText(policy, path, query))),
	);

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

function formatToolResult(result: PiMcpToolResult): { content: Array<{ type: "text"; text: string }> } {
	logToolResult(result);
	return {
		content: [
			{
				type: "text",
				text: result.content,
			},
		],
	};
}

function logToolResult(result: PiMcpToolResult): void {
	const fields = Object.entries(result.metadata)
		.map(([key, value]) => `${key}=${String(value).replaceAll(/\s+/g, "_")}`)
		.join(" ");
	console.error(`[pi-mcp-bridge] result ok=${result.ok}${fields ? ` ${fields}` : ""}`);
}

class ConcurrencyLimiter {
	private active = 0;
	private readonly queue: Array<() => void> = [];

	constructor(private readonly maxConcurrent: number) {}

	async run<T>(operation: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await operation();
		} finally {
			this.release();
		}
	}

	private async acquire(): Promise<void> {
		if (this.active < this.maxConcurrent) {
			this.active += 1;
			return;
		}
		await new Promise<void>((resolve) => this.queue.push(resolve));
		this.active += 1;
	}

	private release(): void {
		this.active -= 1;
		this.queue.shift()?.();
	}
}
