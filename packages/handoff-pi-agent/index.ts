/**
 * Handoff Export Extension
 *
 * Command: /handoff-export
 *
 * Exports the current active Pi session branch to `.handoffs/` as a
 * continuity packet. The command preserves transcript text, tool calls, tool
 * results, command output, and context summaries, removes thinking traces and
 * extension state, and writes both canonical JSON plus a Markdown companion.
 */

import { complete, type Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  createHandoffArtifact,
  type HandoffArtifact,
  type HandoffBriefing,
} from "./shared/handoff/extractor-core.ts";
import { writeHandoffArtifact } from "./shared/handoff/write-output.ts";
import { createPiBranchSnapshot } from "./pi-branch-parser.ts";

const BRIEFING_SYSTEM_PROMPT = `You create concise handoff briefings for coding agents.

Given a Pi session timeline, write a self-contained Markdown briefing for the next agent. Use only the supplied timeline. Do not invent facts. Do not include hidden reasoning or thinking traces.

Include these headings exactly:
## Goal
## Current Status
## Completed Work
## Important Evidence
## Validation
## Risks and Caveats
## Next Steps

Keep the briefing focused on continuity. Summarize tool evidence instead of copying long logs.`;

const MAX_BRIEFING_INPUT_CHARS = 120_000;
const MAX_TIMELINE_ENTRY_CHARS = 8_000;

interface HandoffSessionManager {
  getBranch(): unknown[];
  getSessionFile(): string | null;
  getSessionId?: () => string | null;
}

type HandoffContext = ExtensionCommandContext & {
  sessionManager: HandoffSessionManager;
};

export default function registerHandoffExport(pi: ExtensionAPI): void {
  pi.registerCommand("handoff-export", {
    description: "Export the current Pi session branch to .handoffs/",
    handler: async (_args, ctx) => {
      await exportCurrentHandoff(ctx as HandoffContext);
    },
  });
}

async function exportCurrentHandoff(ctx: HandoffContext): Promise<void> {
  try {
    const cwd = ctx.cwd ?? process.cwd();
    const branch = ctx.sessionManager.getBranch();
    const sessionFile = ctx.sessionManager.getSessionFile();
    const sessionId = ctx.sessionManager.getSessionId?.() ?? null;
    const snapshot = createPiBranchSnapshot({ branch, cwd, sessionFile, sessionId });
    const handoff = createHandoffArtifact(snapshot);

    ctx.ui.notify("Generating handoff briefing...", "info");
    const modelBriefing = await generateModelBriefing(handoff, ctx);
    if (modelBriefing) handoff.briefing = modelBriefing;

    await writeHandoffArtifact(handoff, { cwd, addGitignore: "ask" });
    ctx.ui.notify(`Handoff exported to ${handoff.output.json_file}`, "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Handoff export failed: ${message}`, "error");
  }
}

async function generateModelBriefing(
  handoff: HandoffArtifact,
  ctx: HandoffContext,
): Promise<HandoffBriefing | null> {
  if (!ctx.model) {
    ctx.ui.notify("No active model found. Using deterministic briefing.", "warning");
    return null;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok || !auth.apiKey) {
    ctx.ui.notify(auth.ok ? `No API key for ${ctx.model.provider}` : auth.error, "warning");
    return null;
  }

  try {
    const userMessage = createBriefingUserMessage(handoff);

    const response = await complete(
      ctx.model,
      { systemPrompt: BRIEFING_SYSTEM_PROMPT, messages: [userMessage] },
      { apiKey: auth.apiKey, headers: auth.headers },
    );

    if (response.stopReason === "aborted") return null;

    const content = response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!content) {
      ctx.ui.notify("Model briefing was empty. Using deterministic briefing.", "warning");
      return null;
    }

    return {
      generated_by: "model",
      model: `${ctx.model.provider}/${ctx.model.id}`,
      content,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Model briefing failed: ${message}. Using deterministic briefing.`, "warning");
    return null;
  }
}

function createBriefingUserMessage(handoff: HandoffArtifact): Message {
  return {
    role: "user",
    content: [{ type: "text", text: buildBriefingPrompt(handoff) }],
    timestamp: Date.now(),
  };
}

function buildBriefingPrompt(handoff: HandoffArtifact): string {
  return [
    "Create a handoff briefing from this Pi session timeline.",
    "The timeline preserves tool calls, tool results, command output, transcript text, and context summaries. Thinking traces have already been removed.",
    "Prefer concise synthesis over copying raw output. Mention concrete files, commands, commits, tests, failures, and unresolved risks when present.",
    "",
    "<handoff_stats>",
    JSON.stringify(handoff.stats, null, 2),
    "</handoff_stats>",
    "",
    "<timeline>",
    renderTimelineForBriefing(handoff),
    "</timeline>",
  ].join("\n");
}

function renderTimelineForBriefing(handoff: HandoffArtifact): string {
  let remainingChars = MAX_BRIEFING_INPUT_CHARS;
  const sections: string[] = [];

  for (const message of handoff.messages) {
    if (remainingChars <= 0) {
      sections.push("[timeline truncated for briefing generation]");
      break;
    }

    const content = truncateForBriefing(
      message.content,
      Math.min(MAX_TIMELINE_ENTRY_CHARS, remainingChars),
    );
    const section = [
      `### ${message.index}. ${message.role} (${message.kind})`,
      `source_role: ${message.source_role}`,
      `timestamp: ${message.timestamp ?? "null"}`,
      "",
      content,
    ].join("\n");
    sections.push(section);
    remainingChars -= section.length;
  }

  return sections.join("\n\n");
}

function truncateForBriefing(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars < 200) return value.slice(0, maxChars);
  const headSize = Math.floor(maxChars * 0.65);
  const tailSize = Math.max(80, maxChars - headSize - 80);
  return [
    value.slice(0, headSize),
    "",
    `[middle truncated for briefing generation: ${value.length - headSize - tailSize} chars omitted]`,
    "",
    value.slice(value.length - tailSize),
  ].join("\n");
}
