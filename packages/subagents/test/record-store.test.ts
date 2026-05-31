import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { getSubagentRunsDir, persistSubagentRecord } from "../persistence.ts";
import { SubagentStore } from "../record-store.ts";
import type { SubagentRecord, SubagentRole, SubagentStatus } from "../types.ts";

let testDir = "";
let previousAgentDir: string | undefined;

function createRecord(
  overrides: Partial<SubagentRecord> & Pick<SubagentRecord, "id">,
): SubagentRecord {
  const now = Date.now();
  return {
    name: overrides.name ?? overrides.id,
    task: overrides.task ?? "Task.",
    cwd: overrides.cwd ?? testDir,
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? now,
    lastActivityAt: overrides.lastActivityAt ?? now,
    activity: overrides.activity ?? "Working.",
    feedbackSerial: 0,
    toolCalls: new Map(),
    notifyOnCompletion: true,
    reportCompletionToMain: false,
    ...overrides,
  };
}

function readPersisted(id: string): { activity: string; status: SubagentStatus } {
  const parsed = JSON.parse(readFileSync(join(getSubagentRunsDir(), `${id}.json`), "utf8"));
  return { activity: parsed.activity, status: parsed.status };
}

describe("SubagentStore", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "pi-subagents-store-test-"));
    mkdirSync(join(testDir, "agent"), { recursive: true });
    previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(testDir, "agent");
  });

  afterEach(() => {
    if (previousAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  it("allocates sequential ids", () => {
    const store = new SubagentStore(new Map());
    assert.equal(store.nextId(), "sa-1");
    assert.equal(store.nextId(), "sa-2");
    assert.equal(store.nextId(), "sa-3");
  });

  it("finds records by exact id, unique prefix, and reports ambiguity", () => {
    const store = new SubagentStore(new Map());
    store.add(createRecord({ id: "sa-1", name: "scout" }));
    store.add(createRecord({ id: "sa-2", name: "worker" }));

    assert.equal(store.find("sa-1").record?.name, "scout");
    assert.equal(store.find("").error, "Sub-agent id is required.");
    assert.match(store.find("sa-").error ?? "", /ambiguous/);
    assert.match(store.find("sa-9").error ?? "", /was not found/);
  });

  it("resolves a single candidate or explains the choice", () => {
    const store = new SubagentStore(new Map());
    const running = createRecord({ id: "sa-1", name: "scout", status: "running" });
    const waiting = createRecord({ id: "sa-2", name: "worker", status: "running" });
    store.add(running);
    store.add(waiting);

    assert.equal(store.resolveSingle(undefined, [running], "none", "many").record?.id, "sa-1");
    assert.equal(store.resolveSingle(undefined, [], "none", "many").error, "none");
    const ambiguous = store.resolveSingle(undefined, [running, waiting], "none", "many");
    assert.match(
      ambiguous.error ?? "",
      /^many: sa-1 scout \(running\), sa-2 worker \(running\)\.$/,
    );
    assert.equal(
      store.resolveSingle("sa-2", [running, waiting], "none", "many").record?.id,
      "sa-2",
    );
  });

  it("filters active and waiting-for-feedback records", () => {
    const store = new SubagentStore(new Map());
    store.add(createRecord({ id: "sa-1", status: "running" }));
    store.add(createRecord({ id: "sa-2", status: "completed", finishedAt: Date.now() }));
    const waiting = createRecord({ id: "sa-3", status: "waiting for feedback" });
    waiting.pendingFeedback = {
      id: "f1",
      question: "?",
      requestedAt: Date.now(),
      resolve() {},
      cancel() {},
    };
    store.add(waiting);

    assert.deepEqual(
      store.active().map((record) => record.id),
      ["sa-1", "sa-3"],
    );
    assert.deepEqual(
      store.waitingFeedback().map((record) => record.id),
      ["sa-3"],
    );
  });

  it("loads recoverable persisted records and bumps the id counter", () => {
    persistSubagentRecord(createRecord({ id: "sa-5", status: "running" }));

    const roles = new Map<string, SubagentRole>();
    const store = new SubagentStore(roles);
    store.ensurePersistedLoaded(testDir);

    assert.equal(store.get("sa-5")?.status, "interrupted");
    assert.equal(store.nextId(), "sa-6");

    // A second call for the same cwd is a no-op.
    store.ensurePersistedLoaded(testDir);
    assert.equal([...store.values()].length, 1);
  });

  it("debounces activity writes but flushes them on demand", () => {
    const store = new SubagentStore(new Map());
    const record = createRecord({ id: "sa-1", activity: "initial" });
    store.add(record);
    assert.equal(readPersisted("sa-1").activity, "initial");

    record.activity = "debounced";
    store.scheduleActivityPersist(record);
    assert.equal(readPersisted("sa-1").activity, "initial");

    store.flushPending();
    assert.equal(readPersisted("sa-1").activity, "debounced");
  });

  it("writes immediately with persistNow and cancels a pending debounce", () => {
    const store = new SubagentStore(new Map());
    const record = createRecord({ id: "sa-1", activity: "initial" });
    store.add(record);

    record.activity = "scheduled";
    store.scheduleActivityPersist(record);
    record.activity = "immediate";
    store.persistNow(record);
    assert.equal(readPersisted("sa-1").activity, "immediate");

    // flushPending should have nothing left to write after persistNow consumed it.
    record.activity = "after-flush";
    store.flushPending();
    assert.equal(readPersisted("sa-1").activity, "immediate");
  });
});
