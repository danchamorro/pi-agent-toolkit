/**
 * Inventory Extension
 *
 * Shortcut: Ctrl+Shift+S.
 *
 * Registers /inventory to reopen Pi's startup-style resource inventory at any
 * time. The overlay groups context files, skills, prompt templates, extensions,
 * and slash commands by scope so project-local resources are easy to rediscover
 * after a session has been running for a while. Features a clean tabbed interface
 * with scope-based grouping, descriptions from frontmatter and JSDoc, and
 * keyboard shortcuts for quick navigation.
 */

import {
	DynamicBorder,
	getAgentDir,
	loadProjectContextFiles,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, Text, type Component, type TUI } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SHORTCUT = "ctrl+shift+s";

type Scope = "project" | "user" | "package" | "settings" | "other";

type InventoryItem = {
	label: string;
	path?: string;
	description?: string;
	scope: Scope;
};

type InventorySection = {
	title: string;
	items: InventoryItem[];
};

type InventoryData = {
	cwd: string;
	sections: InventorySection[];
	extensionCommands: InventoryItem[];
};

function expandHome(inputPath: string): string {
	if (inputPath === "~") return os.homedir();
	if (inputPath.startsWith("~/")) return path.join(os.homedir(), inputPath.slice(2));
	return inputPath;
}

function normalizePath(inputPath: string, cwd: string): string {
	const expanded = expandHome(inputPath);
	return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded));
}

function shortenPath(inputPath: string, cwd: string): string {
	const expanded = expandHome(inputPath);
	const absolute = path.resolve(path.isAbsolute(expanded) ? expanded : path.join(cwd, expanded));
	const home = os.homedir();
	const resolvedCwd = path.resolve(cwd);
	if (absolute === resolvedCwd) return ".";
	if (absolute.startsWith(resolvedCwd + path.sep)) return "./" + absolute.slice(resolvedCwd.length + 1);
	if (absolute === home) return "~";
	if (absolute.startsWith(home + path.sep)) return "~/" + absolute.slice(home.length + 1);
	return absolute;
}

function scopeForPath(inputPath: string | undefined, cwd: string): Scope {
	if (!inputPath) return "other";
	const absolute = normalizePath(inputPath, cwd);
	const resolvedCwd = path.resolve(cwd);
	const agentDir = path.resolve(getAgentDir());
	const homeAgents = path.join(os.homedir(), ".agents");
	if (absolute === resolvedCwd || absolute.startsWith(resolvedCwd + path.sep)) return "project";
	if (absolute === agentDir || absolute.startsWith(agentDir + path.sep)) return "user";
	if (absolute === homeAgents || absolute.startsWith(homeAgents + path.sep)) return "user";
	if (absolute.includes(`${path.sep}node_modules${path.sep}`)) return "package";
	return "other";
}

function scopeRank(scope: Scope): number {
	return { project: 0, user: 1, package: 2, settings: 3, other: 4 }[scope];
}

function sortItems(items: InventoryItem[]): InventoryItem[] {
	return [...items].sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope) || a.label.localeCompare(b.label));
}

function readTextFile(filePath: string): string {
	try {
		return readFileSync(filePath, "utf8");
	} catch {
		return "";
	}
}

function extractFrontmatterDescription(filePath: string): string | undefined {
	const text = readTextFile(filePath);
	const match = text.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return undefined;
	const description = match[1]?.match(/^description:\s*(.+)$/m)?.[1]?.trim();
	return description?.replace(/^['"]|['"]$/g, "");
}

function extractExtensionDescription(filePath: string): string | undefined {
	const text = readTextFile(filePath);
	const match = text.match(/^\/\*\*([\s\S]*?)\*\//);
	if (!match) return undefined;
	const lines = match[1]
		.split("\n")
		.map((line) => line.replace(/^\s*\*\s?/, "").trim())
		.filter(Boolean)
		.filter((line) => !line.startsWith("Shortcut"));
	const description = lines.find((line) => !line.endsWith("Extension"));
	return description;
}

function walkSkillFiles(root: string, cwd: string, scope: Scope): InventoryItem[] {
	const items: InventoryItem[] = [];
	const absoluteRoot = normalizePath(root, cwd);
	if (!existsSync(absoluteRoot)) return items;

	const visit = (dir: string) => {
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			return;
		}

		if (entries.includes("SKILL.md")) {
			const skillPath = path.join(dir, "SKILL.md");
			items.push({
				label: path.basename(dir),
				path: shortenPath(skillPath, cwd),
				description: extractFrontmatterDescription(skillPath),
				scope,
			});
			return;
		}

		for (const entry of entries) {
			if (entry === "node_modules" || entry === ".git") continue;
			const fullPath = path.join(dir, entry);
			try {
				if (statSync(fullPath).isDirectory()) visit(fullPath);
			} catch {
				// Ignore unreadable paths. Inventory should never block Pi startup.
			}
		}
	};

	visit(absoluteRoot);

	try {
		for (const entry of readdirSync(absoluteRoot)) {
			const fullPath = path.join(absoluteRoot, entry);
			if (entry.endsWith(".md") && statSync(fullPath).isFile()) {
				items.push({
					label: path.basename(entry, ".md"),
					path: shortenPath(fullPath, cwd),
					description: extractFrontmatterDescription(fullPath),
					scope,
				});
			}
		}
	} catch {
		// Ignore unreadable root-level markdown files.
	}

	return items;
}

function listMarkdownPrompts(root: string, cwd: string, scope: Scope): InventoryItem[] {
	const absoluteRoot = normalizePath(root, cwd);
	if (!existsSync(absoluteRoot)) return [];
	try {
		return readdirSync(absoluteRoot)
			.filter((entry) => entry.endsWith(".md"))
			.map((entry) => {
				const promptPath = path.join(absoluteRoot, entry);
				return {
					label: `/${path.basename(entry, ".md")}`,
					path: shortenPath(promptPath, cwd),
					description: extractFrontmatterDescription(promptPath),
					scope,
				};
			});
	} catch {
		return [];
	}
}

function listExtensions(root: string, cwd: string, scope: Scope): InventoryItem[] {
	const absoluteRoot = normalizePath(root, cwd);
	if (!existsSync(absoluteRoot)) return [];
	try {
		const items: InventoryItem[] = [];
		for (const entry of readdirSync(absoluteRoot)) {
			const fullPath = path.join(absoluteRoot, entry);
			const stat = statSync(fullPath);
			if (stat.isFile() && entry.endsWith(".ts")) {
				items.push({ label: entry, path: shortenPath(fullPath, cwd), description: extractExtensionDescription(fullPath), scope });
			}
			if (stat.isDirectory() && existsSync(path.join(fullPath, "index.ts"))) {
				const indexPath = path.join(fullPath, "index.ts");
				items.push({ label: `${entry}/`, path: shortenPath(indexPath, cwd), description: extractExtensionDescription(indexPath), scope });
			}
		}
		return items;
	} catch {
		return [];
	}
}

function mergeInventoryItems(items: InventoryItem[]): InventoryItem[] {
	const byLabel = new Map<string, InventoryItem>();
	for (const item of items) {
		const key = item.label.toLowerCase();
		const existing = byLabel.get(key);
		if (!existing) {
			byLabel.set(key, item);
			continue;
		}

		if (scopeRank(item.scope) < scopeRank(existing.scope)) {
			byLabel.set(key, { ...item, description: item.description ?? existing.description });
			continue;
		}

		if (!existing.description && item.description) {
			byLabel.set(key, { ...existing, description: item.description });
		}
	}
	return Array.from(byLabel.values());
}

function groupLabel(scope: Scope): string {
	return { project: "project", user: "user", package: "package", settings: "settings", other: "other" }[scope];
}

function wrapText(text: string, width: number, firstIndent: number, contIndent: number): string[] {
	if (width <= firstIndent) return [text];
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";
	let maxLen = width - firstIndent;
	for (const word of words) {
		if (!word) continue;
		if (current.length + word.length + 1 <= maxLen || current.length === 0) {
			current = current ? `${current} ${word}` : word;
		} else {
			lines.push(current);
			current = word;
			maxLen = width - contIndent;
		}
	}
	if (current) lines.push(current);
	return lines;
}

class InventoryView implements Component {
	private readonly container = new Container();
	private readonly body = new Text("", 1, 0);
	private scroll = 0;
	private activeTab = 0;
	private cachedWidth = 0;
	private cachedHeight = 0;
	private renderedLines: string[] = [];

	constructor(
		_tui: TUI,
		private readonly theme: any,
		private readonly data: InventoryData,
		private readonly onDone: () => void,
	) {
		this.container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
		this.container.addChild(
			new Text(
				theme.fg("accent", theme.bold("Pi Inventory")) +
					theme.fg("dim", ` (${SHORTCUT})`),
				1,
				0,
			),
		);
		this.container.addChild(this.body);
		this.container.addChild(new DynamicBorder((s) => theme.fg("accent", s)));
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data.toLowerCase() === "q" || data === "\r") {
			this.onDone();
			return;
		}
		const page = Math.max(4, this.cachedHeight - 7);
		if (data === "\t") this.switchTab(1);
		if (data === "\u001b[Z") this.switchTab(-1);
		if (matchesKey(data, Key.left) || data === "h") this.switchTab(-1);
		if (matchesKey(data, Key.right) || data === "l") this.switchTab(1);
		if (/^[1-9]$/.test(data)) {
			const tabNumber = Number(data) - 1;
			if (tabNumber < this.getTabs().length) this.setTab(tabNumber);
		}
		if (matchesKey(data, Key.up) || data === "k") this.scrollBy(-1);
		if (matchesKey(data, Key.down) || data === "j") this.scrollBy(1);
		if (matchesKey(data, Key.pageUp)) this.scrollBy(-page);
		if (matchesKey(data, Key.pageDown)) this.scrollBy(page);
		if (data === "g") this.setScroll(0);
		if (data === "G") this.setScroll(this.renderedLines.length);
	}

	invalidate(): void {
		this.container.invalidate();
		this.cachedWidth = 0;
		this.cachedHeight = 0;
	}

	render(width: number, height?: number): string[] {
		const availableHeight = Math.max(8, height ?? 36);
		if (this.cachedWidth !== width || this.cachedHeight !== availableHeight) {
			this.cachedWidth = width;
			this.cachedHeight = availableHeight;
			this.renderedLines = this.buildLines();
		}

		const visibleRows = Math.max(4, availableHeight - 5);
		const maxScroll = Math.max(0, this.renderedLines.length - visibleRows);
		this.scroll = Math.min(this.scroll, maxScroll);
		const visible = this.renderedLines.slice(this.scroll, this.scroll + visibleRows);
		const footer = this.theme.fg(
			"dim",
			`[${this.scroll + 1}-${Math.min(this.scroll + visibleRows, this.renderedLines.length)}/${this.renderedLines.length}]  ↑↓ scroll · Tab switch · Esc close`,
		);
		this.body.setText([...visible, "", footer].join("\n"));
		return this.container.render(width);
	}

	private getTabs(): InventorySection[] {
		return [...this.data.sections, { title: "Extension Commands", items: this.data.extensionCommands }];
	}

	private switchTab(delta: number): void {
		const tabCount = this.getTabs().length;
		this.setTab((this.activeTab + delta + tabCount) % tabCount);
	}

	private setTab(index: number): void {
		const tabCount = this.getTabs().length;
		this.activeTab = Math.max(0, Math.min(index, tabCount - 1));
		this.scroll = 0;
		this.invalidate();
	}

	private scrollBy(delta: number): void {
		this.setScroll(this.scroll + delta);
	}

	private setScroll(next: number): void {
		const visibleRows = Math.max(4, this.cachedHeight - 4);
		const maxScroll = Math.max(0, this.renderedLines.length - visibleRows);
		this.scroll = Math.max(0, Math.min(next, maxScroll));
		this.invalidate();
	}

	private buildLines(): string[] {
		const lines: string[] = [];
		const accent = (s: string) => this.theme.fg("accent", s);
		const muted = (s: string) => this.theme.fg("muted", s);
		const dim = (s: string) => this.theme.fg("dim", s);
		const ok = (s: string) => this.theme.fg("success", s);
		const text = (s: string) => this.theme.fg("text", s);
		const warn = (s: string) => this.theme.fg("warning", s);
		const tabs = this.getTabs();
		const active = tabs[this.activeTab] ?? tabs[0];
		const total = tabs.reduce((sum, tab) => sum + tab.items.length, 0);

		lines.push(
			dim("Resource map: ") +
				muted(shortenPath(this.data.cwd, this.data.cwd)) +
				dim("  ") +
				accent(`${total} entries`),
		);
		lines.push("");
		lines.push(this.renderTabBar(tabs, accent, dim, muted));
		lines.push(dim("─".repeat(Math.max(24, Math.min(96, this.cachedWidth - 4)))));
		lines.push("");

		if (active.items.length === 0) {
			lines.push(warn("  No items in this section."));
			return lines;
		}

		let currentScope: Scope | null = null;
		for (const item of active.items) {
			if (item.scope !== currentScope) {
				currentScope = item.scope;
				lines.push("");
				lines.push(ok(groupLabel(item.scope).toUpperCase()));
				lines.push(dim("─".repeat(Math.max(12, Math.min(36, this.cachedWidth - 6)))));
				lines.push("");
			}

			const maxDescWidth = Math.max(24, this.cachedWidth - 8);
			const description = item.description ?? "No description";
			const descLines = wrapText(description, maxDescWidth, 4, 4);

			lines.push(`  ${text(this.theme.bold(item.label))}`);
			for (const descLine of descLines) {
				lines.push(`    ${dim(descLine)}`);
			}
			if (item.path && item.path !== item.label) {
				lines.push(`    ${dim(item.path)}`);
			}
			lines.push("");
		}

		return lines;
	}

	private renderTabBar(
		tabs: InventorySection[],
		accent: (value: string) => string,
		dim: (value: string) => string,
		muted: (value: string) => string,
	): string {
		return tabs
			.map((tab, index) => {
				const label = `${index + 1}. ${tab.title} (${tab.items.length})`;
				if (index === this.activeTab) return accent(this.theme.bold(label));
				return muted(label);
			})
			.join(dim("  ·  "));
	}
}

function collectInventory(pi: ExtensionAPI, ctx: ExtensionContext): InventoryData {
	const cwd = ctx.cwd;
	const commands = pi.getCommands() as Array<{
		name: string;
		description?: string;
		sourceInfo?: { source?: string; path?: string };
	}>;

	const contextItems = loadProjectContextFiles({ cwd, agentDir: getAgentDir() }).map((file) => ({
		label: shortenPath(file.path, cwd),
		path: shortenPath(file.path, cwd),
		description: "Loaded project instruction file",
		scope: scopeForPath(file.path, cwd),
	}));

	const commandSkills = commands
		.filter((command) => command.sourceInfo?.source === "skill")
		.map((command) => ({
			label: command.name.startsWith("skill:") ? command.name.slice("skill:".length) : command.name,
			path: command.sourceInfo?.path ? shortenPath(command.sourceInfo.path, cwd) : undefined,
			description: command.description,
			scope: scopeForPath(command.sourceInfo?.path, cwd),
		}));

	const discoveredSkills = [
		...walkSkillFiles(".pi/skills", cwd, "project"),
		...walkSkillFiles(".agents/skills", cwd, "project"),
		...walkSkillFiles(path.join(getAgentDir(), "skills"), cwd, "user"),
		...walkSkillFiles("~/.agents/skills", cwd, "user"),
	];

	const commandPrompts = commands
		.filter((command) => command.sourceInfo?.source?.includes("prompt"))
		.map((command) => ({
			label: command.name.startsWith("/") ? command.name : `/${command.name}`,
			path: command.sourceInfo?.path ? shortenPath(command.sourceInfo.path, cwd) : undefined,
			description: command.description,
			scope: scopeForPath(command.sourceInfo?.path, cwd),
		}));

	const discoveredPrompts = [
		...listMarkdownPrompts(".pi/prompts", cwd, "project"),
		...listMarkdownPrompts(path.join(getAgentDir(), "prompts"), cwd, "user"),
	];

	const commandExtensions = commands
		.filter((command) => command.sourceInfo?.source === "extension")
		.map((command) => ({
			label: command.sourceInfo?.path ? path.basename(command.sourceInfo.path) : command.name,
			path: command.sourceInfo?.path ? shortenPath(command.sourceInfo.path, cwd) : undefined,
			description: command.description ?? (command.name.startsWith("/") ? command.name : `/${command.name}`),
			scope: scopeForPath(command.sourceInfo?.path, cwd),
		}));

	const discoveredExtensions = [
		...listExtensions(".pi/extensions", cwd, "project"),
		...listExtensions(path.join(getAgentDir(), "extensions"), cwd, "user"),
	];

	const extensionPaths = new Set([...commandExtensions, ...discoveredExtensions].map((item) => item.path).filter((p): p is string => Boolean(p)));
	const extensionCommands = mergeInventoryItems(
		commands
			.filter((command) => {
				const source = command.sourceInfo?.source ?? "";
				if (source === "skill" || source.includes("prompt")) return false;
				if (source === "extension") return true;
				const commandPath = command.sourceInfo?.path ? shortenPath(command.sourceInfo.path, cwd) : "";
				return commandPath ? extensionPaths.has(commandPath) : false;
			})
			.map((command) => ({
				label: command.name.startsWith("/") ? command.name : `/${command.name}`,
				description: command.description,
				path: command.sourceInfo?.path ? shortenPath(command.sourceInfo.path, cwd) : undefined,
				scope: scopeForPath(command.sourceInfo?.path, cwd),
			})),
	).sort((a, b) => scopeRank(a.scope) - scopeRank(b.scope) || a.label.localeCompare(b.label));

	return {
		cwd,
		sections: [
			{ title: "Context", items: sortItems(mergeInventoryItems(contextItems)) },
			{ title: "Skills", items: sortItems(mergeInventoryItems([...commandSkills, ...discoveredSkills])) },
			{ title: "Prompts", items: sortItems(mergeInventoryItems([...commandPrompts, ...discoveredPrompts])) },
			{ title: "Extensions", items: sortItems(mergeInventoryItems([...commandExtensions, ...discoveredExtensions])) },
		],
		extensionCommands,
	};
}

async function showInventory(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const data = collectInventory(pi, ctx);
	if (!ctx.hasUI) {
		const lines = data.sections.flatMap((section) => [
			`[${section.title}]`,
			...section.items.map((item) => `  ${groupLabel(item.scope)} ${item.label}${item.path ? ` ${item.path}` : ""}`),
			"",
		]);
		pi.sendMessage({ customType: "inventory", content: lines.join("\n"), display: true }, { triggerTurn: false });
		return;
	}

	await ctx.ui.custom<void>(
		(tui, theme, _keybindings, done) => new InventoryView(tui, theme, data, done),
		{ overlay: true, overlayOptions: { anchor: "center", width: "88%", margin: 1 } },
	);
}

export default function inventoryExtension(pi: ExtensionAPI) {
	pi.registerCommand("inventory", {
		description: "Show Pi resource inventory",
		handler: async (_args, ctx) => showInventory(pi, ctx),
	});

	pi.registerShortcut(SHORTCUT, {
		description: "Show Pi resource inventory",
		handler: async (ctx) => showInventory(pi, ctx),
	});
}
