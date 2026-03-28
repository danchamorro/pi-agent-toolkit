import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";

const QUESTION_MODE_TOOLS = ["read", "grep", "find", "ls", "mcp", "exa_search"] as const;
const FALLBACK_TOOLS = ["read", "bash", "edit", "write"] as const;

interface QuestionModeState {
	enabled: boolean;
	restoreTools: string[];
}

function normalizeTools(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
	return input.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export default function questionModeExtension(pi: ExtensionAPI): void {
	let enabled = false;
	let restoreTools: string[] = [];

	function getAvailableToolNames(): Set<string> {
		return new Set(pi.getAllTools().map((tool) => tool.name));
	}

	function filterAvailableTools(tools: readonly string[]): string[] {
		const available = getAvailableToolNames();
		return tools.filter((tool) => available.has(tool));
	}

	function getQuestionModeTools(): string[] {
		const preferred = filterAvailableTools(QUESTION_MODE_TOOLS);
		if (preferred.length > 0) return preferred;

		const current = pi.getActiveTools();
		if (current.length > 0) return current;

		return filterAvailableTools(FALLBACK_TOOLS);
	}

	function getRestoreTools(): string[] {
		const candidate = restoreTools.length > 0 ? restoreTools : Array.from(FALLBACK_TOOLS);
		const filtered = filterAvailableTools(candidate);

		if (filtered.length > 0) return filtered;

		const current = pi.getActiveTools();
		return current.length > 0 ? current : ["read"];
	}

	function applyQuestionModeTools(): string[] {
		const tools = getQuestionModeTools();
		if (tools.length > 0) {
			pi.setActiveTools(tools);
		}
		return tools;
	}

	function applyRestoreTools(): string[] {
		const tools = getRestoreTools();
		if (tools.length > 0) {
			pi.setActiveTools(tools);
		}
		return tools;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (enabled) {
			ctx.ui.setStatus("question-mode", "question-mode:on");
		} else {
			ctx.ui.setStatus("question-mode", undefined);
		}
	}

	function persistState(): void {
		pi.appendEntry<QuestionModeState>("question-mode-state", {
			enabled,
			restoreTools,
		});
	}

	function restoreFromBranch(ctx: ExtensionContext): void {
		const branchEntries = ctx.sessionManager.getBranch();
		let state: QuestionModeState | undefined;

		for (const entry of branchEntries) {
			if (entry.type === "custom" && entry.customType === "question-mode-state") {
				const data = entry.data as QuestionModeState | undefined;
				if (data) {
					state = {
						enabled: Boolean(data.enabled),
						restoreTools: normalizeTools(data.restoreTools),
					};
				}
			}
		}

		if (!state) {
			enabled = false;
			restoreTools = [];
			updateStatus(ctx);
			return;
		}

		enabled = state.enabled;
		restoreTools = state.restoreTools;

		if (enabled) {
			applyQuestionModeTools();
		}

		updateStatus(ctx);
	}

	function getStatusSummary(): string {
		const mode = enabled ? "on" : "off";
		const tools = pi.getActiveTools();
		return `question-mode:${mode} | active tools: ${tools.join(", ")}`;
	}

	function enableQuestionMode(ctx: ExtensionContext): void {
		if (enabled) {
			ctx.ui.notify("Question mode is already enabled.", "info");
			return;
		}

		restoreTools = pi.getActiveTools();
		enabled = true;
		const tools = applyQuestionModeTools();
		persistState();
		updateStatus(ctx);
		ctx.ui.notify(`Question mode enabled. Tools: ${tools.join(", ")}`, "info");
	}

	function disableQuestionMode(ctx: ExtensionContext): void {
		if (!enabled) {
			ctx.ui.notify("Question mode is already disabled.", "info");
			return;
		}

		enabled = false;
		const restored = applyRestoreTools();
		persistState();
		updateStatus(ctx);
		ctx.ui.notify(`Question mode disabled. Restored tools: ${restored.join(", ")}`, "info");
	}

	pi.registerShortcut(Key.ctrl("q"), {
		description: "Toggle question mode",
		handler: (ctx) => {
			if (enabled) {
				disableQuestionMode(ctx);
			} else {
				enableQuestionMode(ctx);
			}
		},
	});

	pi.registerCommand("question-mode", {
		description: "Toggle strict read-only Q&A mode (no edits, no bash)",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (action === "status") {
				ctx.ui.notify(getStatusSummary(), "info");
				return;
			}

			if (action === "on" || action === "enable") {
				enableQuestionMode(ctx);
				return;
			}

			if (action === "off" || action === "disable") {
				disableQuestionMode(ctx);
				return;
			}

			if (action === "" || action === "toggle") {
				if (enabled) {
					disableQuestionMode(ctx);
				} else {
					enableQuestionMode(ctx);
				}
				return;
			}

			ctx.ui.notify("Usage: /question-mode [on|off|toggle|status]", "warning");
		},
	});

	pi.on("tool_call", async (event): Promise<ToolCallEventResult | undefined> => {
		if (!enabled) return undefined;

		if (event.toolName === "edit" || event.toolName === "write") {
			return {
				block: true,
				reason: "Question mode blocks file modifications. Disable with /question-mode off to make changes.",
			};
		}

		if (event.toolName === "bash") {
			return {
				block: true,
				reason: "Question mode blocks bash to keep exploration read-only.",
			};
		}

		return undefined;
	});

	pi.on("before_agent_start", async () => {
		if (!enabled) return undefined;

		return {
			message: {
				customType: "question-mode-context",
				content: `[QUESTION MODE ACTIVE]\nYou are answering a user question in strict read-only mode.\n\nRules:\n- Focus on explanation and analysis.\n- Do not edit or create files.\n- Do not run shell commands that modify files, install dependencies, or change git state.\n- Use only available read-only tools to gather evidence.\n- For codebase discovery, audits, and cross-referencing, prefer augment_context_engine over exhaustive ls/Read traversals.\n- If code changes would help, describe them as a follow-up and ask for confirmation first.`,
				display: false,
			},
		};
	});

	pi.on("turn_start", async (_event, ctx) => {
		if (!enabled) return;

		applyQuestionModeTools();
		updateStatus(ctx);
		persistState();
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	pi.on("session_fork", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});
}
