/**
 * Subagents Extension
 *
 * Commands:
 * - /subagent start <task> - start a background sub-agent.
 * - /subagent start <role> <task> - start a role-specific background sub-agent.
 * - /subagent agents - list the bundled sub-agent roles.
 * - /subagent list - show known sub-agents.
 * - /subagent view [id] - show sub-agent status or details.
 * - /subagent stop <id> - stop a running sub-agent.
 * - /subagent reply <id> <feedback> - answer a sub-agent feedback request.
 *
 * Tools:
 * - start_subagent - let the main agent launch a role-specific background sub-agent.
 *   The tool waits until the sub-agent finishes or needs feedback.
 *
 * Shortcut: none.
 *
 * Adds a small Claude Code-style sub-agent MVP. Sub-agents run as in-process
 * Pi sessions, track status and activity in memory, can ask the main session
 * for feedback through an explicit tool, can use bundled planner/reviewer/
 * scout/worker role prompts, and expose a compact live status widget near the
 * editor while background work is active.
 */

import {
	buildSessionContext,
	createAgentSession,
	createExtensionRuntime,
	parseFrontmatter,
	SessionManager,
	type AgentSession,
	type AgentSessionEvent,
	type ContextUsage,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ResourceLoader,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	type AssistantMessage,
	type Message,
	type Model,
	type ThinkingLevel as AiThinkingLevel,
} from "@earendil-works/pi-ai";
import { Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";

type SessionThinkingLevel = "off" | AiThinkingLevel;
type SubagentStatus = "starting" | "running" | "waiting for feedback" | "completed" | "failed" | "stopped";

type FeedbackRequest = {
	id: string;
	question: string;
	context?: string;
	requestedAt: number;
	resolve: (feedback: string) => void;
	cancel: (reason: string) => void;
};

type FeedbackRequestDetails = {
	requestId: string;
	subagentId: string;
	status: "answered" | "cancelled";
};

type StartSubagentDetails = {
	subagentId?: string;
	name?: string;
	role?: string;
	task?: string;
	status: "started" | "waiting_for_feedback" | "completed" | "failed" | "stopped" | "error";
	subagentStatus?: SubagentStatus;
	command?: string;
	availableRoles?: string[];
	activity?: string;
	elapsed?: string;
	result?: string;
	error?: string;
};

type RoleModelSpec = {
	provider: string;
	modelId: string;
	label: string;
};

type SubagentRole = {
	name: string;
	description: string;
	tools: string[];
	model?: RoleModelSpec;
	thinking?: SessionThinkingLevel;
	systemPrompt: string;
	filePath: string;
	autoExit?: boolean;
	output?: string;
};

type ParsedStartArgs = {
	name: string;
	task: string;
	role?: SubagentRole;
	notifyOnStart?: boolean;
	notifyOnCompletion?: boolean;
};

type SubagentRecord = {
	id: string;
	name: string;
	task: string;
	role?: SubagentRole;
	status: SubagentStatus;
	startedAt: number;
	finishedAt?: number;
	activity: string;
	result?: string;
	error?: string;
	session?: AgentSession;
	unsubscribe?: () => void;
	contextUsage?: ContextUsage;
	pendingFeedback?: FeedbackRequest;
	feedbackSerial: number;
	toolCalls: Map<string, { name: string; startedAt: number; status: "running" | "done" | "failed" }>;
	completion?: Promise<void>;
	notifyOnCompletion: boolean;
};

const SUBAGENT_MESSAGE_TYPE = "subagent-status";
const FEEDBACK_MESSAGE_TYPE = "subagent-feedback-request";
const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
const SUBAGENT_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
const THINKING_LEVELS = new Set<SessionThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh"]);
const MAX_ACTIVITY_LENGTH = 220;
const RECENT_FINISHED_WIDGET_MS = 60_000;
const WIDGET_INTERVAL_KEY = Symbol.for("pi-agent-toolkit/subagents-widget-interval");
const SUBAGENTS_ASSET_DIR = join(dirname(fileURLToPath(import.meta.url)), "subagents");
const ROLE_AGENT_DIR = join(SUBAGENTS_ASSET_DIR, "agents");
const ROLE_AGENT_FILES = ["planner.md", "reviewer.md", "scout.md", "worker.md"] as const;

{
	const previousInterval = (globalThis as Record<symbol, ReturnType<typeof setInterval> | null | undefined>)[
		WIDGET_INTERVAL_KEY
	];
	if (previousInterval) {
		clearInterval(previousInterval);
		(globalThis as Record<symbol, ReturnType<typeof setInterval> | null | undefined>)[WIDGET_INTERVAL_KEY] = null;
	}
}

const AskMainSessionParams = Type.Object({
	question: Type.String({
		description: "The specific question or decision needed from the main session.",
	}),
	context: Type.Optional(
		Type.String({
			description: "Brief context explaining why the sub-agent is blocked.",
		}),
	),
});

const StartSubagentParams = Type.Object({
	role: Type.Optional(
		Type.String({
			description: "Optional bundled role to use: planner, reviewer, scout, or worker.",
		}),
	),
	task: Type.String({
		description: "The concrete task the sub-agent should work on.",
	}),
	name: Type.Optional(
		Type.String({
			description: "Optional display name. Defaults to the role name or a task-derived name.",
		}),
	),
});

function stripDynamicSystemPromptFooter(systemPrompt: string): string {
	return systemPrompt
		.replace(/\nCurrent date and time:[^\n]*(?:\nCurrent working directory:[^\n]*)?$/u, "")
		.replace(/\nCurrent working directory:[^\n]*$/u, "")
		.trim();
}

function singleLine(value: string, maxLength = MAX_ACTIVITY_LENGTH): string {
	const line = value.replace(/\s+/g, " ").trim();
	return line.length > maxLength ? `${line.slice(0, maxLength - 3)}...` : line;
}

function splitCommand(input: string): { command: string; rest: string } {
	const trimmed = input.trim();
	if (!trimmed) {
		return { command: "view", rest: "" };
	}

	const firstSpace = trimmed.search(/\s/u);
	if (firstSpace === -1) {
		return { command: trimmed.toLowerCase(), rest: "" };
	}

	return {
		command: trimmed.slice(0, firstSpace).toLowerCase(),
		rest: trimmed.slice(firstSpace + 1).trim(),
	};
}

function parseModelSpec(value: unknown, source: string): RoleModelSpec | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Role file ${source} has an invalid model value.`);
	}

	const label = value.trim();
	const slashIndex = label.indexOf("/");
	if (slashIndex <= 0 || slashIndex === label.length - 1) {
		throw new Error(`Role file ${source} model must use provider/model format.`);
	}

	return {
		provider: label.slice(0, slashIndex),
		modelId: label.slice(slashIndex + 1),
		label,
	};
}

function parseThinkingLevel(value: unknown, source: string): SessionThinkingLevel | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string" || !THINKING_LEVELS.has(value as SessionThinkingLevel)) {
		throw new Error(`Role file ${source} has an invalid thinking level.`);
	}
	return value as SessionThinkingLevel;
}

function parseRoleTools(value: unknown, source: string): string[] {
	if (value === undefined) {
		return DEFAULT_TOOLS;
	}

	const rawTools =
		typeof value === "string"
			? value.split(",")
			: Array.isArray(value)
				? value.map((item) => {
						if (typeof item !== "string") {
							throw new Error(`Role file ${source} has a non-string tool value.`);
						}
						return item;
					})
				: undefined;

	if (!rawTools) {
		throw new Error(`Role file ${source} has an invalid tools value.`);
	}

	const tools = rawTools.map((tool) => tool.trim()).filter(Boolean);
	for (const tool of tools) {
		if (!SUBAGENT_TOOL_NAMES.has(tool)) {
			throw new Error(`Role file ${source} references unsupported tool "${tool}".`);
		}
	}

	return [...new Set(tools)];
}

function parseOptionalBoolean(value: unknown, field: string, source: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "boolean") {
		throw new Error(`Role file ${source} has an invalid ${field} value.`);
	}
	return value;
}

function parseOptionalString(value: unknown, field: string, source: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`Role file ${source} has an invalid ${field} value.`);
	}
	return value.trim() || undefined;
}

function loadSubagentRoles(): SubagentRole[] {
	return ROLE_AGENT_FILES.map((fileName) => {
		const filePath = join(ROLE_AGENT_DIR, fileName);
		if (!existsSync(filePath)) {
			throw new Error(`Missing sub-agent role file: ${filePath}`);
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(readFileSync(filePath, "utf8"));
		const name = parseOptionalString(frontmatter.name, "name", fileName);
		if (!name) {
			throw new Error(`Role file ${fileName} must declare a name.`);
		}

		return {
			name,
			description: parseOptionalString(frontmatter.description, "description", fileName) ?? "",
			tools: parseRoleTools(frontmatter.tools, fileName),
			model: parseModelSpec(frontmatter.model, fileName),
			thinking: parseThinkingLevel(frontmatter.thinking, fileName),
			systemPrompt: body.trim(),
			filePath,
			autoExit: parseOptionalBoolean(frontmatter["auto-exit"], "auto-exit", fileName),
			output: parseOptionalString(frontmatter.output, "output", fileName),
		};
	});
}

function parseStartArgs(input: string, rolesByName: Map<string, SubagentRole>): ParsedStartArgs | null {
	const taskInput = input.trim();
	if (!taskInput) {
		return null;
	}

	const colonIndex = taskInput.indexOf(":");
	if (colonIndex > 0 && colonIndex <= 48) {
		const name = taskInput.slice(0, colonIndex).trim();
		const task = taskInput.slice(colonIndex + 1).trim();
		if (name && task) {
			const role = rolesByName.get(name.toLowerCase());
			return role ? { name: role.name, task, role } : { name, task };
		}
	}

	const { command: firstWord, rest } = splitCommand(taskInput);
	const role = rolesByName.get(firstWord.toLowerCase());
	if (role) {
		if (!rest) {
			return null;
		}
		return {
			name: role.name,
			task: rest,
			role,
		};
	}

	return {
		name: deriveName(taskInput),
		task: taskInput,
	};
}

function deriveName(task: string): string {
	const words = task
		.replace(/[^a-zA-Z0-9 _.-]+/g, " ")
		.split(/\s+/u)
		.filter(Boolean)
		.slice(0, 5);
	return words.length > 0 ? words.join(" ") : "sub-agent";
}

function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);

	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	if (minutes > 0) {
		return `${minutes}m ${seconds}s`;
	}
	return `${seconds}s`;
}

function elapsedFor(record: SubagentRecord): string {
	return formatDuration((record.finishedAt ?? Date.now()) - record.startedAt);
}

function formatContextUsage(record: SubagentRecord): string {
	const usage = record.session?.getContextUsage() ?? record.contextUsage;
	if (!usage) {
		return "context unknown";
	}
	if (usage.tokens === null || usage.percent === null) {
		return `context ?/${usage.contextWindow}`;
	}
	return `context ${Math.round(usage.tokens)}/${usage.contextWindow} (${usage.percent.toFixed(1)}%)`;
}

function extractText(parts: AssistantMessage["content"]): string {
	return parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function extractEventAssistantText(message: unknown): string {
	if (!message || typeof message !== "object") {
		return "";
	}

	const maybeMessage = message as { role?: unknown; content?: unknown };
	if (maybeMessage.role !== "assistant" || !Array.isArray(maybeMessage.content)) {
		return "";
	}

	return maybeMessage.content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function getLastAssistantMessage(session: AgentSession): AssistantMessage | null {
	for (let i = session.state.messages.length - 1; i >= 0; i--) {
		const message = session.state.messages[i];
		if (message.role === "assistant") {
			return message as AssistantMessage;
		}
	}

	return null;
}

function createSubagentResourceLoader(ctx: ExtensionContext, record: SubagentRecord): ResourceLoader {
	const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
	const mainSystemPrompt = stripDynamicSystemPromptFooter(ctx.getSystemPrompt());
	const subagentPrompt = [
		"You are a focused Pi sub-agent running in the background for the main session.",
		`Sub-agent id: ${record.id}`,
		`Sub-agent name: ${record.name}`,
		`Assigned task: ${record.task}`,
		"Work independently, keep the scope narrow, and produce a concise final result.",
		"When blocked, missing a decision, or needing user input, call ask_main_session with a specific question and wait for the reply.",
		"Do not assume feedback that was not provided.",
	].join("\n");
	const rolePrompt = record.role
		? [
				`Selected role: ${record.role.name}`,
				record.role.description ? `Role description: ${record.role.description}` : "",
				record.role.output ? `Expected output artifact: ${record.role.output}` : "",
				record.role.autoExit ? "When the assigned work is complete, return the final result and stop." : "",
				record.role.systemPrompt,
			]
				.filter(Boolean)
				.join("\n\n")
		: "";

	return {
		getExtensions: () => extensionsResult,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => [mainSystemPrompt, subagentPrompt, rolePrompt].filter(Boolean).join("\n\n"),
		getAppendSystemPrompt: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

function seedMainContext(record: SubagentRecord, session: AgentSession, ctx: ExtensionContext): void {
	try {
		const context = buildSessionContext(ctx.sessionManager.getEntries(), ctx.sessionManager.getLeafId());
		const messages = context.messages as Message[];
		if (messages.length > 0) {
			session.agent.state.messages = messages as typeof session.state.messages;
			record.activity = `Seeded with ${messages.length} main-context messages.`;
		}
	} catch (error) {
		record.activity = `Could not seed main context: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function updateRecordContextUsage(record: SubagentRecord): void {
	record.contextUsage = record.session?.getContextUsage();
}

function markActivity(record: SubagentRecord, activity: string): void {
	record.activity = singleLine(activity);
	updateRecordContextUsage(record);
}

function hasStatus(record: SubagentRecord, status: SubagentStatus): boolean {
	return record.status === status;
}

function isActiveStatus(status: SubagentStatus): boolean {
	return status === "starting" || status === "running" || status === "waiting for feedback";
}

function isWorkingStatus(status: SubagentStatus): boolean {
	return status === "starting" || status === "running";
}

function isVisibleInWidget(record: SubagentRecord, now: number): boolean {
	if (isActiveStatus(record.status)) {
		return true;
	}
	return record.finishedAt !== undefined && now - record.finishedAt <= RECENT_FINISHED_WIDGET_MS;
}

function padToWidth(line: string, width: number): string {
	return line + " ".repeat(Math.max(0, width - visibleWidth(line)));
}

function widgetTopLine(title: string, info: string, width: number, theme: ExtensionContext["ui"]["theme"]): string {
	if (width <= 0) {
		return "";
	}
	if (width === 1) {
		return theme.fg("accent", "+");
	}

	const innerWidth = width - 2;
	const label = ` ${title}${info ? ` ${info}` : ""} `;
	const clippedLabel = truncateToWidth(label, innerWidth);
	const fill = "-".repeat(Math.max(0, innerWidth - visibleWidth(clippedLabel)));
	return `${theme.fg("accent", "+")}${theme.fg("accent", clippedLabel)}${theme.fg("accent", fill)}${theme.fg("accent", "+")}`;
}

function widgetBottomLine(width: number, theme: ExtensionContext["ui"]["theme"]): string {
	if (width <= 0) {
		return "";
	}
	if (width === 1) {
		return theme.fg("accent", "+");
	}
	return theme.fg("accent", `+${"-".repeat(width - 2)}+`);
}

function widgetContentLine(left: string, right: string, width: number, theme: ExtensionContext["ui"]["theme"]): string {
	if (width <= 0) {
		return "";
	}
	if (width === 1) {
		return theme.fg("accent", "|");
	}

	const contentWidth = Math.max(0, width - 2);
	const rightWidth = visibleWidth(right);
	if (rightWidth >= contentWidth) {
		const clippedRight = truncateToWidth(right, contentWidth);
		return `${theme.fg("accent", "|")}${padToWidth(clippedRight, contentWidth)}${theme.fg("accent", "|")}`;
	}

	const clippedLeft = truncateToWidth(left, contentWidth - rightWidth);
	const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(clippedLeft) - rightWidth));
	return `${theme.fg("accent", "|")}${clippedLeft}${padding}${right}${theme.fg("accent", "|")}`;
}

function compactContextUsage(record: SubagentRecord): string {
	const usage = record.session?.getContextUsage() ?? record.contextUsage;
	if (!usage || usage.percent === null) {
		return "ctx ?";
	}
	return `ctx ${usage.percent.toFixed(1)}%`;
}

function latestRunningTool(record: SubagentRecord): string | undefined {
	const running = [...record.toolCalls.values()].filter((tool) => tool.status === "running");
	return running.at(-1)?.name;
}

function statusText(record: SubagentRecord, theme: ExtensionContext["ui"]["theme"]): string {
	switch (record.status) {
		case "starting":
			return theme.fg("accent", "starting");
		case "running": {
			const tool = latestRunningTool(record);
			return tool ? theme.fg("accent", `running ${tool}`) : theme.fg("accent", "running");
		}
		case "waiting for feedback":
			return theme.fg("warning", `waiting /subagent reply ${record.id}`);
		case "completed":
			return theme.fg("success", "complete");
		case "failed":
			return theme.fg("error", "failed");
		case "stopped":
			return theme.fg("warning", "stopped");
	}
}

function renderSubagentWidgetLines(records: SubagentRecord[], width: number, theme: ExtensionContext["ui"]["theme"]): string[] {
	const now = Date.now();
	const visibleRecords = records.filter((record) => isVisibleInWidget(record, now));
	const activeCount = visibleRecords.filter((record) => isActiveStatus(record.status)).length;
	if (visibleRecords.length === 0) {
		return [];
	}

	const info = activeCount === visibleRecords.length ? `${activeCount} active` : `${activeCount} active, ${visibleRecords.length - activeCount} recent`;
	const lines = [widgetTopLine("Subagents", info, width, theme)];
	const displayRecords = visibleRecords.slice(0, 3);

	for (const record of displayRecords) {
		const left = ` ${elapsedFor(record).padStart(5)}  ${record.id}  ${record.name} `;
		const right = `${statusText(record, theme)} ${theme.fg("dim", compactContextUsage(record))} `;
		lines.push(widgetContentLine(left, right, width, theme));

		if (record.pendingFeedback) {
			const feedback = `   needs feedback: ${record.pendingFeedback.question} `;
			lines.push(widgetContentLine(theme.fg("warning", truncateToWidth(feedback, Math.max(0, width - 2))), "", width, theme));
		} else if (record.status === "running" || record.status === "starting") {
			const activity = `   ${record.activity} `;
			lines.push(widgetContentLine(theme.fg("dim", activity), "", width, theme));
		}
	}

	if (visibleRecords.length > displayRecords.length) {
		lines.push(widgetContentLine(theme.fg("dim", ` ${visibleRecords.length - displayRecords.length} more sub-agent(s) `), "", width, theme));
	}

	lines.push(widgetBottomLine(width, theme));
	return lines;
}

class SubagentStatusWidget implements Component {
	constructor(
		private readonly getRecords: () => SubagentRecord[],
		private readonly theme: ExtensionContext["ui"]["theme"],
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		return renderSubagentWidgetLines(this.getRecords(), width, this.theme);
	}
}

export default function (pi: ExtensionAPI) {
	const roles = loadSubagentRoles();
	const rolesByName = new Map(roles.map((role) => [role.name.toLowerCase(), role]));
	const records = new Map<string, SubagentRecord>();
	let nextSubagentNumber = 1;
	let latestCtx: ExtensionContext | undefined;
	let widgetInterval: ReturnType<typeof setInterval> | null = null;

	function sortedRecords(): SubagentRecord[] {
		return [...records.values()].sort((a, b) => a.startedAt - b.startedAt);
	}

	function setWidgetInterval(interval: ReturnType<typeof setInterval> | null): void {
		widgetInterval = interval;
		(globalThis as Record<symbol, ReturnType<typeof setInterval> | null | undefined>)[WIDGET_INTERVAL_KEY] = interval;
	}

	function clearWidgetInterval(): void {
		if (widgetInterval) {
			clearInterval(widgetInterval);
			setWidgetInterval(null);
		}
	}

	function activeRecords(): SubagentRecord[] {
		return sortedRecords().filter((record) => isActiveStatus(record.status));
	}

	function visibleWidgetRecords(): SubagentRecord[] {
		const now = Date.now();
		return sortedRecords().filter((record) => isVisibleInWidget(record, now));
	}

	function updateStatusWidget(ctx = latestCtx): void {
		if (!ctx?.hasUI) {
			return;
		}

		const visibleRecords = visibleWidgetRecords();
		const active = visibleRecords.filter((record) => isActiveStatus(record.status));
		const waiting = active.filter((record) => record.status === "waiting for feedback");

		if (visibleRecords.length === 0) {
			ctx.ui.setWidget("subagents", undefined);
			ctx.ui.setStatus("subagents", undefined);
			clearWidgetInterval();
			return;
		}

		const statusLabel = waiting.length > 0 ? `SA:${active.length} wait` : `SA:${active.length}`;
		ctx.ui.setStatus(
			"subagents",
			waiting.length > 0 ? ctx.ui.theme.fg("warning", statusLabel) : ctx.ui.theme.fg("accent", statusLabel),
		);
		ctx.ui.setWidget("subagents", (_tui, theme) => new SubagentStatusWidget(sortedRecords, theme), {
			placement: "belowEditor",
		});

		if (!widgetInterval) {
			setWidgetInterval(
				setInterval(() => {
					updateStatusWidget();
				}, 1000),
			);
		}
	}

	function findRecord(query: string): { record?: SubagentRecord; error?: string } {
		const id = query.trim();
		if (!id) {
			return { error: "Sub-agent id is required." };
		}

		const exact = records.get(id);
		if (exact) {
			return { record: exact };
		}

		const matches = [...records.values()].filter((record) => record.id.startsWith(id));
		if (matches.length === 1) {
			return { record: matches[0] };
		}
		if (matches.length > 1) {
			return { error: `Sub-agent id "${id}" is ambiguous.` };
		}
		return { error: `Sub-agent "${id}" was not found.` };
	}

	function formatList(): string {
		const items = sortedRecords();
		if (items.length === 0) {
			return "No sub-agents yet. Start one with `/subagent start <task>` or `/subagent start <role> <task>`.";
		}

		return items
			.map((record) => {
				const bits = [
					`${record.id} ${record.name}`,
					record.role ? `role: ${record.role.name}` : undefined,
					`status: ${record.status}`,
					`elapsed: ${elapsedFor(record)}`,
					formatContextUsage(record),
					`latest: ${record.activity}`,
				].filter(Boolean);
				return `- ${bits.join(" | ")}`;
			})
			.join("\n");
	}

	function formatRoleList(): string {
		return roles
			.map((role) => {
				const tools = [...new Set([...role.tools, "ask_main_session"])].join(", ");
				const model = role.model?.label ?? "current model";
				const thinking = role.thinking ?? "current thinking";
				return `- ${role.name}: ${role.description || "No description"} | tools: ${tools} | model: ${model} | thinking: ${thinking}`;
			})
			.join("\n");
	}

	function postStatusMessage(content: string): void {
		pi.sendMessage(
			{
				customType: SUBAGENT_MESSAGE_TYPE,
				content,
				display: true,
			},
			{ triggerTurn: false },
		);
	}

	function postFeedbackRequest(record: SubagentRecord, request: FeedbackRequest): void {
		const parts = [
			`Sub-agent ${record.name} (${record.id}) needs feedback.`,
			`Question: ${request.question}`,
		];
		if (request.context) {
			parts.push(`Context: ${request.context}`);
		}
		parts.push(`Reply with: /subagent reply ${record.id} <feedback>`);

		pi.sendMessage(
			{
				customType: FEEDBACK_MESSAGE_TYPE,
				content: parts.join("\n\n"),
				display: true,
				details: {
					subagentId: record.id,
					requestId: request.id,
					question: request.question,
				},
			},
			{ triggerTurn: false },
		);
	}

	function createAskMainSessionTool(record: SubagentRecord): ToolDefinition<typeof AskMainSessionParams, FeedbackRequestDetails> {
		return {
			name: "ask_main_session",
			label: "Ask Main Session",
			description:
				"Ask the main Pi session for feedback when the sub-agent is blocked or needs user input. The tool waits until the main session replies.",
			promptSnippet:
				"Ask the main Pi session for feedback when blocked or when user input is required. Use this instead of guessing.",
			promptGuidelines: [
				"Call ask_main_session when a decision, credential, missing requirement, or user preference blocks progress.",
				"Ask one concrete question at a time and include only the context needed for the parent to answer.",
				"Wait for the returned feedback before continuing.",
			],
			parameters: AskMainSessionParams,
			execute(_toolCallId, params, signal) {
				const question = params.question.trim();
				const context = params.context?.trim();
				const requestId = `${record.id}-feedback-${++record.feedbackSerial}`;

				return new Promise((resolve) => {
					let settled = false;
					const settle = (status: FeedbackRequestDetails["status"], text: string) => {
						if (settled) {
							return;
						}
						settled = true;
						signal?.removeEventListener("abort", abortHandler);
						if (record.pendingFeedback?.id === requestId) {
							record.pendingFeedback = undefined;
						}
						if (record.status !== "stopped" && record.status !== "failed") {
							record.status = status === "answered" ? "running" : record.status;
						}
						markActivity(record, status === "answered" ? "Received feedback from main session." : text);
						updateStatusWidget();
						resolve({
							content: [{ type: "text", text }],
							details: {
								requestId,
								subagentId: record.id,
								status,
							},
						});
					};

					const abortHandler = () => {
						settle("cancelled", "The feedback request was cancelled because the sub-agent stopped.");
					};

					record.status = "waiting for feedback";
					markActivity(record, `Waiting for feedback: ${question}`);
					record.pendingFeedback = {
						id: requestId,
						question,
						context,
						requestedAt: Date.now(),
						resolve: (feedback: string) => settle("answered", feedback),
						cancel: (reason: string) => settle("cancelled", reason),
					};

					if (signal?.aborted) {
						abortHandler();
						return;
					}

					signal?.addEventListener("abort", abortHandler, { once: true });
					postFeedbackRequest(record, record.pendingFeedback);
					updateStatusWidget();
				});
			},
		};
	}

	function updateFromEvent(record: SubagentRecord, event: AgentSessionEvent): void {
		switch (event.type) {
			case "message_start":
			case "message_update": {
				const streamed = extractEventAssistantText(event.message);
				if (streamed) {
					markActivity(record, streamed);
				}
				break;
			}
			case "message_end": {
				const text = extractEventAssistantText(event.message);
				if (text) {
					markActivity(record, text);
				}
				break;
			}
			case "tool_execution_start": {
				record.toolCalls.set(event.toolCallId, {
					name: event.toolName,
					startedAt: Date.now(),
					status: "running",
				});
				markActivity(record, `Running tool: ${event.toolName}`);
				break;
			}
			case "tool_execution_update": {
				markActivity(record, `Tool update: ${event.toolName}`);
				break;
			}
			case "tool_execution_end": {
				const tool = record.toolCalls.get(event.toolCallId);
				if (tool) {
					tool.status = event.isError ? "failed" : "done";
				}
				markActivity(record, `${event.toolName} ${event.isError ? "failed" : "finished"}`);
				break;
			}
			case "turn_end": {
				markActivity(record, "Turn finished.");
				break;
			}
			case "compaction_end": {
				markActivity(record, event.aborted ? "Compaction aborted." : "Compaction finished.");
				break;
			}
			default:
				updateRecordContextUsage(record);
		}

		updateStatusWidget();
	}

	function getSubagentTools(record: SubagentRecord): string[] {
		if (record.role) {
			return [...new Set([...record.role.tools, "ask_main_session"])];
		}

		const activeTools = pi.getActiveTools().filter((name) => SUBAGENT_TOOL_NAMES.has(name));
		const baseTools = activeTools.length > 0 ? activeTools : DEFAULT_TOOLS;
		return [...new Set([...baseTools, "ask_main_session"])];
	}

	function resolveSubagentModel(ctx: ExtensionContext, role?: SubagentRole): Model<any> {
		if (!role?.model) {
			if (!ctx.model) {
				throw new Error("No active model selected.");
			}
			return ctx.model;
		}

		const model = ctx.modelRegistry.find(role.model.provider, role.model.modelId);
		if (!model) {
			throw new Error(`Role "${role.name}" requires model ${role.model.label}, but it is not configured.`);
		}
		return model;
	}

	function createSubagentRecord(parsed: ParsedStartArgs, ctx: ExtensionContext): SubagentRecord {
		const record: SubagentRecord = {
			id: `sa-${nextSubagentNumber++}`,
			name: parsed.name,
			task: parsed.task,
			role: parsed.role,
			status: "starting",
			startedAt: Date.now(),
			activity: "Queued.",
			feedbackSerial: 0,
			toolCalls: new Map(),
			notifyOnCompletion: parsed.notifyOnCompletion ?? true,
		};
		records.set(record.id, record);
		updateStatusWidget(ctx);

		if (parsed.notifyOnStart ?? true) {
			postStatusMessage(
				[
					`Started sub-agent ${record.name} (${record.id}).`,
					record.role ? `Role: ${record.role.name}` : "",
					`Task: ${record.task}`,
				]
					.filter(Boolean)
					.join("\n\n"),
			);
		}
		const completion = runSubagent(record, ctx);
		record.completion = completion;
		void completion;
		return record;
	}

	async function runSubagent(record: SubagentRecord, ctx: ExtensionContext): Promise<void> {
		try {
			const model = resolveSubagentModel(ctx, record.role);
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				throw new Error(auth.error || `No credentials available for ${model.provider}/${model.id}.`);
			}

			markActivity(record, record.role ? `Creating ${record.role.name} background Pi session.` : "Creating background Pi session.");
			const { session } = await createAgentSession({
				cwd: ctx.cwd,
				sessionManager: SessionManager.inMemory(ctx.cwd),
				model,
				modelRegistry: ctx.modelRegistry as AgentSession["modelRegistry"],
				thinkingLevel: record.role?.thinking ?? (pi.getThinkingLevel() as SessionThinkingLevel),
				tools: getSubagentTools(record),
				customTools: [createAskMainSessionTool(record) as unknown as ToolDefinition],
				resourceLoader: createSubagentResourceLoader(ctx, record),
			});

			record.session = session;
			record.unsubscribe = session.subscribe((event) => updateFromEvent(record, event));
			seedMainContext(record, session, ctx);

			record.status = "running";
			markActivity(record, "Started background task.");
			updateStatusWidget();

			await session.prompt(record.task, { source: "extension" });

			if (hasStatus(record, "stopped")) {
				return;
			}

			const response = getLastAssistantMessage(session);
			if (!response) {
				throw new Error("Sub-agent finished without an assistant response.");
			}
			if (response.stopReason === "aborted") {
				record.status = "stopped";
				record.finishedAt = Date.now();
				markActivity(record, "Stopped.");
				return;
			}
			if (response.stopReason === "error") {
				throw new Error(response.errorMessage || "Sub-agent request failed.");
			}

			record.result = extractText(response.content) || "(No text response)";
			record.status = "completed";
			record.finishedAt = Date.now();
			markActivity(record, "Completed.");
			if (record.notifyOnCompletion) {
				postStatusMessage(`Sub-agent ${record.name} (${record.id}) completed.\n\n${record.result}`);
			}
		} catch (error) {
			if (record.status === "stopped") {
				return;
			}
			record.error = error instanceof Error ? error.message : String(error);
			record.status = "failed";
			record.finishedAt = Date.now();
			markActivity(record, "Failed.");
			if (record.notifyOnCompletion) {
				postStatusMessage(`Sub-agent ${record.name} (${record.id}) failed.\n\n${record.error}`);
			}
		} finally {
			record.pendingFeedback?.cancel("The sub-agent is no longer running.");
			updateRecordContextUsage(record);
			record.unsubscribe?.();
			record.unsubscribe = undefined;
			record.session?.dispose();
			record.session = undefined;
			updateStatusWidget();
		}
	}

	async function startSubagent(args: string, ctx: ExtensionCommandContext): Promise<void> {
		const parsed = parseStartArgs(args, rolesByName);
		if (!parsed) {
			ctx.ui.notify("Usage: /subagent start <task> or /subagent start <role> <task>", "warning");
			return;
		}

		createSubagentRecord(parsed, ctx);
	}

	function statusForTool(record: SubagentRecord): StartSubagentDetails["status"] {
		if (record.status === "waiting for feedback") {
			return "waiting_for_feedback";
		}
		if (record.status === "starting" || record.status === "running") {
			return "started";
		}
		return record.status;
	}

	function detailsForRecord(record: SubagentRecord): StartSubagentDetails {
		return {
			status: statusForTool(record),
			subagentStatus: record.status,
			subagentId: record.id,
			name: record.name,
			role: record.role?.name,
			task: record.task,
			command: `/subagent view ${record.id}`,
			activity: record.activity,
			elapsed: elapsedFor(record),
			result: record.result,
			error: record.error,
		};
	}

	function formatStartSubagentCall(args: { role?: string; task?: string; name?: string }): string {
		const role = args.role?.trim() || "default";
		const name = args.name?.trim();
		const task = args.task?.trim() || "(no task)";
		return `start_subagent ${role}${name ? ` ${name}` : ""}: ${singleLine(task, 120)}`;
	}

	function formatStartSubagentSummary(details: StartSubagentDetails): string {
		if (details.status === "error") {
			return `start_subagent error: ${details.error ?? "unknown error"}`;
		}

		const id = details.subagentId ?? "?";
		const name = details.name ?? "sub-agent";
		const status = details.subagentStatus ?? details.status;
		const task = details.task ? ` | ${singleLine(details.task, 100)}` : "";
		return `${name} (${id}) ${status}${details.elapsed ? ` in ${details.elapsed}` : ""}${task}`;
	}

	function formatStartSubagentExpanded(details: StartSubagentDetails, contentText: string): string {
		const lines = [
			formatStartSubagentSummary(details),
			details.command ? `Inspect: ${details.command}` : "",
			details.activity ? `Latest: ${details.activity}` : "",
		].filter(Boolean);

		if (contentText.trim()) {
			lines.push("", contentText.trim());
		}

		return lines.join("\n");
	}

	function waitForSubagentHandoff(record: SubagentRecord, signal: AbortSignal | undefined): Promise<void> {
		if (!isWorkingStatus(record.status)) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			let settled = false;
			let interval: ReturnType<typeof setInterval> | undefined;

			const cleanup = () => {
				if (interval) {
					clearInterval(interval);
				}
				signal?.removeEventListener("abort", abortHandler);
			};

			const finish = () => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				resolve();
			};

			const fail = (error: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				cleanup();
				reject(error);
			};

			const check = () => {
				if (!isWorkingStatus(record.status)) {
					finish();
				}
			};

			const abortHandler = () => {
				fail(new Error(`Stopped waiting for sub-agent ${record.id}; it is still ${record.status}.`));
			};

			if (signal?.aborted) {
				abortHandler();
				return;
			}

			signal?.addEventListener("abort", abortHandler, { once: true });
			interval = setInterval(check, 250);
			record.completion?.finally(check);
			check();
		});
	}

	async function startSubagentFromTool(
		params: { role?: string; task: string; name?: string },
		ctx: ExtensionContext,
		signal: AbortSignal | undefined,
	): Promise<StartSubagentDetails> {
		const task = params.task.trim();
		if (!task) {
			return {
				status: "error",
				error: "task is required.",
				availableRoles: roles.map((role) => role.name),
			};
		}

		const roleName = params.role?.trim();
		const role = roleName ? rolesByName.get(roleName.toLowerCase()) : undefined;
		if (roleName && !role) {
			return {
				status: "error",
				error: `Unknown sub-agent role "${roleName}".`,
				availableRoles: roles.map((candidate) => candidate.name),
			};
		}

		const displayName = params.name?.trim() || role?.name || deriveName(task);
		const record = createSubagentRecord({ name: displayName, task, role, notifyOnStart: false, notifyOnCompletion: false }, ctx);
		await waitForSubagentHandoff(record, signal);
		return detailsForRecord(record);
	}

	async function stopSubagent(id: string, ctx: ExtensionCommandContext): Promise<void> {
		const found = findRecord(id);
		if (!found.record) {
			ctx.ui.notify(found.error ?? "Sub-agent not found.", "warning");
			return;
		}

		const record = found.record;
		if (record.status === "completed" || record.status === "failed" || record.status === "stopped") {
			ctx.ui.notify(`Sub-agent ${record.id} is already ${record.status}.`, "info");
			return;
		}

		record.status = "stopped";
		record.finishedAt = Date.now();
		record.pendingFeedback?.cancel("The main session stopped this sub-agent.");
		markActivity(record, "Stopped by main session.");
		updateStatusWidget();

		try {
			await record.session?.abort();
		} catch (error) {
			record.error = error instanceof Error ? error.message : String(error);
		} finally {
			record.unsubscribe?.();
			record.unsubscribe = undefined;
			record.session?.dispose();
			record.session = undefined;
		}

		postStatusMessage(`Stopped sub-agent ${record.name} (${record.id}).`);
	}

	function replyToSubagent(args: string, ctx: ExtensionCommandContext): void {
		const { command: id, rest: feedback } = splitCommand(args);
		if (!id || !feedback) {
			ctx.ui.notify("Usage: /subagent reply <id> <feedback>", "warning");
			return;
		}

		const found = findRecord(id);
		if (!found.record) {
			ctx.ui.notify(found.error ?? "Sub-agent not found.", "warning");
			return;
		}

		const record = found.record;
		if (!record.pendingFeedback) {
			ctx.ui.notify(`Sub-agent ${record.id} is not waiting for feedback.`, "warning");
			return;
		}

		record.pendingFeedback.resolve(feedback.trim());
		postStatusMessage(`Sent feedback to sub-agent ${record.name} (${record.id}).`);
	}

	function formatRecordDetails(record: SubagentRecord): string {
		const lines = [
			`Sub-agent ${record.id}: ${record.name}`,
			record.role ? `Role: ${record.role.name}` : undefined,
			`Status: ${record.status}`,
			`Elapsed: ${elapsedFor(record)}`,
			`Context: ${formatContextUsage(record)}`,
			`Task: ${record.task}`,
			`Latest: ${record.activity}`,
		].filter(Boolean) as string[];

		if (record.pendingFeedback) {
			lines.push(`Waiting for feedback: ${record.pendingFeedback.question}`);
			lines.push(`Reply: /subagent reply ${record.id} <feedback>`);
		}
		if (record.result) {
			lines.push(`Result: ${record.result}`);
		}
		if (record.error) {
			lines.push(`Error: ${record.error}`);
		}

		return lines.join("\n");
	}

	function showStatusView(args: string, ctx: ExtensionCommandContext): void {
		updateStatusWidget(ctx);
		const id = args.trim();
		if (!id) {
			const active = activeRecords();
			const prefix =
				active.length > 0
					? "Sub-agent status is visible below the editor while background work is active."
					: "No sub-agents are currently active.";
			postStatusMessage(`${prefix}\n\n${formatList()}`);
			return;
		}

		const found = findRecord(id);
		if (!found.record) {
			ctx.ui.notify(found.error ?? "Sub-agent not found.", "warning");
			return;
		}

		postStatusMessage(formatRecordDetails(found.record));
	}

	pi.registerCommand("subagent", {
		description:
			"Manage simple background sub-agents. Use `/subagent start <task>`, `/subagent start <role> <task>`, `/subagent agents`, `/subagent list`, `/subagent view [id]`, `/subagent stop <id>`, or `/subagent reply <id> <feedback>`.",
		handler: async (args, ctx) => {
			latestCtx = ctx;
			const { command, rest } = splitCommand(args);
			switch (command) {
				case "start":
					await startSubagent(rest, ctx);
					return;
				case "list":
					updateStatusWidget(ctx);
					postStatusMessage(formatList());
					return;
				case "agents":
					postStatusMessage(`Available sub-agent roles:\n\n${formatRoleList()}`);
					return;
				case "view":
					showStatusView(rest, ctx);
					return;
				case "stop":
					await stopSubagent(rest, ctx);
					return;
				case "reply":
					replyToSubagent(rest, ctx);
					return;
				case "help":
					postStatusMessage(
						[
							"Sub-agent commands:",
							"- /subagent start <task>",
							"- /subagent start <name>: <task>",
							"- /subagent start <role> <task>",
							"- /subagent agents",
							"- /subagent list",
							"- /subagent view [id]",
							"- /subagent stop <id>",
							"- /subagent reply <id> <feedback>",
						].join("\n"),
					);
					return;
				default:
					showStatusView("", ctx);
			}
		},
	});

	pi.registerTool({
		name: "start_subagent",
		label: "Start Subagent",
		description:
			"Start an in-process background Pi sub-agent for delegated work. " +
			"Use this when a planner, reviewer, scout, or worker can make progress independently. " +
			"The tool waits until the sub-agent finishes or asks for feedback, so the main session should use the sub-agent result instead of duplicating the work.",
		promptSnippet:
			"Delegate work to a sub-agent and wait for its result. Roles: planner, scout, reviewer, worker.",
		promptGuidelines: [
			"Use start_subagent when a clearly bounded task should be delegated.",
			"Choose role=scout for read-only codebase mapping, role=planner for plans and todos, role=reviewer for review, and role=worker for implementation.",
			"Wait for this tool's result and synthesize it for the user instead of duplicating the sub-agent's investigation in the main session.",
			"Do not expose implementation parameters or tool details to the user; users can start explicit background jobs with `/subagent start <role> <task>`.",
			"Give the sub-agent a concrete task with enough context to finish without guessing.",
			"Use /subagent view <id> to inspect status, and answer feedback requests with /subagent reply <id> <feedback>.",
		],
		parameters: StartSubagentParams,
		renderCall(args, theme) {
			return new Text(theme.fg("accent", formatStartSubagentCall(args)), 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details as StartSubagentDetails | undefined;
			const firstContent = result.content[0];
			const contentText = firstContent?.type === "text" ? firstContent.text : "";

			if (!details) {
				return new Text(contentText || "(no output)", 0, 0);
			}

			if (expanded) {
				return new Text(formatStartSubagentExpanded(details, contentText), 0, 0);
			}

			const color =
				details.status === "completed"
					? "success"
					: details.status === "failed" || details.status === "error"
						? "error"
						: details.status === "waiting_for_feedback"
							? "warning"
							: "accent";
			const hint = details.command ? ` | expand or run ${details.command}` : "";
			return new Text(`${theme.fg(color, formatStartSubagentSummary(details))}${theme.fg("dim", hint)}`, 0, 0);
		},
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (signal?.aborted) {
				throw new Error("Sub-agent start was cancelled.");
			}

			const details = await startSubagentFromTool(params, ctx, signal);
			let text = `Sub-agent ${details.name} (${details.subagentId}) is ${details.subagentStatus}. Inspect it with ${details.command}.`;
			if (details.status === "completed" && details.result) {
				text = `Sub-agent ${details.name} (${details.subagentId}) completed.\n\n${details.result}`;
			} else if (details.status === "waiting_for_feedback") {
				text = `Sub-agent ${details.name} (${details.subagentId}) needs feedback. Inspect it with ${details.command} and reply with /subagent reply ${details.subagentId} <feedback>.`;
			} else if (details.status === "failed") {
				text = `Sub-agent ${details.name} (${details.subagentId}) failed.\n\n${details.error ?? details.activity ?? "Unknown error"}`;
			} else if (details.status === "error") {
				text = `Error: ${details.error}`;
			}

			return {
				content: [{ type: "text", text }],
				details,
			};
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;
		updateStatusWidget(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		latestCtx = ctx;
		if (ctx.hasUI) {
			ctx.ui.setWidget("subagents", undefined);
			ctx.ui.setStatus("subagents", undefined);
		}
		clearWidgetInterval();
		for (const record of records.values()) {
			if (record.status === "completed" || record.status === "failed" || record.status === "stopped") {
				continue;
			}
			record.status = "stopped";
			record.finishedAt = Date.now();
			record.pendingFeedback?.cancel("The Pi session shut down before feedback arrived.");
			markActivity(record, "Stopped because the main session shut down.");
			try {
				await record.session?.abort();
			} catch (error) {
				record.error = error instanceof Error ? error.message : String(error);
			}
			record.unsubscribe?.();
			record.session?.dispose();
			record.session = undefined;
			record.unsubscribe = undefined;
		}
	});
}
