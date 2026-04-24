/**
 * Require Session Name on Exit
 *
 * Ensures every session is named before closing. Prompts for a name on
 * /safe-quit, /q, /quit, or Ctrl+Shift+Q. Installs a small editor wrapper
 * because Pi handles built-in /quit before extension commands or input hooks.
 */

import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

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

function isSafeQuitCommand(text: string): boolean {
  return /^\/(?:q|quit|safe-quit)(?:\s+.*)?$/.test(text.trim());
}

class SafeQuitEditor extends CustomEditor {
  constructor(
    tui: any,
    theme: any,
    private readonly safeQuitKeybindings: any,
    private readonly onSafeQuit: () => Promise<void>,
  ) {
    super(tui, theme, safeQuitKeybindings);
  }

  override handleInput(data: string): void {
    if (this.safeQuitKeybindings.matches(data, "tui.input.submit")) {
      const text = (this.getExpandedText?.() ?? this.getText()).trim();
      if (isSafeQuitCommand(text)) {
        this.setText("");
        void this.onSafeQuit();
        return;
      }
    }

    super.handleInput(data);
  }
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

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui: any, theme: any, keybindings: any) => {
      return new SafeQuitEditor(tui, theme, keybindings, async () => {
        await guardedExit(ctx);
      });
    });

    ctx.ui.addAutocompleteProvider((current: any) => ({
      async getSuggestions(lines: string[], line: number, col: number, options: any) {
        const beforeCursor = (lines[line] ?? "").slice(0, col);
        const match = beforeCursor.match(/^\/(q|safe-quit)?$/);
        if (!match) return current.getSuggestions(lines, line, col, options);

        const query = match[1] ?? "";
        const commands = [
          {
            value: "/q",
            label: "/q",
            description: "Safe quit with session-name enforcement",
          },
          {
            value: "/safe-quit",
            label: "/safe-quit",
            description: "Safe quit with session-name enforcement",
          },
        ];

        return {
          prefix: `/${query}`,
          items: commands.filter((command) => command.value.startsWith(`/${query}`)),
        };
      },
      applyCompletion(lines: string[], line: number, col: number, item: any, prefix: string) {
        return current.applyCompletion(lines, line, col, item, prefix);
      },
      shouldTriggerFileCompletion(lines: string[], line: number, col: number) {
        return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
      },
    }));
  });

  // Built-in /quit is intercepted by the editor wrapper above. Keep explicit
  // guarded aliases for RPC clients and any path that reaches extension commands.
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

  // Shutdown now stops the TUI before emitting session_shutdown, so this hook
  // must not open prompts. It still protects non-editor exits like Ctrl+D or
  // double Ctrl+C by auto-naming unnamed sessions before teardown completes.
  pi.on("session_shutdown", async (event, ctx) => {
    if (event.reason === "reload") return;

    const current = normalizeName(pi.getSessionName());
    if (current) return;

    const suggested = getDefaultNameFromFirstUserMessage(ctx);
    pi.setSessionName(`${getEasternTimestamp()} ${suggested}`);
  });
}
