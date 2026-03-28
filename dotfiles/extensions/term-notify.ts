import { basename } from "node:path";
import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Markdown, type MarkdownTheme } from "@mariozechner/pi-tui";

function runCmux(args: string[]): void {
	execFile("cmux", args, (error) => {
		if (error) {
			// Ignore quietly when cmux is unavailable or not attached.
		}
	});
}

function notifyOsc777(title: string, body: string): void {
	// OSC 777 format: ESC ] 777 ; notify ; title ; body BEL
	// Supported by Ghostty, iTerm2, WezTerm, rxvt-unicode
	process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

function isCmuxAvailable(): boolean {
	return !!(process.env.CMUX_WORKSPACE_ID || process.env.CMUX_SURFACE_ID);
}

function execFileText(command: string, args: string[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(command, args, (error, stdout) => {
			if (error) {
				resolve(undefined);
				return;
			}
			const text = stdout.trim();
			resolve(text || undefined);
		});
	});
}

function compact(parts: Array<string | undefined>): string[] {
	return parts.filter((part): part is string => Boolean(part && part.trim()));
}

function firstEnv(names: string[]): string | undefined {
	for (const name of names) {
		const value = process.env[name]?.trim();
		if (value) return value;
	}
	return undefined;
}

async function getLocationParts(cwd: string): Promise<{ location: string; branch?: string }> {
	const topLevel = await execFileText("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
	const branch = await execFileText("git", ["-C", cwd, "branch", "--show-current"]);
	const location = basename(topLevel || cwd) || cwd;
	return { location, branch };
}

function getAgentTitle(): string {
	const explicitLabel = firstEnv(["PI_NOTIFY_LABEL", "PI_AGENT_LABEL"]);
	if (explicitLabel) return explicitLabel;

	const subagentName = firstEnv(["PI_SUBAGENT_NAME", "SUBAGENT_NAME"]);
	const subagentId = firstEnv(["PI_SUBAGENT_ID", "SUBAGENT_ID"]);
	if (subagentName && subagentId) return `Pi Subagent ${subagentName} (#${subagentId})`;
	if (subagentName) return `Pi Subagent ${subagentName}`;
	if (subagentId) return `Pi Subagent #${subagentId}`;
	return "Pi";
}

const isTextPart = (part: unknown): part is { type: "text"; text: string } =>
	Boolean(part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part);

function extractLastAssistantText(messages: Array<{ role?: string; content?: unknown }>): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role !== "assistant") continue;

		const content = message.content;
		if (typeof content === "string") return content.trim() || null;

		if (Array.isArray(content)) {
			const text = content.filter(isTextPart).map((part) => part.text).join("\n").trim();
			return text || null;
		}

		return null;
	}
	return null;
}

const plainMarkdownTheme: MarkdownTheme = {
	heading: (text) => text,
	link: (text) => text,
	linkUrl: () => "",
	code: (text) => text,
	codeBlock: (text) => text,
	codeBlockBorder: () => "",
	quote: (text) => text,
	quoteBorder: () => "",
	hr: () => "",
	listBullet: () => "",
	bold: (text) => text,
	italic: (text) => text,
	strikethrough: (text) => text,
	underline: (text) => text,
};

function toPlainText(text: string): string {
	const markdown = new Markdown(text, 0, 0, plainMarkdownTheme);
	return markdown.render(80).join("\n");
}

function formatAssistantPreview(text: string | null, maxLength = 200): string {
	if (!text) return "Turn complete";
	const plain = toPlainText(text).replace(/\s+/g, " ").trim();
	if (!plain) return "Turn complete";
	return plain.length > maxLength ? `${plain.slice(0, maxLength - 1)}...` : plain;
}

async function buildNotification(cwd: string, messages?: Array<{ role?: string; content?: unknown }>): Promise<{ title: string; subtitle: string; body: string }> {
	const { location, branch } = await getLocationParts(cwd);
	const workspaceId = process.env.CMUX_WORKSPACE_ID;
	const surfaceId = process.env.CMUX_SURFACE_ID;
	const title = getAgentTitle();
	const subtitle = compact([location, branch, workspaceId, surfaceId]).join(" · ");
	const lastText = messages ? extractLastAssistantText(messages) : null;
	const body = formatAssistantPreview(lastText);
	return { title, subtitle, body };
}

export default function termNotifyExtension(pi: ExtensionAPI) {
	pi.on("agent_end", async (event, ctx) => {
		const notification = await buildNotification(ctx.cwd, event.messages);

		if (isCmuxAvailable()) {
			// cmux: native notification + visual flash
			runCmux([
				"notify",
				"--title",
				notification.title,
				"--subtitle",
				notification.subtitle,
				"--body",
				notification.body,
			]);
			runCmux(["trigger-flash"]);
		} else {
			// Fallback: OSC 777 for Ghostty, iTerm2, WezTerm
			notifyOsc777(notification.title, notification.body);
		}
	});
}
