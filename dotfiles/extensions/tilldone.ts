/**
 * TillDone Extension — Togglable Task Discipline
 *
 * When enabled, the agent MUST define tasks before using other tools.
 * Off by default. Toggle with /tasks (same pattern as question-mode).
 *
 * Commands:
 *   /tasks          - Toggle task mode on/off
 *   /tasks on       - Enable task discipline
 *   /tasks off      - Disable and clear tasks
 *   /tasks status   - Show current state
 *
 * When enabled:
 *   - Agent is blocked until it calls `tilldone add` to define tasks
 *   - Agent must toggle a task to "inprogress" before using other tools
 *   - Persistent widget shows current task below the editor
 *   - Status line shows progress
 *   - Auto-nudge when agent finishes with incomplete tasks
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";

// -- Types ------------------------------------------------------------------

type TaskStatus = "idle" | "inprogress" | "done";

interface Task {
	id: number;
	text: string;
	status: TaskStatus;
}

interface TillDoneState {
	enabled: boolean;
	tasks: Task[];
	nextId: number;
}

interface TillDoneDetails {
	action: string;
	tasks: Task[];
	nextId: number;
	error?: string;
}

const STATUS_ICON: Record<TaskStatus, string> = { idle: "( )", inprogress: "(*)", done: "(x)" };
const NEXT_STATUS: Record<TaskStatus, TaskStatus> = { idle: "inprogress", inprogress: "done", done: "idle" };

// -- Extension --------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	let enabled = false;
	let tasks: Task[] = [];
	let nextId = 1;
	let nudgedThisCycle = false;

	// -- State helpers --------------------------------------------------------

	const makeDetails = (action: string, error?: string): TillDoneDetails => ({
		action,
		tasks: [...tasks],
		nextId,
		...(error ? { error } : {}),
	});

	function persistState() {
		pi.appendEntry<TillDoneState>("tilldone-state", {
			enabled,
			tasks: [...tasks],
			nextId,
		});
	}

	function restoreFromBranch(ctx: ExtensionContext) {
		// Check custom state entries first
		const branchEntries = ctx.sessionManager.getBranch();
		let state: TillDoneState | undefined;

		for (const entry of branchEntries) {
			if (entry.type === "custom" && entry.customType === "tilldone-state") {
				const data = entry.data as TillDoneState | undefined;
				if (data) {
					state = {
						enabled: Boolean(data.enabled),
						tasks: Array.isArray(data.tasks) ? data.tasks : [],
						nextId: typeof data.nextId === "number" ? data.nextId : 1,
					};
				}
			}
			// Also reconstruct from tool results (in case of older entries)
			if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "tilldone") {
				const details = entry.message.details as TillDoneDetails | undefined;
				if (details && state?.enabled) {
					state.tasks = details.tasks;
					state.nextId = details.nextId;
				}
			}
		}

		if (state) {
			enabled = state.enabled;
			tasks = state.tasks;
			nextId = state.nextId;
		} else {
			enabled = false;
			tasks = [];
			nextId = 1;
		}

		refreshUI(ctx);
	}

	// -- UI -------------------------------------------------------------------

	function refreshUI(ctx: ExtensionContext) {
		if (!enabled) {
			ctx.ui.setStatus("tilldone", undefined);
			ctx.ui.setWidget("tilldone-current", undefined);
			return;
		}

		// Status line: compact progress
		const done = tasks.filter((t) => t.status === "done").length;
		const total = tasks.length;

		if (total === 0) {
			ctx.ui.setStatus("tilldone", ctx.ui.theme.fg("warning", "TASKS: none"));
		} else if (done === total) {
			ctx.ui.setStatus("tilldone", ctx.ui.theme.fg("success", `TASKS: ${done}/${total} done`));
		} else {
			ctx.ui.setStatus(
				"tilldone",
				ctx.ui.theme.fg("accent", `TASKS: ${done}/${total}`),
			);
		}

		// Widget: show current inprogress task below editor
		const current = tasks.find((t) => t.status === "inprogress");
		if (!current) {
			ctx.ui.setWidget("tilldone-current", undefined);
			return;
		}

		ctx.ui.setWidget(
			"tilldone-current",
			(_tui, theme) => ({
				render(width: number): string[] {
					const cur = tasks.find((t) => t.status === "inprogress");
					if (!cur) return [];
					const line =
						theme.fg("accent", ">> ") +
						theme.fg("dim", "WORKING ON ") +
						theme.fg("accent", `#${cur.id}`) +
						theme.fg("dim", " - ") +
						theme.fg("success", cur.text);
					return [truncateToWidth(line, width)];
				},
				invalidate() {},
			}),
			{ placement: "belowEditor" },
		);
	}

	// -- Toggle ---------------------------------------------------------------

	function enableTasks(ctx: ExtensionContext) {
		if (enabled) {
			ctx.ui.notify("Task mode is already enabled.", "info");
			return;
		}
		enabled = true;
		persistState();
		refreshUI(ctx);
		ctx.ui.notify("Task mode enabled. Agent must define tasks before working.", "info");
	}

	function disableTasks(ctx: ExtensionContext) {
		if (!enabled) {
			ctx.ui.notify("Task mode is already disabled.", "info");
			return;
		}
		enabled = false;
		tasks = [];
		nextId = 1;
		persistState();
		refreshUI(ctx);
		ctx.ui.notify("Task mode disabled. Tasks cleared.", "info");
	}

	// -- Command: /tasks ------------------------------------------------------

	pi.registerCommand("tasks", {
		description: "Toggle task discipline mode (tilldone)",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();

			if (action === "status") {
				const mode = enabled ? "on" : "off";
				const done = tasks.filter((t) => t.status === "done").length;
				const inprog = tasks.filter((t) => t.status === "inprogress").length;
				const idle = tasks.filter((t) => t.status === "idle").length;
				const lines = [`task-mode:${mode} | ${tasks.length} tasks (${done} done, ${inprog} active, ${idle} idle)`];
				for (const t of tasks) {
					lines.push(`  ${STATUS_ICON[t.status]} #${t.id} ${t.text}`);
				}
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (action === "on" || action === "enable") {
				enableTasks(ctx);
				return;
			}

			if (action === "off" || action === "disable") {
				disableTasks(ctx);
				return;
			}

			if (action === "" || action === "toggle") {
				if (enabled) {
					disableTasks(ctx);
				} else {
					enableTasks(ctx);
				}
				return;
			}

			ctx.ui.notify("Usage: /tasks [on|off|toggle|status]", "warning");
		},
	});

	// -- Blocking gate --------------------------------------------------------

	pi.on("tool_call", async (event): Promise<ToolCallEventResult | undefined> => {
		if (!enabled) return undefined;
		if (event.toolName === "tilldone") return undefined;

		const pending = tasks.filter((t) => t.status !== "done");
		const active = tasks.filter((t) => t.status === "inprogress");

		if (tasks.length === 0) {
			return {
				block: true,
				reason:
					"[Task Mode] No tasks defined. You MUST use `tilldone add` to define your tasks before using any other tools. Plan your work first.",
			};
		}
		if (pending.length === 0) {
			return {
				block: true,
				reason:
					"[Task Mode] All tasks are done. Use `tilldone add` for new tasks before using other tools.",
			};
		}
		if (active.length === 0) {
			return {
				block: true,
				reason:
					"[Task Mode] No task is in progress. Use `tilldone toggle` to mark a task as inprogress before doing any work.",
			};
		}

		return undefined;
	});

	// -- System prompt injection when enabled ---------------------------------

	pi.on("before_agent_start", async () => {
		if (!enabled) return undefined;

		const taskList = tasks
			.map((t) => `  ${STATUS_ICON[t.status]} #${t.id} (${t.status}): ${t.text}`)
			.join("\n");

		const content = tasks.length > 0
			? `[TASK MODE ACTIVE]\nYou have a task list managed by the tilldone tool. Current tasks:\n\n${taskList}\n\nRules:\n- Always toggle a task to inprogress before starting work on it.\n- Toggle to done when finished.\n- Only one task can be inprogress at a time.\n- Work through tasks systematically.`
			: `[TASK MODE ACTIVE]\nTask discipline is enabled but no tasks are defined yet.\nYou MUST use the tilldone tool to add tasks before using any other tools.\nParse the user's request into concrete tasks.`;

		return {
			message: {
				customType: "tilldone-context",
				content,
				display: false,
			},
		};
	});

	// -- Auto-nudge on agent_end ----------------------------------------------

	pi.on("agent_end", async () => {
		if (!enabled) return;

		const incomplete = tasks.filter((t) => t.status !== "done");
		if (incomplete.length === 0 || nudgedThisCycle) return;

		nudgedThisCycle = true;

		const taskList = incomplete
			.map((t) => `  ${STATUS_ICON[t.status]} #${t.id} (${t.status}): ${t.text}`)
			.join("\n");

		pi.sendMessage(
			{
				customType: "tilldone-nudge",
				content: `You still have ${incomplete.length} incomplete task(s):\n\n${taskList}\n\nContinue working on them or mark them done with tilldone toggle.`,
				display: true,
			},
			{ triggerTurn: true },
		);
	});

	pi.on("input", async () => {
		nudgedThisCycle = false;
		return { action: "continue" as const };
	});

	// -- Register tilldone tool -----------------------------------------------

	const TillDoneParams = Type.Object({
		action: StringEnum(["add", "toggle", "remove", "update", "list", "clear"] as const),
		text: Type.Optional(Type.String({ description: "Task text (for add/update)" })),
		texts: Type.Optional(Type.Array(Type.String(), { description: "Multiple task texts (for batch add)" })),
		id: Type.Optional(Type.Number({ description: "Task ID (for toggle/remove/update)" })),
	});

	pi.registerTool({
		name: "tilldone",
		label: "TillDone",
		description:
			"Manage the task list. Actions: add (text or texts[] for batch), toggle (id) cycles idle->inprogress->done, remove (id), update (id + text), list, clear. " +
			"You MUST add tasks before using any other tools when task mode is active. " +
			"Always toggle a task to inprogress before starting work on it, and to done when finished.",

		promptSnippet:
			"Manage the task list. Actions: add (text or texts[] for batch), toggle (id) cycles idle->inprogress->done, " +
			"remove (id), update (id + text), list, clear. You MUST add tasks before using any other tools when task mode is active. " +
			"Always toggle a task to inprogress before starting work on it, and to done when finished.",

		promptGuidelines: [
			"When task mode is active, call tilldone add before using any other tools.",
			"Toggle a task to inprogress before starting work on it, and to done when finished.",
			"Only one task can be inprogress at a time; toggling a new task auto-pauses the current one.",
			"Use texts[] for batch adding multiple tasks in a single call.",
		],

		parameters: TillDoneParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "add": {
					const items = params.texts?.length ? params.texts : params.text ? [params.text] : [];
					if (items.length === 0) {
						return {
							content: [{ type: "text" as const, text: "Error: text or texts required for add" }],
							details: makeDetails("add", "text required"),
						};
					}
					const added: Task[] = [];
					for (const item of items) {
						const t: Task = { id: nextId++, text: item, status: "idle" };
						tasks.push(t);
						added.push(t);
					}
					const msg = added.length === 1
						? `Added task #${added[0].id}: ${added[0].text}`
						: `Added ${added.length} tasks: ${added.map((t) => `#${t.id}`).join(", ")}`;
					refreshUI(ctx);
					persistState();
					return {
						content: [{ type: "text" as const, text: msg }],
						details: makeDetails("add"),
					};
				}

				case "toggle": {
					if (params.id === undefined) {
						return {
							content: [{ type: "text" as const, text: "Error: id required for toggle" }],
							details: makeDetails("toggle", "id required"),
						};
					}
					const task = tasks.find((t) => t.id === params.id);
					if (!task) {
						return {
							content: [{ type: "text" as const, text: `Task #${params.id} not found` }],
							details: makeDetails("toggle", `#${params.id} not found`),
						};
					}
					const prev = task.status;
					task.status = NEXT_STATUS[task.status];

					// Enforce single inprogress
					const demoted: Task[] = [];
					if (task.status === "inprogress") {
						for (const t of tasks) {
							if (t.id !== task.id && t.status === "inprogress") {
								t.status = "idle";
								demoted.push(t);
							}
						}
					}

					let msg = `Task #${task.id}: ${prev} -> ${task.status}`;
					if (demoted.length > 0) {
						msg += `\n(Auto-paused ${demoted.map((t) => `#${t.id}`).join(", ")} -> idle. Only one task can be inprogress at a time.)`;
					}
					refreshUI(ctx);
					persistState();
					return {
						content: [{ type: "text" as const, text: msg }],
						details: makeDetails("toggle"),
					};
				}

				case "remove": {
					if (params.id === undefined) {
						return {
							content: [{ type: "text" as const, text: "Error: id required for remove" }],
							details: makeDetails("remove", "id required"),
						};
					}
					const idx = tasks.findIndex((t) => t.id === params.id);
					if (idx === -1) {
						return {
							content: [{ type: "text" as const, text: `Task #${params.id} not found` }],
							details: makeDetails("remove", `#${params.id} not found`),
						};
					}
					const removed = tasks.splice(idx, 1)[0];
					refreshUI(ctx);
					persistState();
					return {
						content: [{ type: "text" as const, text: `Removed task #${removed.id}: ${removed.text}` }],
						details: makeDetails("remove"),
					};
				}

				case "update": {
					if (params.id === undefined || !params.text) {
						return {
							content: [{ type: "text" as const, text: "Error: id and text required for update" }],
							details: makeDetails("update", "id and text required"),
						};
					}
					const toUpdate = tasks.find((t) => t.id === params.id);
					if (!toUpdate) {
						return {
							content: [{ type: "text" as const, text: `Task #${params.id} not found` }],
							details: makeDetails("update", `#${params.id} not found`),
						};
					}
					const oldText = toUpdate.text;
					toUpdate.text = params.text;
					refreshUI(ctx);
					persistState();
					return {
						content: [{ type: "text" as const, text: `Updated #${toUpdate.id}: "${oldText}" -> "${toUpdate.text}"` }],
						details: makeDetails("update"),
					};
				}

				case "list": {
					const result = {
						content: [{
							type: "text" as const,
							text: tasks.length
								? tasks.map((t) => `${STATUS_ICON[t.status]} #${t.id} (${t.status}): ${t.text}`).join("\n")
								: "No tasks defined yet.",
						}],
						details: makeDetails("list"),
					};
					refreshUI(ctx);
					return result;
				}

				case "clear": {
					if (tasks.length > 0) {
						const confirmed = await ctx.ui.confirm(
							"Clear all tasks?",
							`This will remove all ${tasks.length} task(s). Continue?`,
							{ timeout: 30000 },
						);
						if (!confirmed) {
							return {
								content: [{ type: "text" as const, text: "Clear cancelled by user." }],
								details: makeDetails("clear", "cancelled"),
							};
						}
					}
					const count = tasks.length;
					tasks = [];
					nextId = 1;
					refreshUI(ctx);
					persistState();
					return {
						content: [{ type: "text" as const, text: `Cleared ${count} task(s)` }],
						details: makeDetails("clear"),
					};
				}

				default:
					return {
						content: [{ type: "text" as const, text: `Unknown action: ${params.action}` }],
						details: makeDetails("list", `unknown action: ${params.action}`),
					};
			}
		},
	});

	// -- Session lifecycle ----------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx);
	});

}
