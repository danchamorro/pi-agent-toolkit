import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { runCodexSubagent } from "../codex-runner.ts";
import type { CodexLaunchConfig } from "../launch-config.ts";

let testDir = "";
let previousLog: string | undefined;

type FakeCodexOptions = {
  accountResponse?: unknown;
  authStatus?: unknown;
  cleanupResponse?: boolean;
  terminal?: "feedback" | "error" | "interrupted";
  turnStartResponseDelayMs?: number;
};

const chatGptAccount = {
  account: { type: "chatgpt", email: "user@example.com", planType: "pro" },
  requiresOpenaiAuth: true,
};
const chatGptAuthStatus = {
  authMethod: "chatgpt",
  authToken: null,
  requiresOpenaiAuth: true,
};

function writeFakeCodex(options: FakeCodexOptions = {}): string {
  const path = join(testDir, "codex");
  const accountResponse = options.accountResponse ?? chatGptAccount;
  const authStatus = options.authStatus ?? chatGptAuthStatus;
  const cleanupResponse = options.cleanupResponse ?? true;
  const terminal = options.terminal ?? "feedback";
  const turnStartResponseDelayMs = options.turnStartResponseDelayMs ?? 0;
  writeFileSync(
    path,
    `#!/usr/bin/env node
const fs = require("node:fs");
const accountResponse = ${JSON.stringify(accountResponse)};
const authStatus = ${JSON.stringify(authStatus)};
const cleanupResponse = ${JSON.stringify(cleanupResponse)};
const terminal = ${JSON.stringify(terminal)};
const turnStartResponseDelayMs = ${JSON.stringify(turnStartResponseDelayMs)};
if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.145.0\\n");
  process.exit(0);
}
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
let turnRequest;
function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
lines.on("line", (line) => {
  fs.appendFileSync(process.env.CODEX_FAKE_LOG, line + "\\n");
  const message = JSON.parse(line);
  if (message.method === "initialize") send({ id: message.id, result: {} });
  else if (message.method === "account/read") send({ id: message.id, result: accountResponse });
  else if (message.method === "getAuthStatus") send({ id: message.id, result: authStatus });
  else if (message.method === "model/list") send({ id: message.id, result: { data: [{ id: "gpt-5.6-sol", model: "gpt-5.6-sol", supportedReasoningEfforts: [{ reasoningEffort: "high" }] }] } });
  else if (message.method === "thread/start") send({ id: message.id, result: { thread: { id: "thread-1" }, model: "gpt-5.6-sol", reasoningEffort: "high" } });
  else if (message.method === "turn/start") {
    turnRequest = message;
    setTimeout(() => {
      send({ id: message.id, result: { turn: { id: "turn-1" } } });
      if (terminal === "error") {
        send({ method: "error", params: { error: { message: "Codex failed." }, willRetry: false } });
      } else if (terminal === "interrupted") {
        send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "interrupted", error: null } } });
      } else {
        send({ id: 900, method: "item/tool/call", params: { threadId: "thread-1", turnId: "turn-1", callId: "call-1", tool: "ask_main_session", arguments: { question: "Which path?" } } });
      }
    }, turnStartResponseDelayMs);
  } else if (message.id === 900) {
    send({ method: "item/agentMessage/delta", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Done" } });
    send({ method: "thread/tokenUsage/updated", params: { threadId: "thread-1", turnId: "turn-1", tokenUsage: { total: { totalTokens: 3000 }, last: { totalTokens: 100 }, modelContextWindow: 1000 } } });
    send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } } });
  } else if (message.method === "turn/interrupt") {
    send({ id: message.id, result: {} });
    send({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "interrupted", error: null } } });
  } else if (message.method === "thread/backgroundTerminals/clean" && cleanupResponse) {
    send({ id: message.id, result: {} });
  }
});
`,
  );
  chmodSync(path, 0o755);
  return path;
}

function launch(executable: string): CodexLaunchConfig {
  return {
    harness: "codex",
    backend: "codex-app-server",
    recordId: "sa-1",
    parentSessionId: "parent",
    name: "codex",
    task: "Review the change.",
    cwd: testDir,
    autoExit: false,
    thinkingLevel: "high",
    launchToken: "token",
    model: "gpt-5.6-sol",
    resolvedEffort: "high",
    neutralInstructions: "Stay focused.",
    executable,
  };
}

describe("runCodexSubagent", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "pi-codex-runner-test-"));
    previousLog = process.env.CODEX_FAKE_LOG;
    process.env.CODEX_FAKE_LOG = join(testDir, "protocol.log");
  });

  afterEach(() => {
    if (previousLog === undefined) delete process.env.CODEX_FAKE_LOG;
    else process.env.CODEX_FAKE_LOG = previousLog;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("preflights, dispatches with autonomous permissions, and round-trips feedback", async () => {
    const executable = writeFakeCodex();
    const questions: string[] = [];
    const result = await runCodexSubagent(
      launch(executable),
      {
        activity() {},
        async askMainSession(question) {
          questions.push(question);
          return "Use the current path.";
        },
      },
      new AbortController().signal,
    );

    assert.equal(result.status, "completed");
    assert.equal(result.result, "Done");
    assert.equal(result.resolvedModel, "gpt-5.6-sol");
    assert.equal(result.nativeRuntimeVersion, "0.145.0");
    assert.equal(result.contextUsage?.percent, 10);
    assert.deepEqual(questions, ["Which path?"]);
    const logPath = process.env.CODEX_FAKE_LOG;
    assert.ok(logPath);
    const frames = readFileSync(logPath, "utf8");
    assert.match(frames, /"approvalPolicy":"never"/u);
    assert.match(frames, /"sandbox":"danger-full-access"/u);
    assert.match(frames, /"sandboxPolicy":\{"type":"dangerFullAccess"\}/u);
    assert.match(frames, /"text":"Use the current path\."/u);
    assert.match(frames, /"method":"thread\/backgroundTerminals\/clean"/u);
  });

  it("accepts the pinned ChatGPT account shape with a null email", async () => {
    const executable = writeFakeCodex({
      accountResponse: {
        account: { type: "chatgpt", email: null, planType: "enterprise" },
        requiresOpenaiAuth: true,
      },
    });
    const result = await runCodexSubagent(
      launch(executable),
      {
        activity() {},
        async askMainSession() {
          return "Continue.";
        },
      },
      new AbortController().signal,
    );

    assert.equal(result.status, "completed", result.error);
  });

  it("rejects non-ChatGPT and unknown authentication modes", async (context) => {
    const fixtures: Array<{ name: string; accountResponse: unknown; authStatus: unknown }> = [
      {
        name: "API key",
        accountResponse: { account: { type: "apiKey" }, requiresOpenaiAuth: true },
        authStatus: { authMethod: "apikey", authToken: null, requiresOpenaiAuth: true },
      },
      {
        name: "Amazon Bedrock",
        accountResponse: {
          account: { type: "amazonBedrock", usesCodexManagedCredentials: false },
          requiresOpenaiAuth: false,
        },
        authStatus: {
          authMethod: "bedrockApiKey",
          authToken: null,
          requiresOpenaiAuth: false,
        },
      },
      {
        name: "personal access token",
        accountResponse: chatGptAccount,
        authStatus: {
          authMethod: "personalAccessToken",
          authToken: null,
          requiresOpenaiAuth: true,
        },
      },
      {
        name: "unknown",
        accountResponse: chatGptAccount,
        authStatus: {
          authMethod: "futureAuthMode",
          authToken: null,
          requiresOpenaiAuth: true,
        },
      },
    ];

    for (const fixture of fixtures) {
      await context.test(fixture.name, async () => {
        const executable = writeFakeCodex(fixture);
        const result = await runCodexSubagent(
          launch(executable),
          {
            activity() {},
            async askMainSession() {
              return "";
            },
          },
          new AbortController().signal,
        );

        assert.equal(result.status, "failed");
        assert.match(result.error ?? "", /require ChatGPT authentication/u);
      });
    }
  });

  it("does not start an app-server when already aborted", async () => {
    const executable = writeFakeCodex();
    const controller = new AbortController();
    controller.abort();
    const result = await runCodexSubagent(
      launch(executable),
      {
        activity() {},
        async askMainSession() {
          return "";
        },
      },
      controller.signal,
    );

    assert.equal(result.status, "stopped");
  });

  it("interrupts and closes the app-server on stop", async () => {
    const executable = writeFakeCodex();
    const controller = new AbortController();
    const result = await runCodexSubagent(
      launch(executable),
      {
        activity(text) {
          if (text.includes("turn-1")) controller.abort();
        },
        async askMainSession() {
          return await new Promise<string>(() => undefined);
        },
      },
      controller.signal,
    );

    assert.equal(result.status, "stopped");
    assert.match(result.error ?? "", /stopped/u);
    const logPath = process.env.CODEX_FAKE_LOG;
    assert.ok(logPath);
    const frames = readFileSync(logPath, "utf8");
    assert.match(frames, /"method":"turn\/interrupt"/u);
    assert.match(frames, /"method":"thread\/backgroundTerminals\/clean"/u);
  });

  it("cleans before closing when stopped during turn startup", async () => {
    const executable = writeFakeCodex({ turnStartResponseDelayMs: 5_000 });
    const controller = new AbortController();
    const startedAt = Date.now();
    const result = await runCodexSubagent(
      launch(executable),
      {
        activity(text) {
          if (text.includes("ready")) setTimeout(() => controller.abort(), 50);
        },
        async askMainSession() {
          return "";
        },
      },
      controller.signal,
    );

    assert.equal(result.status, "stopped");
    assert.ok(Date.now() - startedAt < 2_500);
    const logPath = process.env.CODEX_FAKE_LOG;
    assert.ok(logPath);
    const frames = readFileSync(logPath, "utf8");
    assert.match(frames, /"method":"turn\/start"/u);
    assert.match(frames, /"method":"thread\/backgroundTerminals\/clean"/u);
  });

  it("cleans background terminals after interrupted and failed turns", async (context) => {
    for (const fixture of [
      { terminal: "interrupted" as const, status: "interrupted" },
      { terminal: "error" as const, status: "failed" },
    ]) {
      await context.test(fixture.status, async () => {
        const executable = writeFakeCodex({ terminal: fixture.terminal });
        const logPath = process.env.CODEX_FAKE_LOG;
        assert.ok(logPath);
        writeFileSync(logPath, "");
        const result = await runCodexSubagent(
          launch(executable),
          {
            activity() {},
            async askMainSession() {
              return "";
            },
          },
          new AbortController().signal,
        );

        assert.equal(result.status, fixture.status);
        const frames = readFileSync(logPath, "utf8");
        assert.match(frames, /"method":"thread\/backgroundTerminals\/clean"/u);
      });
    }
  });

  it("bounds cleanup before falling back to app-server process termination", async () => {
    const executable = writeFakeCodex({ cleanupResponse: false });
    const startedAt = Date.now();
    const result = await runCodexSubagent(
      launch(executable),
      {
        activity() {},
        async askMainSession() {
          return "Continue.";
        },
      },
      new AbortController().signal,
    );

    assert.equal(result.status, "completed", result.error);
    assert.ok(Date.now() - startedAt < 2_500);
    const logPath = process.env.CODEX_FAKE_LOG;
    assert.ok(logPath);
    const frames = readFileSync(logPath, "utf8");
    assert.match(frames, /"method":"thread\/backgroundTerminals\/clean"/u);
  });
});
