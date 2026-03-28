/**
 * Damage Control Extension
 *
 * Real-time safety auditing that intercepts dangerous bash patterns and
 * enforces path-based access controls. Rules are loaded from YAML config.
 *
 * Config locations (merged, project-local extends global):
 *   ~/.pi/agent/damage-control-rules.yaml  (global)
 *   .pi/damage-control-rules.yaml          (project-local)
 *
 * Commands:
 *   /dc       - Show loaded rule counts and last block/ask events
 *   /dc rules - Show all loaded rules in detail
 */

import type { ExtensionAPI, ExtensionContext, ToolCallEventResult } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

// -- Types ------------------------------------------------------------------

interface BashPattern {
	pattern: string;
	reason: string;
	ask?: boolean;
	allow?: boolean;
	_compiled?: RegExp;
}

interface DamageControlRules {
	bashToolPatterns: BashPattern[];
	zeroAccessPaths: string[];
	askAccessPaths: string[];
	readOnlyPaths: string[];
	noDeletePaths: string[];
}

interface BlockEvent {
	timestamp: number;
	type: "bash" | "path";
	detail: string;
	action: "blocked" | "asked" | "allowed";
}

// -- Helpers ----------------------------------------------------------------

const HOME = homedir();

function expandHome(p: string): string {
	if (p.startsWith("~/")) return resolve(HOME, p.slice(2));
	if (p === "~") return HOME;
	return p;
}

/**
 * Simple glob matcher for path rules. Supports:
 *   *          - matches any sequence (non-slash for basename, any for full)
 *   ~/         - home directory expansion
 *   trailing / - directory prefix match
 */
function pathMatches(filePath: string, pattern: string): boolean {
	const expanded = expandHome(pattern);

	// Directory rule: match the directory itself or anything beneath it
	if (expanded.endsWith("/")) {
		const dir = expanded.replace(/\/+$/, "");
		const norm = filePath.startsWith("/") ? filePath : resolve(filePath);
		return (
			norm === dir ||
			norm === `${dir}/` ||
			norm.startsWith(`${dir}/`) ||
			norm.includes(`/${dir}/`) ||
			norm.endsWith(`/${dir}`)
		);
	}

	// Glob pattern (contains *)
	if (expanded.includes("*")) {
		const regexStr = expanded
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*");
		const regex = new RegExp(`(^|/)${regexStr}$`);
		const norm = filePath.startsWith("/") ? filePath : resolve(filePath);
		// Match against full path and also just the basename
		return regex.test(norm) || regex.test(basename(filePath));
	}

	// Exact match against basename or full path
	const norm = filePath.startsWith("/") ? filePath : resolve(filePath);
	const name = basename(filePath);
	return name === expanded || norm === expanded || norm.endsWith("/" + expanded);
}

function loadRulesFile(path: string): Partial<DamageControlRules> | null {
	if (!existsSync(path)) return null;
	try {
		const content = readFileSync(path, "utf-8");
		return parseYaml(content) as Partial<DamageControlRules>;
	} catch {
		return null;
	}
}

function mergeRules(...sources: (Partial<DamageControlRules> | null)[]): DamageControlRules {
	const merged: DamageControlRules = {
		bashToolPatterns: [],
		zeroAccessPaths: [],
		askAccessPaths: [],
		readOnlyPaths: [],
		noDeletePaths: [],
	};

	for (const src of sources) {
		if (!src) continue;
		if (src.bashToolPatterns) merged.bashToolPatterns.push(...src.bashToolPatterns);
		if (src.zeroAccessPaths) merged.zeroAccessPaths.push(...src.zeroAccessPaths);
		if (src.askAccessPaths) merged.askAccessPaths.push(...src.askAccessPaths);
		if (src.readOnlyPaths) merged.readOnlyPaths.push(...src.readOnlyPaths);
		if (src.noDeletePaths) merged.noDeletePaths.push(...src.noDeletePaths);
	}

	// Deduplicate paths
	merged.zeroAccessPaths = [...new Set(merged.zeroAccessPaths)];
	merged.askAccessPaths = [...new Set(merged.askAccessPaths)];
	merged.readOnlyPaths = [...new Set(merged.readOnlyPaths)];
	merged.noDeletePaths = [...new Set(merged.noDeletePaths)];

	// Compile regexes
	for (const bp of merged.bashToolPatterns) {
		try {
			bp._compiled = new RegExp(bp.pattern);
		} catch {
			// Skip invalid patterns
		}
	}

	return merged;
}

// -- Extension --------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	let rules: DamageControlRules = mergeRules();
	const recentEvents: BlockEvent[] = [];
	const MAX_RECENT = 20;

	function recordEvent(evt: BlockEvent) {
		recentEvents.unshift(evt);
		if (recentEvents.length > MAX_RECENT) recentEvents.pop();
	}

	function loadAllRules(cwd: string) {
		const globalPath = resolve(HOME, ".pi/agent/damage-control-rules.yaml");
		const projectPath = resolve(cwd, ".pi/damage-control-rules.yaml");

		const globalRules = loadRulesFile(globalPath);
		const projectRules = loadRulesFile(projectPath);

		rules = mergeRules(globalRules, projectRules);
	}

	// -- Bash pattern checking ------------------------------------------------

	function checkBash(command: string): { match: BashPattern; isAsk: boolean } | null {
		// Pass 1: allow rules -- if any match, the command is explicitly permitted.
		// Allow always wins over block/ask regardless of rule order in YAML.
		for (const bp of rules.bashToolPatterns) {
			if (!bp._compiled || !bp.allow) continue;
			if (bp._compiled.test(command)) return null;
		}

		// Pass 2: block/ask rules
		let askMatch: BashPattern | null = null;

		for (const bp of rules.bashToolPatterns) {
			if (!bp._compiled || bp.allow) continue;
			if (!bp._compiled.test(command)) continue;

			// Hard-block wins immediately -- no need to check further
			if (!bp.ask) return { match: bp, isAsk: false };

			// Remember the first ask match as fallback
			if (!askMatch) askMatch = bp;
		}

		if (askMatch) return { match: askMatch, isAsk: true };
		return null;
	}

	function extractCommandPathCandidates(command: string): string[] {
		const candidates = new Set<string>();
		const tokens = command.match(/"[^"]*"|'[^']*'|`[^`]*`|\S+/g) ?? [];

		for (const token of tokens) {
			const stripped = token
				.trim()
				.replace(/^["'`]+|["'`]+$/g, "")
				.replace(/[;,]+$/g, "");

			if (!stripped || stripped === "-" || stripped.startsWith("-")) continue;

			candidates.add(stripped);

			const equalsIndex = stripped.indexOf("=");
			if (equalsIndex > 0 && equalsIndex < stripped.length - 1) {
				candidates.add(stripped.slice(equalsIndex + 1));
			}
		}

		return [...candidates];
	}

	function getBashPathAccess(command: string): { path: string; access: PathAccess } | null {
		for (const candidate of extractCommandPathCandidates(command)) {
			const access = checkPathAccess(candidate);
			if (access === "zero") return { path: candidate, access };
			if (shouldAskPathAccess(candidate)) return { path: candidate, access: "ask" };
		}
		return null;
	}

	// -- Path access checking -------------------------------------------------

	type PathAccess = "zero" | "ask" | "readOnly" | "noDelete" | "allowed";

	function isNodeModulesPath(filePath: string): boolean {
		return pathMatches(filePath, "node_modules/");
	}

	function shouldSkipReadConfirmation(filePath: string): boolean {
		return isNodeModulesPath(filePath);
	}

	function shouldAskPathAccess(filePath: string): boolean {
		return rules.askAccessPaths.some((p) => pathMatches(filePath, p));
	}

	function checkPathAccess(filePath: string): PathAccess {
		if (rules.zeroAccessPaths.some((p) => pathMatches(filePath, p))) return "zero";
		if (rules.readOnlyPaths.some((p) => pathMatches(filePath, p))) return "readOnly";
		if (rules.noDeletePaths.some((p) => pathMatches(filePath, p))) return "noDelete";
		return "allowed";
	}

	async function confirmPathAccess(kind: "read" | "bash", target: string, preview: string, ctx: ExtensionContext): Promise<boolean> {
		recordEvent({
			timestamp: Date.now(),
			type: "path",
			detail: `ask ${kind}: ${target}`,
			action: "asked",
		});

		if (!ctx.hasUI) return false;

		const noun = kind === "read" ? "read from" : "access via bash";
		const choice = await ctx.ui.select(
			`[Damage Control] ${target} requires confirmation before the agent can ${noun} it.\n\n  ${preview}\n\nAllow this access?`,
			["Yes, allow once", "No, block it"],
		);

		if (choice === "Yes, allow once") {
			recordEvent({
				timestamp: Date.now(),
				type: "path",
				detail: `ask ${kind}: ${target}`,
				action: "allowed",
			});
			return true;
		}

		return false;
	}

	// Determine if the tool operation is a "delete" (rm via bash is handled separately)
	function isDeleteOperation(toolName: string, input: Record<string, unknown>): boolean {
		// write with empty content to a noDelete path could be destructive
		// but the main delete vector is bash rm, which is caught by bash patterns
		return false;
	}

	// -- Load rules on session start ------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		loadAllRules(ctx.cwd);
		const total =
			rules.bashToolPatterns.length +
			rules.zeroAccessPaths.length +
			rules.askAccessPaths.length +
			rules.readOnlyPaths.length +
			rules.noDeletePaths.length;
		if (total > 0) {
			ctx.ui.setStatus("damage-control", ctx.ui.theme.fg("success", "DC"));
		}
	});

	// -- Intercept tool calls -------------------------------------------------

	pi.on("tool_call", async (event, ctx): Promise<ToolCallEventResult | undefined> => {
		// --- Bash commands ---
		if (isToolCallEventType("bash", event)) {
			const cmd = event.input.command;
			const pathAccess = getBashPathAccess(cmd);
			if (pathAccess?.access === "zero") {
				recordEvent({
					timestamp: Date.now(),
					type: "path",
					detail: `zero-access bash target: ${pathAccess.path}`,
					action: "blocked",
				});
				ctx.ui.notify(`[DC] Blocked bash access: ${pathAccess.path} (zero-access)`, "error");
				return {
					block: true,
					reason: `Damage Control: bash command targets zero-access path "${pathAccess.path}". Access is not permitted.`,
				};
			}

			if (pathAccess?.access === "ask") {
				const allowed = await confirmPathAccess("bash", pathAccess.path, cmd, ctx);
				if (!allowed) {
					recordEvent({
						timestamp: Date.now(),
						type: "path",
						detail: `ask bash: ${pathAccess.path}`,
						action: "blocked",
					});
					ctx.ui.notify(`[DC] Blocked bash access: ${pathAccess.path} (confirmation required)`, "error");
					return {
						block: true,
						reason: `Damage Control: bash command targets protected path "${pathAccess.path}" and was not approved.`,
					};
				}
			}

			const result = checkBash(cmd);

			if (!result) return undefined;

			const { match, isAsk } = result;

			if (isAsk && ctx.hasUI) {
				recordEvent({
					timestamp: Date.now(),
					type: "bash",
					detail: match.reason,
					action: "asked",
				});

				const choice = await ctx.ui.select(
					`[Damage Control] ${match.reason}\n\n  ${cmd}\n\nAllow this command?`,
					["Yes, proceed", "No, block it"],
				);

				if (choice === "Yes, proceed") {
					recordEvent({
						timestamp: Date.now(),
						type: "bash",
						detail: match.reason,
						action: "allowed",
					});
					return undefined;
				}
			}

			recordEvent({
				timestamp: Date.now(),
				type: "bash",
				detail: match.reason,
				action: "blocked",
			});
			ctx.ui.notify(`[DC] Blocked: ${match.reason}`, "error");
			return {
				block: true,
				reason: `Damage Control: ${match.reason}. Command blocked by safety rules.`,
			};
		}

		// --- Read tool: check protected paths ---
		if (isToolCallEventType("read", event)) {
			const filePath = event.input.path;
			const access = checkPathAccess(filePath);

			if (access === "zero") {
				recordEvent({
					timestamp: Date.now(),
					type: "path",
					detail: `zero-access read: ${filePath}`,
					action: "blocked",
				});
				ctx.ui.notify(`[DC] Blocked read: ${filePath} (zero-access)`, "error");
				return {
					block: true,
					reason: `Damage Control: "${filePath}" is a zero-access path. Reading is not permitted.`,
				};
			}

			if (!shouldSkipReadConfirmation(filePath) && shouldAskPathAccess(filePath)) {
				const allowed = await confirmPathAccess("read", filePath, filePath, ctx);
				if (!allowed) {
					recordEvent({
						timestamp: Date.now(),
						type: "path",
						detail: `ask read: ${filePath}`,
						action: "blocked",
					});
					ctx.ui.notify(`[DC] Blocked read: ${filePath} (confirmation required)`, "error");
					return {
						block: true,
						reason: `Damage Control: "${filePath}" requires explicit approval before it can be read.`,
					};
				}
			}
		}

		// --- Write tool: check zero-access and read-only paths ---
		if (event.toolName === "write") {
			const filePath = (event.input as Record<string, unknown>).path as string;
			const access = checkPathAccess(filePath);

			if (access === "zero") {
				recordEvent({
					timestamp: Date.now(),
					type: "path",
					detail: `zero-access write: ${filePath}`,
					action: "blocked",
				});
				ctx.ui.notify(`[DC] Blocked write: ${filePath} (zero-access)`, "error");
				return {
					block: true,
					reason: `Damage Control: "${filePath}" is a zero-access path. Writing is not permitted.`,
				};
			}

			if (access === "readOnly") {
				recordEvent({
					timestamp: Date.now(),
					type: "path",
					detail: `read-only write: ${filePath}`,
					action: "blocked",
				});
				ctx.ui.notify(`[DC] Blocked write: ${filePath} (read-only)`, "error");
				return {
					block: true,
					reason: `Damage Control: "${filePath}" is read-only. Writing is not permitted.`,
				};
			}
		}

		// --- Edit tool: check zero-access and read-only paths ---
		if (isToolCallEventType("edit", event)) {
			const filePath = event.input.path;
			const access = checkPathAccess(filePath);

			if (access === "zero") {
				recordEvent({
					timestamp: Date.now(),
					type: "path",
					detail: `zero-access edit: ${filePath}`,
					action: "blocked",
				});
				ctx.ui.notify(`[DC] Blocked edit: ${filePath} (zero-access)`, "error");
				return {
					block: true,
					reason: `Damage Control: "${filePath}" is a zero-access path. Editing is not permitted.`,
				};
			}

			if (access === "readOnly") {
				recordEvent({
					timestamp: Date.now(),
					type: "path",
					detail: `read-only edit: ${filePath}`,
					action: "blocked",
				});
				ctx.ui.notify(`[DC] Blocked edit: ${filePath} (read-only)`, "error");
				return {
					block: true,
					reason: `Damage Control: "${filePath}" is read-only. Editing is not permitted.`,
				};
			}
		}

		return undefined;
	});

	// -- /dc command ----------------------------------------------------------

	pi.registerCommand("dc", {
		description: "Show damage control status and rules",
		handler: async (args, ctx) => {
			// Reload rules in case the YAML was edited
			loadAllRules(ctx.cwd);

			if (args?.trim() === "rules") {
				const lines: string[] = [];
				lines.push("--- Bash patterns ---");
				for (const bp of rules.bashToolPatterns) {
					const tag = bp.allow ? " [allow]" : bp.ask ? " [ask]" : " [block]";
					lines.push(`  ${bp.pattern}${tag} -- ${bp.reason}`);
				}
				lines.push("");
				lines.push("--- Zero-access paths ---");
				for (const p of rules.zeroAccessPaths) lines.push(`  ${p}`);
				lines.push("");
				lines.push("--- Ask-before-access paths ---");
				for (const p of rules.askAccessPaths) lines.push(`  ${p}`);
				lines.push("");
				lines.push("--- Read-only paths ---");
				for (const p of rules.readOnlyPaths) lines.push(`  ${p}`);
				lines.push("");
				lines.push("--- No-delete paths ---");
				for (const p of rules.noDeletePaths) lines.push(`  ${p}`);

				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			const lines: string[] = [];
			const allowCount = rules.bashToolPatterns.filter((r) => r.allow).length;
			const askCount = rules.bashToolPatterns.filter((r) => !r.allow && r.ask).length;
			const blockCount = rules.bashToolPatterns.filter((r) => !r.allow && !r.ask).length;
			lines.push(`Bash patterns:      ${rules.bashToolPatterns.length} (${allowCount} allow, ${askCount} ask, ${blockCount} block)`);
			lines.push(`Zero-access paths:  ${rules.zeroAccessPaths.length}`);
			lines.push(`Ask-access paths:   ${rules.askAccessPaths.length}`);
			lines.push(`Read-only paths:    ${rules.readOnlyPaths.length}`);
			lines.push(`No-delete paths:    ${rules.noDeletePaths.length}`);

			if (recentEvents.length > 0) {
				lines.push("");
				lines.push("Recent events:");
				for (const evt of recentEvents.slice(0, 10)) {
					const time = new Date(evt.timestamp).toLocaleTimeString();
					const icon = evt.action === "blocked" ? "[x]" : evt.action === "asked" ? "[?]" : "[>]";
					lines.push(`  ${time} ${icon} ${evt.detail}`);
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
