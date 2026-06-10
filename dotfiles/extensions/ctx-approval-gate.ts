/**
 * Context Mode Approval Gate Extension
 *
 * Intercepts execution-capable context-mode tools before they run so nested
 * shell/code payloads cannot bypass direct Bash guardrails such as
 * commit-approval, PR approval, and Damage Control.
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
