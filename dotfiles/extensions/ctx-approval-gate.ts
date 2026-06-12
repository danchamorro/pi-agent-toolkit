/**
 * Context Mode Approval Gate Extension
 *
 * Intercepts execution-capable context-mode tools before they run so nested
 * shell/code payloads cannot bypass direct Bash guardrails such as
 * commit-approval, PR approval, and Damage Control. Recognized read-only
 * ctx_batch_execute inspection batches are allowed without prompting.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";

const APPROVE_OPTION = "Approve context-mode execution once";
const DENY_OPTION = "Deny context-mode execution";

const EXECUTION_TOOLS = new Set([
	"ctx_execute",
	"ctx_execute_file",
	"ctx_batch_execute",
]);

const HIGH_RISK_TOOLS = new Set(["ctx_upgrade", "ctx_purge", "ctx_insight"]);

const PROMPTED_TOOLS = new Set([...EXECUTION_TOOLS, ...HIGH_RISK_TOOLS]);

const JSON_PREVIEW_MAX = 4_000;
const CODE_PREVIEW_MAX = 8_000;

interface CtxBatchCommand {
	label?: string;
	command: string;
	index: number;
}

interface HardBlockPattern {
	name: string;
	regex: RegExp;
}

const GIT_GLOBAL_OPTION = String.raw`(?:\s+(?:-[A-Za-z](?:\S+)?|--[A-Za-z0-9-]+(?:=\S+)?)(?:\s+\S+)?)*`;

const HARD_BLOCK_PATTERNS: HardBlockPattern[] = [
	{
		name: "git commit",
		regex: new RegExp(String.raw`\bgit${GIT_GLOBAL_OPTION}\s+commit\b|["']git["']\s*,\s*["']commit["']`, "i"),
	},
	{
		name: "git push",
		regex: new RegExp(String.raw`\bgit${GIT_GLOBAL_OPTION}\s+push\b|["']git["']\s*,\s*["']push["']`, "i"),
	},
	{
		name: "gh pr create",
		regex: /\bgh\s+pr\s+create\b/i,
	},
	{
		name: "gh pr merge",
		regex: /\bgh\s+pr\s+merge\b/i,
	},
	{
		name: "git reset --hard",
		regex: new RegExp(String.raw`\bgit${GIT_GLOBAL_OPTION}\s+reset\b[^\n;&|]*\s--hard\b|["']git["']\s*,\s*["']reset["'][^\n]*["']--hard["']`, "i"),
	},
	{
		name: "git clean",
		regex: new RegExp(String.raw`\bgit${GIT_GLOBAL_OPTION}\s+clean\b|["']git["']\s*,\s*["']clean["']`, "i"),
	},
	{
		name: "rm -rf",
		regex: /\brm\s+(?:[^\n;&|]*\s)?-(?:[^\s-]*r[^\s-]*f|[^\s-]*f[^\s-]*r)\b/i,
	},
	{
		name: "chmod recursive",
		regex: /\bchmod\s+(?:[^\n;&|]*\s)?(?:-[^\s-]*R\b|--recursive\b)/i,
	},
	{
		name: "chown recursive",
		regex: /\bchown\s+(?:[^\n;&|]*\s)?(?:-[^\s-]*R\b|--recursive\b)/i,
	},
	{
		name: "kubectl delete",
		regex: /\bkubectl\s+(?:[^\n;&|]*\s)?delete\b/i,
	},
	{
		name: "terraform apply/destroy",
		regex: /\bterraform\s+(?:apply|destroy)\b/i,
	},
	{
		name: "aws destructive operation",
		regex: /\baws\b[^\n;&|]{0,160}\b(delete|terminate|remove)\b/i,
	},
];

const READ_ONLY_SIMPLE_COMMANDS = new Set([
	"cat",
	"cut",
	"grep",
	"head",
	"ls",
	"pwd",
	"sort",
	"tail",
	"uniq",
	"wc",
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
	"blame",
	"diff",
	"grep",
	"log",
	"ls-files",
	"rev-parse",
	"show",
	"status",
]);

const SED_UNSAFE_SCRIPT_CHARS = /[;\n`<>]/;

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function clip(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	const omitted = text.length - maxLength;
	return `${text.slice(0, maxLength)}\n\n[... clipped ${omitted} more characters ...]`;
}

function stringifyValue(value: unknown, maxLength = JSON_PREVIEW_MAX): string {
	try {
		return clip(JSON.stringify(value, null, 2), maxLength);
	} catch {
		return clip(String(value), maxLength);
	}
}

function findHardBlock(text: string): string | null {
	for (const pattern of HARD_BLOCK_PATTERNS) {
		if (pattern.regex.test(text)) return pattern.name;
	}
	return null;
}

function splitReadOnlyPipeline(command: string): string[] | null {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;

	for (let index = 0; index < command.length; index += 1) {
		const char = command[index];
		const next = command[index + 1];

		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (char === "\\" && quote !== "'") {
			current += char;
			escaped = true;
			continue;
		}

		if (quote) {
			if (char === quote) quote = null;
			current += char;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			current += char;
			continue;
		}

		if (char === "$" && (next === "(" || next === "{")) return null;
		if (["\n", ";", "&", "<", ">", "`"].includes(char)) return null;

		if (char === "|") {
			if (next === "|") return null;
			const segment = current.trim();
			if (!segment) return null;
			segments.push(segment);
			current = "";
			continue;
		}

		current += char;
	}

	if (quote || escaped) return null;

	const finalSegment = current.trim();
	if (!finalSegment) return null;
	segments.push(finalSegment);
	return segments;
}

function tokenizeShellSegment(segment: string): string[] | null {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;
	let tokenStarted = false;

	for (let index = 0; index < segment.length; index += 1) {
		const char = segment[index];

		if (escaped) {
			current += char;
			escaped = false;
			tokenStarted = true;
			continue;
		}

		if (char === "\\" && quote !== "'") {
			escaped = true;
			tokenStarted = true;
			continue;
		}

		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			tokenStarted = true;
			continue;
		}

		if (char === "'" || char === '"') {
			quote = char;
			tokenStarted = true;
			continue;
		}

		if (/\s/.test(char)) {
			if (tokenStarted) {
				tokens.push(current);
				current = "";
				tokenStarted = false;
			}
			continue;
		}

		current += char;
		tokenStarted = true;
	}

	if (quote || escaped) return null;
	if (tokenStarted) tokens.push(current);
	return tokens;
}

function commandBasename(command: string): string {
	return command.split("/").pop() ?? command;
}

function hasLongOption(tokens: string[], option: string): boolean {
	return tokens.some((token) => token === option || token.startsWith(`${option}=`));
}

function hasShortOption(tokens: string[], option: string): boolean {
	return tokens.some(
		(token) => token.startsWith("-") && !token.startsWith("--") && token.slice(1).includes(option),
	);
}

function isSedReadOnlyAddress(address: string): boolean {
	return /^(?:\d+|\$)$/.test(address) || /^\/[^;\n`<>]+\/$/.test(address);
}

function isSedReadOnlyPrintScript(script: string): boolean {
	if (SED_UNSAFE_SCRIPT_CHARS.test(script)) return false;
	if (!script.endsWith("p")) return false;

	const addresses = script.slice(0, -1).split(",");
	if (addresses.length < 1 || addresses.length > 2) return false;
	return addresses.every(isSedReadOnlyAddress);
}

function isReadOnlySed(tokens: string[]): boolean {
	if (hasLongOption(tokens, "--in-place") || hasShortOption(tokens, "i")) return false;
	if (!hasLongOption(tokens, "--quiet") && !hasLongOption(tokens, "--silent") && !hasShortOption(tokens, "n")) {
		return false;
	}

	const scripts: string[] = [];
	for (let index = 1; index < tokens.length; index += 1) {
		const token = tokens[index];

		if (token === "-e") {
			const script = tokens[index + 1];
			if (!script) return false;
			scripts.push(script);
			index += 1;
			continue;
		}

		if (token.startsWith("-e") && token.length > 2) {
			scripts.push(token.slice(2));
			continue;
		}

		if (token.startsWith("--expression=")) {
			scripts.push(token.slice("--expression=".length));
			continue;
		}

		if (token.startsWith("-")) continue;

		scripts.push(token);
		break;
	}

	return scripts.length > 0 && scripts.every(isSedReadOnlyPrintScript);
}

function getGitSubcommand(tokens: string[]): string | null {
	for (let index = 1; index < tokens.length; index += 1) {
		const token = tokens[index];

		if (token === "--") return null;
		if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(token)) {
			index += 1;
			continue;
		}
		if (/^(?:-C|-c)\S/.test(token)) continue;
		if (/^--(?:git-dir|work-tree|namespace)=/.test(token)) continue;
		if (token.startsWith("-")) continue;

		return token;
	}

	return null;
}

function isReadOnlyCommandSegment(segment: string): boolean {
	const tokens = tokenizeShellSegment(segment);
	if (!tokens || tokens.length === 0) return false;

	const command = commandBasename(tokens[0]);
	if (READ_ONLY_SIMPLE_COMMANDS.has(command)) return true;
	if (command === "rg") return !hasLongOption(tokens, "--pre");
	if (command === "fd") {
		return !hasLongOption(tokens, "--exec") && !hasLongOption(tokens, "--exec-batch") && !hasShortOption(tokens, "x") && !hasShortOption(tokens, "X");
	}
	if (command === "jq" || command === "yq") return !hasLongOption(tokens, "--in-place") && !hasShortOption(tokens, "i");
	if (command === "sed") return isReadOnlySed(tokens);
	if (command === "git") {
		const subcommand = getGitSubcommand(tokens);
		return subcommand !== null && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand);
	}

	return false;
}

function isReadOnlyBatchCommand(command: string): boolean {
	const segments = splitReadOnlyPipeline(command);
	return segments !== null && segments.every(isReadOnlyCommandSegment);
}

function isReadOnlyCtxBatch(input: Record<string, unknown>): boolean {
	const commands = getBatchCommands(input);
	return commands.length > 0 && commands.every((command) => isReadOnlyBatchCommand(command.command));
}

function getBatchCommands(input: Record<string, unknown>): CtxBatchCommand[] {
	const commands = input.commands;
	if (!Array.isArray(commands)) return [];

	return commands.flatMap((entry, index) => {
		const commandEntry = asRecord(entry);
		const command = asString(commandEntry.command).trim();
		if (!command) return [];

		return [
			{
				label: asString(commandEntry.label).trim() || undefined,
				command,
				index: index + 1,
			},
		];
	});
}

function formatOptionalLine(label: string, value: unknown): string | null {
	if (value === undefined || value === null || value === "") return null;
	return `${label}: ${String(value)}`;
}

function formatQueries(input: Record<string, unknown>): string[] {
	const queries = input.queries;
	if (!Array.isArray(queries) || queries.length === 0) return [];

	return [
		"",
		"Queries:",
		...queries.map((query) => `- ${String(query)}`),
	];
}

function buildCtxExecutePreview(toolName: string, input: Record<string, unknown>): string {
	const code = asString(input.code);
	const lines = [
		`[ctx approval gate] Context Mode wants to run ${toolName}`,
		"",
		formatOptionalLine("Language", input.language),
		formatOptionalLine("Path", input.path),
		formatOptionalLine("Intent", input.intent),
		formatOptionalLine("Timeout", input.timeout),
		formatOptionalLine("Background", input.background),
	]
		.filter((line): line is string => line !== null)
		.join("\n");

	return `${lines}\n\nCode:\n${clip(code || "(no code provided)", CODE_PREVIEW_MAX)}\n\nApprove this context-mode execution?`;
}

function buildCtxBatchPreview(input: Record<string, unknown>): string {
	const commands = getBatchCommands(input);
	const commandLines = commands.length
		? commands.flatMap((command) => [
				`${command.index}. ${command.label ?? "unlabeled command"}`,
				indentBlock(clip(command.command, CODE_PREVIEW_MAX), "   "),
				"",
			])
		: ["(no commands provided)", ""];

	const metadataLines = [
		formatOptionalLine("Concurrency", input.concurrency),
		formatOptionalLine("Timeout", input.timeout),
		formatOptionalLine("Query scope", input.query_scope),
	]
		.filter((line): line is string => line !== null);

	return [
		"[ctx approval gate] Context Mode wants to run ctx_batch_execute",
		"",
		...metadataLines,
		...(metadataLines.length ? [""] : []),
		"Commands:",
		...commandLines,
		...formatQueries(input),
		"",
		"Approve this context-mode batch?",
	].join("\n");
}

function buildHighRiskPreview(toolName: string, input: Record<string, unknown>): string {
	return [
		`[ctx approval gate] Context Mode wants to run ${toolName}`,
		"",
		"This context-mode tool can change local tooling, start background services, or delete indexed data.",
		"",
		"Input:",
		stringifyValue(input),
		"",
		"Approve this high-risk context-mode tool call?",
	].join("\n");
}

function indentBlock(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => `${prefix}${line}`)
		.join("\n");
}

function findBlockedCtxPayload(toolName: string, input: Record<string, unknown>): string | null {
	if (toolName === "ctx_batch_execute") {
		for (const command of getBatchCommands(input)) {
			const blockedPattern = findHardBlock(command.command);
			if (blockedPattern) {
				return `${blockedPattern} in command #${command.index}${command.label ? ` (${command.label})` : ""}`;
			}
		}
		return null;
	}

	if (toolName === "ctx_execute" || toolName === "ctx_execute_file") {
		const blockedPattern = findHardBlock(asString(input.code));
		return blockedPattern ? `${blockedPattern} in code payload` : null;
	}

	return null;
}

async function requestApproval(
	ctx: ExtensionContext,
	message: string,
): Promise<boolean> {
	if (!ctx.hasUI) return false;

	const choice = await ctx.ui.select(message, [APPROVE_OPTION, DENY_OPTION]);
	return choice === APPROVE_OPTION;
}

function buildPreview(toolName: string, input: Record<string, unknown>): string {
	if (toolName === "ctx_batch_execute") return buildCtxBatchPreview(input);
	if (toolName === "ctx_execute" || toolName === "ctx_execute_file") {
		return buildCtxExecutePreview(toolName, input);
	}
	return buildHighRiskPreview(toolName, input);
}

export default function ctxApprovalGateExtension(_pi: ExtensionAPI) {
	_pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
		const toolName = String(event.toolName ?? "");
		if (!PROMPTED_TOOLS.has(toolName)) return undefined;

		const input = asRecord(event.input);
		const hardBlock = findBlockedCtxPayload(toolName, input);
		if (hardBlock) {
			return {
				block: true,
				reason:
					`Context Mode blocked: ${toolName} payload contains ${hardBlock}. ` +
					"Use direct Bash or the first-class Pi tool so commit-approval, PR approval, and Damage Control can inspect it.",
			};
		}

		if (toolName === "ctx_batch_execute" && isReadOnlyCtxBatch(input)) {
			return undefined;
		}

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Context Mode blocked: interactive approval is required for ${toolName}.`,
			};
		}

		const approved = await requestApproval(ctx, buildPreview(toolName, input));
		if (!approved) {
			return {
				block: true,
				reason: `Context Mode blocked: ${toolName} approval denied.`,
			};
		}

		return undefined;
	});
}
