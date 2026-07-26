import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { runClaudeSubagent } from "../claude-runner.ts";
import { runCodexSubagent } from "../codex-runner.ts";
import type { ClaudeLaunchConfig, CodexLaunchConfig } from "../launch-config.ts";

const liveClaudeIt = process.env.PI_SUBAGENTS_REAL_CLAUDE === "1" ? it : it.skip;
const liveCodexIt = process.env.PI_SUBAGENTS_REAL_CODEX === "1" ? it : it.skip;
let cwd = "";

afterEach(() => {
  if (cwd) rmSync(cwd, { recursive: true, force: true });
  cwd = "";
});

function base(task = "Reply with exactly LIVE_OK and do not use tools.") {
  cwd = mkdtempSync(join(tmpdir(), "pi-native-subagent-live-"));
  return {
    recordId: "sa-live",
    parentSessionId: "live-parent",
    name: "live",
    task,
    cwd,
    autoExit: false,
    thinkingLevel: "high" as const,
    launchToken: "live-token",
    resolvedEffort: "high" as const,
    neutralInstructions: "Return only the requested text.",
  };
}

const callbacks = {
  activity() {},
  async askMainSession() {
    return "Continue.";
  },
};

describe("native harness live smoke tests", () => {
  liveClaudeIt("completes through Claude Opus 5", async () => {
    const launch: ClaudeLaunchConfig = {
      ...base(),
      harness: "claude",
      backend: "claude-sdk",
      model: "claude-opus-5",
    };
    const result = await runClaudeSubagent(launch, callbacks, new AbortController().signal);
    assert.equal(result.status, "completed", result.error);
    assert.match(result.result ?? "", /LIVE_OK/u);
  });

  liveClaudeIt("round-trips Claude feedback", async () => {
    let question = "";
    const result = await runClaudeSubagent(
      {
        ...base(
          "Call ask_main_session with the exact question LIVE_QUESTION. After its answer, reply exactly LIVE_FEEDBACK_OK.",
        ),
        harness: "claude",
        backend: "claude-sdk",
        model: "claude-opus-5",
      },
      {
        activity() {},
        async askMainSession(value) {
          question = value;
          return "Continue.";
        },
      },
      new AbortController().signal,
    );
    assert.equal(result.status, "completed", result.error);
    assert.equal(question, "LIVE_QUESTION");
    assert.match(result.result ?? "", /LIVE_FEEDBACK_OK/u);
  });

  liveClaudeIt("stops Claude and closes its query", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    const result = await runClaudeSubagent(
      {
        ...base("Run the shell command `sleep 30`, then reply LIVE_TOO_LATE."),
        harness: "claude",
        backend: "claude-sdk",
        model: "claude-opus-5",
      },
      callbacks,
      controller.signal,
    );
    clearTimeout(timer);
    assert.equal(result.status, "stopped", result.error);
  });

  liveCodexIt("completes through Codex app-server", async () => {
    const launch: CodexLaunchConfig = {
      ...base(),
      harness: "codex",
      backend: "codex-app-server",
      model: "gpt-5.6-sol",
      executable: `${process.env.HOME}/.local/bin/codex`,
    };
    const result = await runCodexSubagent(launch, callbacks, new AbortController().signal);
    assert.equal(result.status, "completed", result.error);
    assert.match(result.result ?? "", /LIVE_OK/u);
    assert.ok(
      result.contextUsage?.percent === null || (result.contextUsage?.percent ?? 101) <= 100,
    );
  });

  liveCodexIt("round-trips Codex feedback", async () => {
    let question = "";
    const result = await runCodexSubagent(
      {
        ...base(
          "Call ask_main_session with the exact question LIVE_QUESTION. After its answer, reply exactly LIVE_FEEDBACK_OK.",
        ),
        harness: "codex",
        backend: "codex-app-server",
        model: "gpt-5.6-sol",
        executable: `${process.env.HOME}/.local/bin/codex`,
      },
      {
        activity() {},
        async askMainSession(value) {
          question = value;
          return "Continue.";
        },
      },
      new AbortController().signal,
    );
    assert.equal(result.status, "completed", result.error);
    assert.equal(question, "LIVE_QUESTION");
    assert.match(result.result ?? "", /LIVE_FEEDBACK_OK/u);
  });

  liveCodexIt("stops Codex and closes its app-server", async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    const result = await runCodexSubagent(
      {
        ...base("Run the shell command `sleep 30`, then reply LIVE_TOO_LATE."),
        harness: "codex",
        backend: "codex-app-server",
        model: "gpt-5.6-sol",
        executable: `${process.env.HOME}/.local/bin/codex`,
      },
      callbacks,
      controller.signal,
    );
    clearTimeout(timer);
    assert.equal(result.status, "stopped", result.error);
  });

  liveCodexIt("cleans Codex background terminal processes", async () => {
    const result = await runCodexSubagent(
      {
        ...base(
          "Run exactly this shell command: `sleep 30 >/dev/null 2>&1 & echo $! > codex-background.pid`. Then reply exactly LIVE_PID_OK.",
        ),
        harness: "codex",
        backend: "codex-app-server",
        model: "gpt-5.6-sol",
        executable: `${process.env.HOME}/.local/bin/codex`,
      },
      callbacks,
      new AbortController().signal,
    );
    assert.equal(result.status, "completed", result.error);
    assert.match(result.result ?? "", /LIVE_PID_OK/u);

    const pid = Number(readFileSync(join(cwd, "codex-background.pid"), "utf8").trim());
    assert.ok(Number.isInteger(pid) && pid > 0);
    let running = true;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          running = false;
          break;
        }
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
    }
    if (running) process.kill(pid, "SIGKILL");
    assert.equal(running, false);
  });
});
