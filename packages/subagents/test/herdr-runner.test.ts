import assert from "node:assert/strict";
import { copyFileSync, existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
  buildChildEnvironment,
  buildChildPiArguments,
  runHerdrSubagent,
  type HerdrController,
} from "../herdr-runner.ts";
import {
  COORDINATION_VERSION,
  createCoordinationPaths,
  writeCoordinationJson,
  type CoordinationPaths,
} from "../coordination.ts";
import type { HerdrChild } from "../herdr.ts";
import type { PiLaunchConfig } from "../launch-config.ts";

let testDir = "";

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "pi-subagent-herdr-runner-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("child Pi launch", () => {
  it("uses explicit resource isolation and keeps private content out of argv", () => {
    const launch = createLaunch();
    const paths = createPaths(launch);
    const args = buildChildPiArguments({
      launch,
      paths,
      childRuntimePath: "/package/child-runtime.ts",
    });
    const environment = buildChildEnvironment(launch, paths);

    assert.deepEqual(args, [
      "--session",
      paths.session,
      "--model",
      "test-provider/test-model",
      "--thinking",
      "high",
      "--tools",
      "read,bash,ask_main_session,subagent_done",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-approve",
      "-e",
      "/package/child-runtime.ts",
      `@${paths.task}`,
    ]);
    assert.equal(environment.PI_SUBAGENT_AUTO_EXIT, "1");
    assert.equal(environment.PI_SUBAGENT_SYSTEM_PROMPT_FILE, paths.systemPrompt);
    assert.doesNotMatch(args.join(" "), /Exact private prompt|Inspect the repository/u);
  });
});

describe("runHerdrSubagent", () => {
  it("falls back before agent dispatch", async () => {
    const controller = createController();
    controller.ensureServer = async () => {
      throw new Error("Herdr unavailable");
    };
    let dispatched = false;

    const result = await runHerdrSubagent({
      launch: createLaunch(),
      controller,
      agentDir: testDir,
      onDispatch: () => {
        dispatched = true;
      },
    });

    assert.deepEqual(result, { kind: "fallback", reason: "Herdr unavailable" });
    assert.equal(dispatched, false);
  });

  it("cleans a partially written coordination run when setup fails", async () => {
    const launch = createLaunch();
    const paths = createPaths(launch);
    rmSync(paths.runDirectory, { recursive: true, force: true });
    launch.systemPrompt = Symbol("invalid prompt") as unknown as string;

    const result = await runHerdrSubagent({
      launch,
      controller: createController(),
      agentDir: testDir,
    });

    assert.equal(result.kind, "fallback");
    assert.equal(existsSync(paths.runDirectory), false);
  });

  it("never falls back after agent dispatch may have occurred", async () => {
    const controller = createController();
    controller.startAgent = async (_child, _args, options) => {
      options?.onAttempt?.();
      throw new Error("agent start transport failed");
    };

    const result = await runHerdrSubagent({
      launch: createLaunch(),
      controller,
      agentDir: testDir,
    });

    assert.deepEqual(result, {
      kind: "terminal",
      status: "failed",
      error: "agent start transport failed",
    });
    assert.equal(controller.closed, 1);
  });

  it("observes activity and extracts the terminal assistant result", async () => {
    const launch = createLaunch();
    const controller = createController();
    let paths: CoordinationPaths | undefined;
    const activities: string[] = [];
    controller.startAgent = async (_child, _args, options) => {
      options?.onAttempt?.();
      assert.ok(paths);
      writeCoordinationJson(paths.activity, {
        version: COORDINATION_VERSION,
        recordId: launch.recordId,
        launchToken: launch.launchToken,
        sequence: 0,
        phase: "running",
        event: "session_start",
        updatedAt: Date.now(),
      });
      writeSession(paths, "Child result.");
      writeCoordinationJson(paths.exit, {
        version: COORDINATION_VERSION,
        recordId: launch.recordId,
        launchToken: launch.launchToken,
        sequence: 1,
        status: "completed",
        finishedAt: Date.now(),
        contextUsage: { tokens: 12, contextWindow: 1_000, percent: 1.2 },
      });
    };

    const result = await runHerdrSubagent({
      launch,
      controller,
      agentDir: testDir,
      onPrepared: (createdPaths) => {
        paths = createdPaths;
      },
      onActivity: (activity) => activities.push(activity.event),
    });

    assert.deepEqual(result, {
      kind: "terminal",
      status: "completed",
      result: "Child result.",
      contextUsage: { tokens: 12, contextWindow: 1_000, percent: 1.2 },
    });
    assert.deepEqual(activities, ["session_start"]);
    assert.equal(controller.closed, 1);
    assert.equal(paths ? existsSync(paths.runDirectory) : true, false);
  });

  it("returns an explicit completion result without requiring assistant transcript text", async () => {
    const launch = createLaunch();
    const controller = createController();
    let paths: CoordinationPaths | undefined;
    controller.startAgent = async (_child, _args, options) => {
      options?.onAttempt?.();
      assert.ok(paths);
      writeCoordinationJson(paths.activity, {
        version: COORDINATION_VERSION,
        recordId: launch.recordId,
        launchToken: launch.launchToken,
        sequence: 0,
        phase: "running",
        event: "session_start",
        updatedAt: Date.now(),
      });
      writeCoordinationJson(paths.exit, {
        version: COORDINATION_VERSION,
        recordId: launch.recordId,
        launchToken: launch.launchToken,
        sequence: 1,
        status: "completed",
        finishedAt: Date.now(),
        result: "Explicit tool result.",
        contextUsage: { tokens: 12, contextWindow: 1_000, percent: 1.2 },
      });
    };

    const result = await runHerdrSubagent({
      launch,
      controller,
      agentDir: testDir,
      onPrepared: (createdPaths) => {
        paths = createdPaths;
      },
    });

    assert.deepEqual(result, {
      kind: "terminal",
      status: "completed",
      result: "Explicit tool result.",
      contextUsage: { tokens: 12, contextWindow: 1_000, percent: 1.2 },
    });
    assert.equal(controller.closed, 1);
  });

  it("marks a manually closed Herdr tab as interrupted", async () => {
    const controller = createController();
    controller.childExists = async () => false;

    const result = await runHerdrSubagent({
      launch: createLaunch(),
      controller,
      agentDir: testDir,
    });

    assert.deepEqual(result, {
      kind: "terminal",
      status: "interrupted",
      error: "Interactive Herdr child tab was closed.",
    });
  });

  it("fails after dispatch when child startup activity never arrives", async () => {
    const controller = createController();
    let now = 0;

    const result = await runHerdrSubagent({
      launch: createLaunch(),
      controller,
      agentDir: testDir,
      startupTimeoutMs: 300,
      pollMs: 100,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    });

    assert.equal(result.kind, "terminal");
    assert.equal(result.kind === "terminal" ? result.status : undefined, "failed");
    assert.match(result.kind === "terminal" ? (result.error ?? "") : "", /did not start/u);
  });
});

function createLaunch(): PiLaunchConfig {
  return {
    harness: "pi",
    backend: "herdr",
    recordId: "sa-1",
    parentSessionId: "parent-session",
    name: "scout",
    task: "Inspect the repository.",
    cwd: testDir,
    model: { provider: "test-provider", id: "test-model" } as Model<Api>,
    thinkingLevel: "high",
    tools: ["read", "bash", "ask_main_session"],
    systemPrompt: "Exact private prompt.",
    autoExit: true,
    openInHerdr: true,
    launchToken: "11111111-1111-4111-8111-111111111111",
  };
}

function createPaths(launch: PiLaunchConfig): CoordinationPaths {
  return createCoordinationPaths({
    parentSessionId: launch.parentSessionId,
    recordId: launch.recordId,
    launchToken: launch.launchToken,
    agentDir: testDir,
  });
}

function createController(): HerdrController & { closed: number } {
  const child: HerdrChild = {
    recordId: "sa-1",
    workspaceLabel: "Subagents repo abcdef12",
    tabLabel: "sa-1: scout",
    workspaceId: "w1",
    tabId: "w1:t1",
    paneId: "w1:p1",
  };
  const controller = {
    sessionName: "pi-subagents-test",
    closed: 0,
    async ensureServer() {},
    async createChild() {
      return child;
    },
    async startAgent(_child: HerdrChild, _args: string[], options?: { onAttempt?: () => void }) {
      options?.onAttempt?.();
    },
    async childExists() {
      return true;
    },
    async closeChild() {
      controller.closed += 1;
    },
  };
  return controller;
}

function writeSession(paths: CoordinationPaths, text: string): void {
  const session = SessionManager.create(testDir, paths.runDirectory);
  session.appendMessage(createAssistantMessage(text));
  const generatedPath = session.getSessionFile();
  assert.ok(generatedPath);
  copyFileSync(generatedPath, paths.session);
}

function createAssistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "test-provider",
    model: "test-model",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}
