export interface ClaudeCodeAcpConfig {
	command: string;
	args: string[];
	timeoutMs: number;
	debug: boolean;
	debugTranscript: boolean;
}

const DEFAULT_COMMAND = "npx";
const DEFAULT_ARGS = ["-y", "@agentclientprotocol/claude-agent-acp@0.31.4"];
const DEFAULT_TIMEOUT_MS = 300_000;

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

function parseTimeoutMs(raw: string | undefined): number {
	if (!raw) return DEFAULT_TIMEOUT_MS;

	const timeoutMs = Number(raw);
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error("PI_CLAUDE_ACP_TIMEOUT_MS must be a positive number of milliseconds.");
	}

	return timeoutMs;
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
		timeoutMs: parseTimeoutMs(env.PI_CLAUDE_ACP_TIMEOUT_MS),
		debug: parseBooleanEnv(env.PI_CLAUDE_ACP_DEBUG),
		debugTranscript: parseBooleanEnv(env.PI_CLAUDE_ACP_DEBUG_TRANSCRIPT),
	};
}

export function describeClaudeCodeAcpCommand(config: ClaudeCodeAcpConfig): string {
	return [config.command, ...config.args].join(" ");
}
