import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import childRuntimeExtension, {
  createChildActivityWriter,
  readChildRuntimeEnvironment,
} from "../child-runtime.ts";
import {
  COORDINATION_VERSION,
  MAX_COORDINATION_FILE_BYTES,
  cleanupCoordinationRun,
  createCoordinationPaths,
  isActivitySnapshot,
  readCoordinationJson,
  writeCoordinationJson,
  writePrivateText,
  type CoordinationIdentity,
  type CoordinationPaths,
  type FeedbackRequestFile,
} from "../coordination.ts";

type Handler = (event: Record<string, unknown>, ctx: ExtensionContext) => unknown;
type Tool = {
  name: string;
  constrainedSampling?: unknown;
  parameters?: {
    additionalProperties?: boolean;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  execute: (...args: unknown[]) => unknown;
};

let testDir = "";
let savedEnvironment: Record<string, string | undefined>;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "pi-subagent-child-test-"));
  savedEnvironment = {
    PI_SUBAGENT_RUN_DIR: process.env.PI_SUBAGENT_RUN_DIR,
    PI_SUBAGENT_RECORD_ID: process.env.PI_SUBAGENT_RECORD_ID,
    PI_SUBAGENT_LAUNCH_TOKEN: process.env.PI_SUBAGENT_LAUNCH_TOKEN,
    PI_SUBAGENT_SYSTEM_PROMPT_FILE: process.env.PI_SUBAGENT_SYSTEM_PROMPT_FILE,
    PI_SUBAGENT_NAME: process.env.PI_SUBAGENT_NAME,
    PI_SUBAGENT_AUTO_EXIT: process.env.PI_SUBAGENT_AUTO_EXIT,
  };
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  rmSync(testDir, { recursive: true, force: true });
});

describe("coordination protocol", () => {
  it("creates private collision-safe run paths", () => {
    const first = createRun("parent-1", "sa-1");
    const second = createRun("parent-2", "sa-1");

    assert.notEqual(first.runDirectory, second.runDirectory);
    assert.equal(statSync(first.runDirectory).mode & 0o777, 0o700);
    writePrivateText(first.task, "Task.");
    assert.equal(statSync(first.task).mode & 0o777, 0o600);
  });

  it("atomically validates identity, sequence, and size", () => {
    const paths = createRun("parent-1", "sa-1");
    const identity = identityFor(paths);
    writeCoordinationJson(paths.activity, {
      version: COORDINATION_VERSION,
      ...identity,
      sequence: 2,
      phase: "running",
      event: "agent_start",
      updatedAt: Date.now(),
    });

    const valid = readCoordinationJson(paths.activity, identity, isActivitySnapshot, 1);
    assert.equal(valid.ok, true);
    assert.equal(statSync(paths.activity).mode & 0o777, 0o600);
    assert.deepEqual(
      readdirSync(paths.runDirectory).filter((name) => name.endsWith(".tmp")),
      [],
    );
    assert.equal(
      readReason(readCoordinationJson(paths.activity, identity, isActivitySnapshot, 2)),
      "stale",
    );
    assert.equal(
      readReason(
        readCoordinationJson(paths.activity, { ...identity, recordId: "sa-2" }, isActivitySnapshot),
      ),
      "wrong-record",
    );
    assert.equal(
      readReason(
        readCoordinationJson(
          paths.activity,
          { ...identity, launchToken: randomUUID() },
          isActivitySnapshot,
        ),
      ),
      "wrong-token",
    );

    writeFileSync(paths.control, "x".repeat(MAX_COORDINATION_FILE_BYTES + 1));
    assert.equal(
      readReason(readCoordinationJson(paths.control, identity, isActivitySnapshot)),
      "oversized",
    );
  });

  it("removes only the validated run directory", () => {
    const paths = createRun("parent-1", "sa-1");
    cleanupCoordinationRun(paths);
    assert.equal(existsSync(paths.runDirectory), false);

    assert.throws(
      () => cleanupCoordinationRun({ ...paths, runDirectory: testDir }),
      /outside the state root/,
    );
  });
});

describe("child activity", () => {
  it("throttles streaming writes and disables after three consecutive failures", async () => {
    const paths = createRun("parent-1", "sa-1");
    const identity = identityFor(paths);
    let now = 1_000;
    const writer = createChildActivityWriter({ identity, path: paths.activity, now: () => now });
    writer.update("agent_start", "running");
    now = 1_050;
    writer.update("message_update", "running", undefined, true);
    assert.equal(JSON.parse(readFileSync(paths.activity, "utf8")).sequence, 0);
    await wait(300);
    assert.equal(JSON.parse(readFileSync(paths.activity, "utf8")).sequence, 1);
    writer.dispose();

    let attempts = 0;
    const failing = createChildActivityWriter({
      identity,
      path: paths.activity,
      write: (() => {
        attempts += 1;
        throw new Error("disk unavailable");
      }) as typeof writeCoordinationJson,
    });
    for (let index = 0; index < 5; index += 1) {
      failing.update("agent_start", "running");
    }
    assert.equal(attempts, 3);
    assert.equal(failing.isDisabled(), true);
  });
});

describe("interactive child extension", () => {
  it("uses strict sampling only for the strict-compatible completion tool", () => {
    const paths = createRun("parent-1", "sa-1");
    setRuntimeEnvironment(paths, false);
    const harness = createHarness();
    childRuntimeExtension(harness.pi);

    const askMainSession = harness.tools.get("ask_main_session");
    assert.ok(askMainSession, "ask_main_session is not registered");
    assert.equal(askMainSession.constrainedSampling, undefined);

    const subagentDone = harness.tools.get("subagent_done");
    assert.ok(subagentDone, "subagent_done is not registered");
    assert.deepEqual(subagentDone.constrainedSampling, {
      type: "json_schema",
      strict: "prefer",
    });
    assertStrictToolSchema(subagentDone);

    for (const [toolName, tool] of harness.tools) {
      if (toolName !== "subagent_done") {
        assert.equal(tool.constrainedSampling, undefined);
      }
    }
  });

  it("auto-exits exactly once after agent_settled", async () => {
    const paths = createRun("parent-1", "sa-1");
    setRuntimeEnvironment(paths, true);
    const harness = createHarness();
    const context = createContext();
    childRuntimeExtension(harness.pi);

    await harness.emit("session_start", context);
    await harness.emit("agent_settled", context);
    const firstExit = readFileSync(paths.exit, "utf8");
    await harness.emit("agent_settled", context);

    assert.equal(JSON.parse(firstExit).status, "completed");
    assert.deepEqual(JSON.parse(firstExit).contextUsage, {
      tokens: 123,
      contextWindow: 1_000,
      percent: 12.3,
    });
    assert.equal(readFileSync(paths.exit, "utf8"), firstExit);
    assert.equal(context.shutdownCount, 1);
  });

  it("keeps non-auto-exit children waiting until subagent_done persists a result", async () => {
    const paths = createRun("parent-1", "sa-1");
    setRuntimeEnvironment(paths, false);
    const harness = createHarness();
    const context = createContext();
    childRuntimeExtension(harness.pi);

    await harness.emit("session_start", context);
    await harness.emit("agent_settled", context);
    assert.equal(existsSync(paths.exit), false);
    const activity = JSON.parse(readFileSync(paths.activity, "utf8"));
    assert.equal(activity.phase, "waiting");
    assert.deepEqual(activity.contextUsage, {
      tokens: 123,
      contextWindow: 1_000,
      percent: 12.3,
    });

    await assert.rejects(
      harness.tools
        .get("subagent_done")
        ?.execute("tool-1", { result: "   " }, undefined, undefined, context) as Promise<unknown>,
      /requires a non-empty final result/u,
    );
    assert.equal(existsSync(paths.exit), false);

    await harness.tools
      .get("subagent_done")
      ?.execute("tool-2", { result: " Final report. " }, undefined, undefined, context);
    const exit = JSON.parse(readFileSync(paths.exit, "utf8"));
    assert.equal(exit.status, "completed");
    assert.equal(exit.result, "Final report.");
    assert.deepEqual(exit.contextUsage, {
      tokens: 123,
      contextWindow: 1_000,
      percent: 12.3,
    });
    assert.equal(context.shutdownCount, 1);
  });

  it("shuts down when auto-exit completion cannot write its terminal sidecar", async () => {
    const paths = createRun("parent-1", "sa-1");
    setRuntimeEnvironment(paths, true);
    const harness = createHarness();
    const context = createContext();
    childRuntimeExtension(harness.pi);

    await harness.emit("session_start", context);
    mkdirSync(paths.exit);
    const write = process.stderr.write;
    let diagnostic = "";
    process.stderr.write = ((chunk: string | Uint8Array) => {
      diagnostic += chunk.toString();
      return true;
    }) as typeof process.stderr.write;
    try {
      await harness.emit("agent_settled", context);
    } finally {
      process.stderr.write = write;
    }

    assert.match(diagnostic, /Could not write interactive child failure/u);
    assert.equal(context.shutdownCount, 1);
  });

  it("shuts down when subagent_done cannot write its completion result", async () => {
    const paths = createRun("parent-1", "sa-1");
    setRuntimeEnvironment(paths, false);
    const harness = createHarness();
    const context = createContext();
    childRuntimeExtension(harness.pi);

    await harness.emit("session_start", context);
    await harness.tools
      .get("subagent_done")
      ?.execute(
        "tool-1",
        { result: "x".repeat(MAX_COORDINATION_FILE_BYTES) },
        undefined,
        undefined,
        context,
      );

    const exit = JSON.parse(readFileSync(paths.exit, "utf8"));
    assert.equal(exit.status, "failed");
    assert.match(exit.error, /Coordination payload exceeds/u);
    assert.equal(context.shutdownCount, 1);
  });

  it("round-trips feedback only through the matching request", async () => {
    const paths = createRun("parent-1", "sa-1");
    setRuntimeEnvironment(paths, false);
    const harness = createHarness();
    const context = createContext();
    childRuntimeExtension(harness.pi);
    await harness.emit("session_start", context);

    const resultPromise = Promise.resolve(
      harness.tools
        .get("ask_main_session")
        ?.execute(
          "tool-1",
          { question: "Which option?", context: "A or B" },
          undefined,
          undefined,
          context,
        ),
    );
    await waitFor(() => existsSync(paths.feedbackRequest));
    const request = JSON.parse(readFileSync(paths.feedbackRequest, "utf8")) as FeedbackRequestFile;
    writeCoordinationJson(paths.feedbackResponse(request.requestId), {
      version: COORDINATION_VERSION,
      recordId: request.recordId,
      launchToken: request.launchToken,
      sequence: 0,
      requestId: request.requestId,
      response: "Use option B.",
      respondedAt: Date.now(),
    });

    const result = (await resultPromise) as {
      content: Array<{ text: string }>;
      details: { status: string };
    };
    assert.equal(result.content[0]?.text, "Use option B.");
    assert.equal(result.details.status, "answered");
    assert.equal(existsSync(paths.feedbackRequest), false);
    await harness.emit("session_shutdown", context);
  });

  it("cancels a feedback wait when a matching stop arrives", async () => {
    const paths = createRun("parent-1", "sa-1");
    setRuntimeEnvironment(paths, false);
    const harness = createHarness();
    const context = createContext();
    childRuntimeExtension(harness.pi);
    await harness.emit("session_start", context);

    const resultPromise = Promise.resolve(
      harness.tools
        .get("ask_main_session")
        ?.execute("tool-1", { question: "Continue?" }, undefined, undefined, context),
    );
    await waitFor(() => existsSync(paths.feedbackRequest));
    writeCoordinationJson(paths.control, {
      version: COORDINATION_VERSION,
      ...identityFor(paths),
      sequence: 0,
      action: "stop",
      reason: "Cancelled by parent.",
    });
    await waitFor(() => context.shutdownCount === 1);
    const result = (await resultPromise) as { details: { status: string } };

    assert.equal(result.details.status, "cancelled");
    assert.equal(JSON.parse(readFileSync(paths.exit, "utf8")).status, "stopped");
    assert.equal(existsSync(paths.feedbackRequest), false);
  });

  it("contains shutdown rejection from interval-driven stop polling", async () => {
    const paths = createRun("parent-1", "sa-1");
    setRuntimeEnvironment(paths, false);
    const harness = createHarness();
    const context = createContext({ rejectShutdown: true });
    childRuntimeExtension(harness.pi);
    await harness.emit("session_start", context);

    writeCoordinationJson(paths.control, {
      version: COORDINATION_VERSION,
      ...identityFor(paths),
      sequence: 0,
      action: "stop",
      reason: "Test rejected shutdown.",
    });
    await waitFor(() => existsSync(paths.exit));
    await wait(300);

    assert.equal(context.abortCount, 1);
    assert.equal(JSON.parse(readFileSync(paths.exit, "utf8")).status, "stopped");
  });

  it("honors a matching stop control and shuts down gracefully", async () => {
    const paths = createRun("parent-1", "sa-1");
    setRuntimeEnvironment(paths, false);
    const harness = createHarness();
    const context = createContext();
    childRuntimeExtension(harness.pi);
    await harness.emit("session_start", context);

    writeCoordinationJson(paths.control, {
      version: COORDINATION_VERSION,
      ...identityFor(paths),
      sequence: 0,
      action: "stop",
      reason: "Requested by parent.",
    });
    await waitFor(() => context.shutdownCount === 1);

    assert.equal(context.abortCount, 1);
    assert.equal(JSON.parse(readFileSync(paths.exit, "utf8")).status, "stopped");
  });
});

function createRun(parentSessionId: string, recordId: string): CoordinationPaths {
  return createCoordinationPaths({
    parentSessionId,
    recordId,
    launchToken: randomUUID(),
    agentDir: testDir,
  });
}

function identityFor(paths: CoordinationPaths): CoordinationIdentity {
  const match = /^(sa-\d+)-([0-9a-f-]{36})$/u.exec(paths.runDirectory.split("/").at(-1) ?? "");
  assert.ok(match);
  return { recordId: match[1], launchToken: match[2] };
}

function setRuntimeEnvironment(paths: CoordinationPaths, autoExit: boolean): void {
  const identity = identityFor(paths);
  process.env.PI_SUBAGENT_RUN_DIR = paths.runDirectory;
  process.env.PI_SUBAGENT_RECORD_ID = identity.recordId;
  process.env.PI_SUBAGENT_LAUNCH_TOKEN = identity.launchToken;
  process.env.PI_SUBAGENT_SYSTEM_PROMPT_FILE = paths.systemPrompt;
  process.env.PI_SUBAGENT_NAME = "test child";
  process.env.PI_SUBAGENT_AUTO_EXIT = autoExit ? "1" : "0";
  writePrivateText(paths.systemPrompt, "Test system prompt.");
  assert.deepEqual(readChildRuntimeEnvironment(), {
    runDirectory: paths.runDirectory,
    ...identity,
    systemPromptPath: paths.systemPrompt,
    name: "test child",
    autoExit,
  });
}

function createHarness(): {
  pi: ExtensionAPI;
  tools: Map<string, Tool>;
  emit: (type: string, ctx: ExtensionContext) => Promise<void>;
} {
  const handlers = new Map<string, Handler[]>();
  const tools = new Map<string, Tool>();
  const pi = {
    on(type: string, handler: Handler) {
      const existing = handlers.get(type) ?? [];
      existing.push(handler);
      handlers.set(type, existing);
    },
    registerTool(tool: Tool) {
      tools.set(tool.name, tool);
    },
    setSessionName() {},
  } as unknown as ExtensionAPI;

  return {
    pi,
    tools,
    async emit(type, ctx) {
      for (const handler of handlers.get(type) ?? []) {
        await handler({ type }, ctx);
      }
    },
  };
}

function createContext(options: { rejectShutdown?: boolean } = {}): ExtensionContext & {
  abortCount: number;
  shutdownCount: number;
} {
  const context = {
    abortCount: 0,
    shutdownCount: 0,
    abort() {
      context.abortCount += 1;
    },
    getContextUsage() {
      return { tokens: 123, contextWindow: 1_000, percent: 12.3 };
    },
    async shutdown() {
      context.shutdownCount += 1;
      if (options.rejectShutdown) {
        throw new Error("shutdown rejected");
      }
    },
  };
  return context as unknown as ExtensionContext & {
    abortCount: number;
    shutdownCount: number;
  };
}

function readReason<T>(result: { ok: true; value: T } | { ok: false; reason: string }): string {
  assert.equal(result.ok, false);
  return result.reason;
}

function assertStrictToolSchema(tool: Tool): void {
  const properties = Object.keys(tool.parameters?.properties ?? {}).sort();
  assert.equal(
    tool.parameters?.additionalProperties,
    false,
    `${tool.name} allows extra properties`,
  );
  assert.deepEqual(
    tool.parameters?.required?.sort(),
    properties,
    `${tool.name} has optional properties`,
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for child runtime state.");
    }
    await wait(20);
  }
}
