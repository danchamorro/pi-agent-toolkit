import { runPiMcpServer, type PiMcpServerEnv } from "./pi-mcp-server.ts";

function parsePositiveInteger(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`);
	return value;
}

function loadEnv(): PiMcpServerEnv {
	const root = process.env.PI_CLAUDE_ACP_MCP_ROOT;
	if (!root) throw new Error("PI_CLAUDE_ACP_MCP_ROOT is required.");
	return {
		root,
		maxFileBytes: parsePositiveInteger("PI_CLAUDE_ACP_MCP_MAX_FILE_BYTES", 256 * 1024),
		maxReturnedChars: parsePositiveInteger("PI_CLAUDE_ACP_MCP_MAX_RETURNED_CHARS", 64 * 1024),
		maxSearchMatches: parsePositiveInteger("PI_CLAUDE_ACP_MCP_MAX_SEARCH_MATCHES", 50),
		maxListEntries: parsePositiveInteger("PI_CLAUDE_ACP_MCP_MAX_LIST_ENTRIES", 200),
		toolTimeoutMs: parsePositiveInteger("PI_CLAUDE_ACP_MCP_TOOL_TIMEOUT_MS", 10_000),
		maxConcurrentCalls: parsePositiveInteger("PI_CLAUDE_ACP_MCP_MAX_CONCURRENT_CALLS", 2),
	};
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

runPiMcpServer(loadEnv()).catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`[pi-mcp-bridge] fatal ${message.replaceAll(/\s+/g, "_")}`);
	process.exit(1);
});
