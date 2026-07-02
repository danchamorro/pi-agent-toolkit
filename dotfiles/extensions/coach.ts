/**
 * Coach Extension
 *
 * Slash commands: /coach, /coach last
 *
 * LLM-powered deep analysis of PI session behavior. Reads actual session
 * content (user messages, tool calls, file paths, session structure) across
 * the selected scope, then sends the collected evidence to the active model
 * for genuine coaching analysis. Produces markdown output with specific,
 * evidence-backed recommendations for PI workflow improvements, potential
 * skills and extensions to build, and missed opportunities.
 *
 * This is intentionally a slow, expensive command. Quality over speed.
 */

import { complete } from "@earendil-works/pi-ai/compat";
import {
  BorderedLoader,
  DynamicBorder,
  getMarkdownTheme,
  SessionManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type SessionEntry,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Key,
  Markdown,
  SelectList,
  Text,
  matchesKey,
  type Component,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";

type CoachScope = "current" | "all";

const COACH_REPORT_ENTRY = "coach-report-state";
const COACH_REPORT_MESSAGE = "coach-report";
const MAX_MSG_CHARS = 500;
const MAX_ASSISTANT_CHARS = 200;
const MAX_SESSIONS_DETAILED = 15;

function messageContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object") return "";
      const b = block as { type?: string; text?: string };
      return b.type === "text" && typeof b.text === "string" ? b.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1) + "…";
}

function abbreviatePath(filePath: string, cwd: string): string {
  if (filePath.startsWith(cwd + "/")) return filePath.slice(cwd.length + 1);
  const home = process.env.HOME ?? "";
  if (home && filePath.startsWith(home + "/")) return "~/" + filePath.slice(home.length + 1);
  return filePath;
}

interface SessionDigest {
  name: string | undefined;
  created: string;
  entryCount: number;
  branchPoints: number;
  compactions: number;
  labels: number;
  isForked: boolean;
  userMessages: string[];
  assistantSnippets: string[];
  toolCalls: Array<{ tool: string; path?: string }>;
  filesRead: string[];
  filesEdited: string[];
}

interface SavedCoachReport {
  markdown: string;
  scope: CoachScope;
  createdAt: string;
}

function digestSession(entries: SessionEntry[], cwd: string, info?: SessionInfo): SessionDigest {
  const userMessages: string[] = [];
  const assistantSnippets: string[] = [];
  const toolCalls: Array<{ tool: string; path?: string }> = [];
  const filesRead = new Set<string>();
  const filesEdited = new Set<string>();
  let branchPointCount = 0;
  let compactionCount = 0;
  let labelCount = 0;

  const childCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.parentId) {
      childCounts.set(entry.parentId, (childCounts.get(entry.parentId) ?? 0) + 1);
    }
  }
  for (const count of childCounts.values()) {
    if (count > 1) branchPointCount++;
  }

  for (const entry of entries) {
    if (entry.type === "compaction") compactionCount++;
    if (entry.type === "label" && entry.label) labelCount++;
    if (entry.type !== "message") continue;

    if (entry.message.role === "user") {
      const text = truncate(messageContentToText(entry.message.content), MAX_MSG_CHARS);
      if (text) userMessages.push(text);
    }

    if (entry.message.role === "assistant") {
      const text = truncate(messageContentToText(entry.message.content), MAX_ASSISTANT_CHARS);
      if (text) assistantSnippets.push(text);

      const content = entry.message.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const typed = block as { type?: string; name?: string; arguments?: Record<string, unknown> };
        if (typed.type !== "toolCall" || !typed.name) continue;

        const args = typed.arguments ?? {};
        const filePath = typeof args.path === "string" ? abbreviatePath(args.path, cwd) : undefined;

        toolCalls.push({ tool: typed.name, path: filePath });

        if (typed.name === "read" && filePath) filesRead.add(filePath);
        if ((typed.name === "edit" || typed.name === "write") && filePath) filesEdited.add(filePath);
      }
    }
  }

  return {
    name: info?.name ?? undefined,
    created: info?.created?.toISOString().slice(0, 16) ?? "unknown",
    entryCount: entries.length,
    branchPoints: branchPointCount,
    compactions: compactionCount,
    labels: labelCount,
    isForked: Boolean(info?.parentSessionPath),
    userMessages,
    assistantSnippets,
    toolCalls,
    filesRead: [...filesRead],
    filesEdited: [...filesEdited],
  };
}

function buildCrossSessionOverlap(digests: SessionDigest[]): {
  readOverlap: Array<{ file: string; count: number }>;
  editOverlap: Array<{ file: string; count: number }>;
} {
  const readCounts = new Map<string, number>();
  const editCounts = new Map<string, number>();

  for (const digest of digests) {
    for (const file of digest.filesRead) {
      readCounts.set(file, (readCounts.get(file) ?? 0) + 1);
    }
    for (const file of digest.filesEdited) {
      editCounts.set(file, (editCounts.get(file) ?? 0) + 1);
    }
  }

  const readOverlap = [...readCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => ({ file, count }));

  const editOverlap = [...editCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, count]) => ({ file, count }));

  return { readOverlap, editOverlap };
}

function formatSessionDigest(digest: SessionDigest, index: number): string {
  const lines: string[] = [];
  const label = digest.name ? `"${digest.name}"` : "(unnamed)";
  lines.push(`### Session ${index + 1}: ${label} (${digest.created})`);
  lines.push(`Entries: ${digest.entryCount} | Branch points: ${digest.branchPoints} | Compactions: ${digest.compactions} | Labels: ${digest.labels} | Forked: ${digest.isForked ? "yes" : "no"}`);
  lines.push("");

  if (digest.userMessages.length > 0) {
    lines.push("**User messages:**");
    for (const [i, msg] of digest.userMessages.entries()) {
      lines.push(`${i + 1}. "${msg}"`);
    }
    lines.push("");
  }

  if (digest.assistantSnippets.length > 0) {
    lines.push("**Assistant response snippets:**");
    for (const snippet of digest.assistantSnippets.slice(0, 5)) {
      lines.push(`- "${snippet}"`);
    }
    lines.push("");
  }

  if (digest.filesRead.length > 0 || digest.filesEdited.length > 0) {
    lines.push("**Files accessed:**");
    if (digest.filesRead.length > 0) {
      lines.push(`- Read: ${digest.filesRead.join(", ")}`);
    }
    if (digest.filesEdited.length > 0) {
      lines.push(`- Edited: ${digest.filesEdited.join(", ")}`);
    }
    lines.push("");
  }

  const toolSummary = new Map<string, number>();
  for (const tc of digest.toolCalls) {
    toolSummary.set(tc.tool, (toolSummary.get(tc.tool) ?? 0) + 1);
  }
  if (toolSummary.size > 0) {
    const parts = [...toolSummary.entries()].map(([tool, count]) => `${tool}: ${count}`);
    lines.push(`**Tool calls:** ${parts.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

function buildAnalysisPrompt(
  digests: SessionDigest[],
  overlap: { readOverlap: Array<{ file: string; count: number }>; editOverlap: Array<{ file: string; count: number }> },
  current: SessionDigest,
  currentContextPercent: number | undefined,
  currentContextTokens: number | undefined,
  currentContextWindow: number | undefined,
): string {
  const lines: string[] = [];

  lines.push("# PI Session Data for Analysis");
  lines.push("");
  lines.push(`## Overview`);
  lines.push(`- Sessions analyzed: ${digests.length}`);
  lines.push(`- Total user messages: ${digests.reduce((a, d) => a + d.userMessages.length, 0)}`);
  lines.push(`- Total tool calls: ${digests.reduce((a, d) => a + d.toolCalls.length, 0)}`);

  const totalReads = digests.reduce((a, d) => a + d.toolCalls.filter((t) => t.tool === "read").length, 0);
  const totalEdits = digests.reduce((a, d) => a + d.toolCalls.filter((t) => t.tool === "edit").length, 0);
  const totalWrites = digests.reduce((a, d) => a + d.toolCalls.filter((t) => t.tool === "write").length, 0);
  const totalBash = digests.reduce((a, d) => a + d.toolCalls.filter((t) => t.tool === "bash").length, 0);
  lines.push(`- Tool breakdown: reads=${totalReads}, edits=${totalEdits}, writes=${totalWrites}, bash=${totalBash}`);

  const readOnlySessions = digests.filter((d) => d.toolCalls.some((t) => t.tool === "read") && !d.toolCalls.some((t) => t.tool === "edit" || t.tool === "write")).length;
  const shortSessions = digests.filter((d) => d.userMessages.length <= 2).length;
  const namedSessions = digests.filter((d) => Boolean(d.name)).length;
  const forkedSessions = digests.filter((d) => d.isForked).length;
  const sessionsWithBranches = digests.filter((d) => d.branchPoints > 0).length;
  const sessionsWithCompactions = digests.filter((d) => d.compactions > 0).length;
  const sessionsWithLabels = digests.filter((d) => d.labels > 0).length;

  lines.push(`- Read-only sessions: ${readOnlySessions}`);
  lines.push(`- Short sessions (<=2 user messages): ${shortSessions}`);
  lines.push(`- Named sessions: ${namedSessions}`);
  lines.push(`- Forked sessions: ${forkedSessions}`);
  lines.push(`- Sessions with branches: ${sessionsWithBranches}`);
  lines.push(`- Sessions with compactions: ${sessionsWithCompactions}`);
  lines.push(`- Sessions with labels: ${sessionsWithLabels}`);
  lines.push("");

  if (currentContextPercent !== undefined) {
    lines.push(`## Current Session Context`);
    lines.push(`- Context usage: ${currentContextPercent.toFixed(1)}% (${currentContextTokens?.toLocaleString()} / ${currentContextWindow?.toLocaleString()} tokens)`);
    lines.push("");
  }

  if (overlap.readOverlap.length > 0) {
    lines.push("## Files Read Across Multiple Sessions (context rebuilding signal)");
    for (const f of overlap.readOverlap) {
      lines.push(`- ${f.count} sessions: ${f.file}`);
    }
    lines.push("");
  }

  if (overlap.editOverlap.length > 0) {
    lines.push("## Files Edited Across Multiple Sessions");
    for (const f of overlap.editOverlap) {
      lines.push(`- ${f.count} sessions: ${f.file}`);
    }
    lines.push("");
  }

  lines.push("## Session Details");
  lines.push("");

  const sessionsToDetail = digests.slice(0, MAX_SESSIONS_DETAILED);
  for (const [i, digest] of sessionsToDetail.entries()) {
    lines.push(formatSessionDigest(digest, i));
  }

  if (digests.length > MAX_SESSIONS_DETAILED) {
    lines.push(`(${digests.length - MAX_SESSIONS_DETAILED} older sessions omitted for brevity)`);
    lines.push("");
  }

  return lines.join("\n");
}

const COACH_SYSTEM_PROMPT = `You are a PI workflow coach. PI is a terminal coding agent harness (similar to Claude Code or Aider). Your job is to analyze actual session data from a user's PI usage and provide deep, specific coaching on how they could use PI more effectively.

You will receive real session data including user messages, assistant responses, tool calls, file access patterns, and session structure. Analyze this data thoroughly and produce genuine, evidence-backed insights.

## PI Features You Should Coach On

### /tree (Session Tree Navigation)
Jump to any earlier point in the session and continue from there. All history is preserved in the same file. The user should use /tree when:
- They went down a wrong path and want to backtrack
- They want to try a different approach from an earlier checkpoint
- They are in a long session and need to revisit an earlier decision
Pressing Escape twice opens /tree in interactive mode.
Users can label checkpoints inside /tree for fast navigation.

### /fork (Session Forking)
Create a new session file from the current branch. The user should use /fork when:
- They want to explore an alternate approach while keeping the original intact
- The work diverges into two independent tracks
- They want a fresh start but with all the accumulated context

### /compact (Context Compaction)
Summarize older messages to free context window space. The user should use /compact when:
- Context usage is getting high (>60%)
- The conversation is long and details are getting lost
- They keep asking the model to recap or summarize what happened
Custom instructions can be passed to /compact to control what gets preserved.

### /resume and pi -c (Session Continuation)
Reopen a previous session instead of starting fresh. The user should use these when:
- They keep re-reading the same files across sessions (context rebuilding)
- They restate the same goals or constraints in new sessions
- They have short sessions that could have continued from a previous one

### /name (Session Naming)
Give sessions descriptive names for easier discovery in /resume. Important when many sessions exist for the same project.

### Labels in /tree
Mark important checkpoints so /tree navigation is faster. Labels are created inside /tree's interactive mode. Only worth recommending when the user actively uses /tree to navigate, or when a session is so long that finding key decisions becomes a real problem. Do NOT recommend labeling as a standalone habit; instead, recommend /tree itself as the solution and mention labels as a feature within it.

### Skills
On-demand markdown-based capability packages. The user should consider BUILDING a new skill when:
- They repeatedly perform the same multi-step workflow manually
- They need the same reference material or instructions over and over
- They have a standard operating procedure for specific tasks (deployment, review, testing patterns)
- They keep explaining the same constraints or setup to the agent

### Extensions
TypeScript modules that extend PI with tools, commands, UI, and event handlers. The user should consider BUILDING a new extension when:
- They want automated behavior triggered by events (run tests after edits, lint before commits)
- They want a custom tool the LLM can call
- They want to intercept or modify tool behavior systematically
- They want persistent UI elements or workflows

### Prompt Templates
Reusable markdown prompts expanded via /templatename. The user should consider creating one when:
- They type similar structured prompts repeatedly
- They have standard review, analysis, or task patterns

## Your Analysis Must Include

1. **Specific missed opportunities**: Find actual moments in the session data where a PI feature would have solved a real problem the user encountered (or is likely to encounter). QUOTE the user's actual words or describe the specific file access pattern. Frame recommendations around the problem first, then the feature. Do not recommend features as rituals or habits; recommend them as solutions to concrete problems. Do not be vague.

2. **Cross-session inefficiencies**: Where is the user rebuilding context, re-reading files, restarting work that could have continued?

3. **Skill or extension building opportunities**: Look for repeated manual workflows, repeated prompt patterns, or repeated tool configurations that would be worth automating. Be specific about what the skill or extension would do.

4. **Positive habits**: Acknowledge what the user is already doing well. Be specific.

5. **Prioritized recommendations**: Order by impact. The most impactful recommendation should be first.

## Rules

- Be specific. Every recommendation must reference actual evidence from the session data.
- Quote actual user messages when relevant.
- Name actual files when discussing file overlap.
- Do not pad with generic advice. If there are only 2 strong recommendations, give 2. Do not invent a 5th just to fill space.
- Do not recommend features the user is already using well.
- Use markdown formatting with headers, bold, and bullet points.
- Do not use em dashes. Use commas, colons, semicolons, or separate sentences instead.`;

async function collectAndAnalyze(
  ctx: ExtensionCommandContext,
  scope: CoachScope,
  signal?: AbortSignal,
): Promise<string> {
  const cwd = ctx.cwd;
  const usage = ctx.getContextUsage();
  const contextTokens = typeof usage?.tokens === "number" ? usage.tokens : undefined;
  const contextWindow = typeof usage?.contextWindow === "number" ? usage.contextWindow : undefined;
  const contextPercent =
    contextTokens !== undefined && contextWindow !== undefined && contextWindow > 0
      ? (contextTokens / contextWindow) * 100
      : undefined;

  let digests: SessionDigest[];
  let currentDigest: SessionDigest;

  if (scope === "current") {
    const entries = ctx.sessionManager.getBranch();
    currentDigest = digestSession(entries, cwd);
    currentDigest.name = ctx.sessionManager.getSessionName() ?? undefined;
    digests = [currentDigest];
  } else {
    const sessions = await SessionManager.list(cwd, ctx.sessionManager.getSessionDir());
    sessions.sort((a, b) => b.created.getTime() - a.created.getTime());

    digests = [];
    for (const session of sessions) {
      try {
        const manager = SessionManager.open(session.path);
        digests.push(digestSession(manager.getBranch(), cwd, session));
      } catch {
        // Skip unreadable sessions.
      }
    }

    const currentBranch = ctx.sessionManager.getBranch();
    currentDigest = digestSession(currentBranch, cwd);
    currentDigest.name = ctx.sessionManager.getSessionName() ?? undefined;
  }

  const overlap = buildCrossSessionOverlap(digests);
  const prompt = buildAnalysisPrompt(digests, overlap, currentDigest, contextPercent, contextTokens, contextWindow);

  const model = ctx.model;
  if (!model) {
    throw new Error("No active model. Select a model first.");
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    throw new Error(`Cannot get API key: ${auth.error}`);
  }

  const messages = [
    {
      role: "user" as const,
      content: [{ type: "text" as const, text: prompt }],
      timestamp: Date.now(),
    },
  ];

  const response = await complete(
    model,
    { systemPrompt: COACH_SYSTEM_PROMPT, messages },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal,
      reasoningEffort: "high",
    },
  );

  if (response.stopReason === "error") {
    throw new Error(`Analysis failed: ${response.errorMessage ?? "Unknown error"}`);
  }

  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

function saveCoachReport(pi: ExtensionAPI, scope: CoachScope, markdown: string): void {
  pi.appendEntry<SavedCoachReport>(COACH_REPORT_ENTRY, {
    markdown,
    scope,
    createdAt: new Date().toISOString(),
  });
}

function getLastCoachReport(ctx: ExtensionCommandContext): SavedCoachReport | null {
  const branchEntries = ctx.sessionManager.getBranch();

  for (let i = branchEntries.length - 1; i >= 0; i--) {
    const entry = branchEntries[i];
    if (entry.type !== "custom" || entry.customType !== COACH_REPORT_ENTRY) continue;

    const data = entry.data as SavedCoachReport | undefined;
    if (!data?.markdown) continue;

    return {
      markdown: data.markdown,
      scope: data.scope === "current" ? "current" : "all",
      createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
    };
  }

  return null;
}

function sendCoachMessage(pi: ExtensionAPI, content: string): void {
  pi.sendMessage({ customType: COACH_REPORT_MESSAGE, content, display: true }, { triggerTurn: false });
}

function presentCoachNotice(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  message: string,
  level: "info" | "warning" | "error" = "warning",
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, level);
    return;
  }

  sendCoachMessage(pi, message);
}

function getCoachLoadingMessage(scope: CoachScope): string {
  if (scope === "current") {
    return "Reading session content and sending to model for analysis...";
  }

  return "Opening all sessions, reading content, and sending to model for deep analysis...";
}

async function presentCoachReport(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  markdown: string,
): Promise<void> {
  if (!ctx.hasUI) {
    sendCoachMessage(pi, markdown);
    return;
  }

  await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
    const mdTheme = getMarkdownTheme();
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(
      new Text(
        theme.fg("accent", theme.bold("Coach Analysis")) + theme.fg("dim", "  (Esc/q/Enter to close)"),
        1,
        0,
      ),
    );
    container.addChild(new Text("", 1, 0));
    container.addChild(new Markdown(markdown, 1, 0, mdTheme));
    container.addChild(new Text("", 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        if (
          matchesKey(data, Key.escape) ||
          matchesKey(data, Key.ctrl("c")) ||
          matchesKey(data, Key.enter) ||
          data.toLowerCase() === "q"
        ) {
          done(undefined);
        }
      },
    };
  });
}

class CoachModePicker implements Component {
  private readonly container: Container;
  private readonly selectList: SelectList;

  constructor(tui: TUI, theme: import("@earendil-works/pi-coding-agent").Theme, onDone: (scope: CoachScope | null) => void) {
    const items: SelectItem[] = [
      {
        value: "current",
        label: "Current session",
        description: "Analyze this live conversation only",
      },
      {
        value: "all",
        label: "All sessions in this working directory",
        description: "Deep analysis of all session history (This will take longer and use tokens)",
      },
    ];

    this.container = new Container();
    this.container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    this.container.addChild(
      new Text(theme.fg("accent", theme.bold("Coach scope")) + theme.fg("dim", "  (Esc to cancel)"), 1, 0),
    );
    this.container.addChild(
      new Text(theme.fg("muted", "Choose what /coach should analyze. Results are LLM-generated."), 1, 0),
    );
    this.container.addChild(new Text("", 1, 0));

    this.selectList = new SelectList(items, Math.min(items.length + 1, 8), {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    });
    this.selectList.onSelect = (item) => onDone(item.value as CoachScope);
    this.selectList.onCancel = () => onDone(null);

    this.container.addChild(this.selectList);
    this.container.addChild(new Text("", 1, 0));
    this.container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    void tui;
  }

  render(width: number): string[] {
    return this.container.render(width);
  }

  handleInput(data: string): void {
    this.selectList.handleInput?.(data);
  }

  invalidate(): void {
    this.container.invalidate();
  }
}

export default function coachExtension(pi: ExtensionAPI) {
  pi.registerCommand("coach", {
    description: "LLM-powered deep analysis of PI session habits, plus /coach last to reopen the latest report",
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();

      switch (action) {
        case "last": {
          const savedReport = getLastCoachReport(ctx);
          if (!savedReport) {
            presentCoachNotice(pi, ctx, 'No saved coach report in this session yet. Run "/coach" first.');
            return;
          }

          await presentCoachReport(pi, ctx, savedReport.markdown);
          return;
        }
        case "":
          break;
        default:
          presentCoachNotice(pi, ctx, "Usage: /coach or /coach last");
          return;
      }

      let scope: CoachScope = "all";

      if (ctx.hasUI) {
        const selectedScope = await ctx.ui.custom<CoachScope | null>(
          (tui: TUI, theme, _kb, done) => new CoachModePicker(tui, theme, done),
        );
        if (!selectedScope) return;
        scope = selectedScope;
      }

      const loadingMessage = getCoachLoadingMessage(scope);

      const analysisMarkdown = ctx.hasUI
        ? await ctx.ui.custom<string | null>((tui: TUI, theme, _kb, done) => {
            const loader = new BorderedLoader(tui, theme, loadingMessage);
            loader.onAbort = () => done(null);

            collectAndAnalyze(ctx, scope, loader.signal)
              .then((result) => done(result))
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                ctx.ui.notify(`Coach failed: ${message}`, "error");
                done(null);
              });

            return loader;
          })
        : await collectAndAnalyze(ctx, scope);

      if (!analysisMarkdown) return;

      saveCoachReport(pi, scope, analysisMarkdown);
      await presentCoachReport(pi, ctx, analysisMarkdown);
    },
  });
}
