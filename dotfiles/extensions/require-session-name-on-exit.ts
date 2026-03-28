import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function normalizeName(name: string | undefined | null): string {
  return (name ?? "").trim();
}

function getDefaultNameFromFirstUserMessage(ctx: any): string {
  const branch = ctx.sessionManager.getBranch();

  for (const entry of branch) {
    if (entry?.type !== "message") continue;
    if (entry?.message?.role !== "user") continue;

    const content = entry.message.content;
    if (typeof content === "string") {
      const value = content.replace(/\s+/g, " ").trim();
      if (value) return value;
      continue;
    }

    if (Array.isArray(content)) {
      const textPart = content.find((part: any) => part?.type === "text" && typeof part?.text === "string");
      const value = (textPart?.text ?? "").replace(/\s+/g, " ").trim();
      if (value) return value;
    }
  }

  return "work session";
}

function getEasternTimestamp(): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = date.find(p => p.type === "year")!.value;
  const m = date.find(p => p.type === "month")!.value;
  const d = date.find(p => p.type === "day")!.value;

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);
  const compact = time.replace(/\s/g, "");

  return `${y}-${m}-${d} ${compact}`;
}

function isShutdownFromReload(): boolean {
  const stack = new Error().stack ?? "";
  return stack.includes("AgentSession.reload") || stack.includes("handleReloadCommand");
}

async function ensureSessionNameAndConfirmExit(pi: ExtensionAPI, ctx: any): Promise<boolean> {
  if (!ctx.hasUI) return false;

  const current = normalizeName(pi.getSessionName());
  if (current) {
    const confirmed = await ctx.ui.confirm("Exit session?", `Session: ${current}\n\nDo you want to exit pi now?`);
    if (!confirmed) {
      ctx.ui.notify("Exit canceled", "info");
      return false;
    }
    return true;
  }

  const suggested = getDefaultNameFromFirstUserMessage(ctx);
  const input = await ctx.ui.input("Session name required before exit", suggested);
  const name = normalizeName(input);

  if (!name) {
    const fallback = `${getEasternTimestamp()} ${suggested}`;
    pi.setSessionName(fallback);
    ctx.ui.notify(`Auto-named: ${fallback}`, "info");
    return true;
  }

  pi.setSessionName(name);
  ctx.ui.notify(`Session named: ${name}`, "info");
  return true;
}

export default function (pi: ExtensionAPI) {
  const guardedExit = async (ctx: any) => {
    const ok = await ensureSessionNameAndConfirmExit(pi, ctx);
    if (!ok) return;
    ctx.shutdown();
  };

  // Built-in /quit and /exit cannot be overridden by extensions.
  // Provide guarded alternatives.
  pi.registerCommand("safe-quit", {
    description: "Exit pi with guardrails (requires session name, confirms if already named)",
    handler: async (_args, ctx) => {
      await guardedExit(ctx);
    },
  });

  pi.registerCommand("q", {
    description: "Alias for /safe-quit",
    handler: async (_args, ctx) => {
      await guardedExit(ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+q", {
    description: "Safe exit with session-name enforcement",
    handler: async (ctx) => {
      await guardedExit(ctx);
    },
  });

  // Catch built-in /quit (which cannot be overridden by extension commands).
  // Note: session_shutdown also fires on /reload, so we skip prompts in that path.
  pi.on("session_shutdown", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    if (isShutdownFromReload()) return;

    const current = normalizeName(pi.getSessionName());
    if (current) return;

    const suggested = getDefaultNameFromFirstUserMessage(ctx);
    const input = await ctx.ui.input("Session is closing. Enter a name to save it", suggested);
    const name = normalizeName(input);

    if (!name) {
      const fallback = `${getEasternTimestamp()} ${suggested}`;
      pi.setSessionName(fallback);
      ctx.ui.notify(`Auto-named: ${fallback}`, "info");
      return;
    }

    pi.setSessionName(name);
    ctx.ui.notify(`Session named: ${name}`, "info");
  });
}
