export interface ClaudeCodeAcpMcpBridgeConfig {
	enabled: boolean;
	maxFileBytes: number;
	maxReturnedChars: number;
	maxSearchMatches: number;
	maxListEntries: number;
	toolTimeoutMs: number;
	maxConcurrentCalls: number;
}

export interface ClaudeCodeAcpConfig {
	command: string;
	args: string[];
	timeoutMs: number;
	debug: boolean;
	debugTranscript: boolean;
	persist: boolean;
	mcpBridge: ClaudeCodeAcpMcpBridgeConfig;
}

const DEFAULT_COMMAND = "npx";
const DEFAULT_ARGS = ["-y", "@agentclientprotocol/claude-agent-acp@0.31.4"];
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MCP_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MCP_MAX_RETURNED_CHARS = 64 * 1024;
const DEFAULT_MCP_MAX_SEARCH_MATCHES = 50;
const DEFAULT_MCP_MAX_LIST_ENTRIES = 200;
const DEFAULT_MCP_TOOL_TIMEOUT_MS = 10_000;
const DEFAULT_MCP_MAX_CONCURRENT_CALLS = 2;

function parseArgsJson(raw: string): string[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`PI_CLAUDE_ACP_ARGS_JSON must be a JSON array of strings: ${detail}`);
	}

	if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
		throw new Error("PI_CLAUDE_ACP_ARGS_JSON must be a JSON array of strings.");
	}

	return parsed;
}

function parsePositiveNumber(raw: string | undefined, fallback: number, name: string): number {
	if (!raw) return fallback;

	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(`${name} must be a positive number.`);
	}

	return value;
}

function parsePositiveInteger(raw: string | undefined, fallback: number, name: string): number {
	const value = parsePositiveNumber(raw, fallback, name);
	if (!Number.isInteger(value)) throw new Error(`${name} must be a positive integer.`);
	return value;
}

function parseBooleanEnv(raw: string | undefined): boolean {
	if (!raw) return false;
	return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

export function loadClaudeCodeAcpConfig(env: NodeJS.ProcessEnv = process.env): ClaudeCodeAcpConfig {
	const command = env.PI_CLAUDE_ACP_COMMAND?.trim() || DEFAULT_COMMAND;
	const args = env.PI_CLAUDE_ACP_ARGS_JSON ? parseArgsJson(env.PI_CLAUDE_ACP_ARGS_JSON) : DEFAULT_ARGS;

	return {
		command,
		args,
		timeoutMs: parsePositiveNumber(env.PI_CLAUDE_ACP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, "PI_CLAUDE_ACP_TIMEOUT_MS"),
		debug: parseBooleanEnv(env.PI_CLAUDE_ACP_DEBUG),
		debugTranscript: parseBooleanEnv(env.PI_CLAUDE_ACP_DEBUG_TRANSCRIPT),
		persist: parseBooleanEnv(env.PI_CLAUDE_ACP_PERSIST),
		mcpBridge: loadMcpBridgeConfig(env),
	};
}

function loadMcpBridgeConfig(env: NodeJS.ProcessEnv): ClaudeCodeAcpMcpBridgeConfig {
	return {
		enabled: parseBooleanEnv(env.PI_CLAUDE_ACP_PI_MCP_BRIDGE),
		maxFileBytes: parsePositiveInteger(
			env.PI_CLAUDE_ACP_MCP_MAX_FILE_BYTES,
			DEFAULT_MCP_MAX_FILE_BYTES,
			"PI_CLAUDE_ACP_MCP_MAX_FILE_BYTES",
		),
		maxReturnedChars: parsePositiveInteger(
			env.PI_CLAUDE_ACP_MCP_MAX_RETURNED_CHARS,
			DEFAULT_MCP_MAX_RETURNED_CHARS,
			"PI_CLAUDE_ACP_MCP_MAX_RETURNED_CHARS",
		),
		maxSearchMatches: parsePositiveInteger(
			env.PI_CLAUDE_ACP_MCP_MAX_SEARCH_MATCHES,
			DEFAULT_MCP_MAX_SEARCH_MATCHES,
			"PI_CLAUDE_ACP_MCP_MAX_SEARCH_MATCHES",
		),
		maxListEntries: parsePositiveInteger(
			env.PI_CLAUDE_ACP_MCP_MAX_LIST_ENTRIES,
			DEFAULT_MCP_MAX_LIST_ENTRIES,
			"PI_CLAUDE_ACP_MCP_MAX_LIST_ENTRIES",
		),
		toolTimeoutMs: parsePositiveNumber(
			env.PI_CLAUDE_ACP_MCP_TOOL_TIMEOUT_MS,
			DEFAULT_MCP_TOOL_TIMEOUT_MS,
			"PI_CLAUDE_ACP_MCP_TOOL_TIMEOUT_MS",
		),
		maxConcurrentCalls: parsePositiveInteger(
			env.PI_CLAUDE_ACP_MCP_MAX_CONCURRENT_CALLS,
			DEFAULT_MCP_MAX_CONCURRENT_CALLS,
			"PI_CLAUDE_ACP_MCP_MAX_CONCURRENT_CALLS",
		),
	};
}

export function describeClaudeCodeAcpCommand(config: ClaudeCodeAcpConfig): string {
	return [config.command, ...config.args].join(" ");
}
