/**
 * Handoff Export Extension
 *
 * Command: /handoff-export
 *
 * Exports the current active Pi session branch to `.handoffs/` as a clean,
 * portable handoff artifact. The command preserves user and assistant text,
 * strips tool calls, tool results, and thinking blocks, and writes both the
 * canonical `handoff.json` plus a human-readable `handoff.md` companion.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHandoffArtifact } from "./shared/handoff/extractor-core.ts";
import { writeHandoffArtifact } from "./shared/handoff/write-output.ts";
import { createPiBranchSnapshot } from "./pi-branch-parser.ts";

interface HandoffSessionManager {
  getBranch(): unknown[];
  getSessionFile(): string | null;
  getSessionId?: () => string | null;
}

interface HandoffContext {
  cwd?: string;
  sessionManager: HandoffSessionManager;
  ui: {
    notify(message: string, level?: "info" | "warning" | "error" | string): void;
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("handoff-export", {
    description: "Export the current Pi session branch to .handoffs/",
    handler: async (_args, ctx) => {
      const handoffCtx = ctx as HandoffContext;
      try {
        const cwd = handoffCtx.cwd ?? process.cwd();
        const branch = handoffCtx.sessionManager.getBranch();
        const sessionFile = handoffCtx.sessionManager.getSessionFile();
        const sessionId = handoffCtx.sessionManager.getSessionId?.() ?? null;
        const snapshot = createPiBranchSnapshot({ branch, cwd, sessionFile, sessionId });
        const handoff = createHandoffArtifact(snapshot);
        await writeHandoffArtifact(handoff, { cwd, addGitignore: "ask" });
        ctx.ui.notify(`Handoff exported to ${handoff.output.json_file}`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Handoff export failed: ${message}`, "error");
      }
    },
  });
}
