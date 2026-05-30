import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  getSubagentRunsDir,
  loadPersistedSubagentRecords,
  persistSubagentRecord,
} from "../persistence.ts";
import type { SubagentRecord } from "../types.ts";

let testDir = "";
let previousAgentDir: string | undefined;

describe("sub-agent persistence", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "pi-subagents-persistence-test-"));
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

  it("stores completed run metadata without loading it as recoverable state", () => {
    const record = createRecord({ status: "completed", result: "Done." });

    persistSubagentRecord(record);

    const loaded = loadPersistedSubagentRecords(new Map(), { cwd: testDir });
    assert.equal(getSubagentRunsDir(), join(testDir, "agent", "state", "subagents", "runs"));
    assert.equal(loaded.length, 0);
  });

  it("marks active records as interrupted after reload", () => {
    const record = createRecord({ status: "running" });

    persistSubagentRecord(record);

    const loaded = loadPersistedSubagentRecords(new Map(), { cwd: testDir });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].status, "interrupted");
    assert.equal(loaded[0].activity, "Interrupted by Pi reload or restart.");
    assert.equal(typeof loaded[0].finishedAt, "number");
  });

  it("does not load records from a different working directory", () => {
    const record = createRecord({ status: "running" });

    persistSubagentRecord(record);

    const loaded = loadPersistedSubagentRecords(new Map(), { cwd: join(testDir, "other") });
    assert.equal(loaded.length, 0);
  });

  it("does not load stale recoverable records", () => {
    const now = Date.now();
    const record = createRecord({
      status: "running",
      startedAt: now - 5 * 60 * 60 * 1000,
      lastActivityAt: now - 5 * 60 * 60 * 1000,
    });

    persistSubagentRecord(record);

    const loaded = loadPersistedSubagentRecords(new Map(), { cwd: testDir, now });
    assert.equal(loaded.length, 0);
  });
});

function createRecord(overrides: Partial<SubagentRecord> = {}): SubagentRecord {
  const now = Date.now();
  return {
    id: "sa-1",
    name: "Test sub-agent",
    task: "Test task.",
    cwd: testDir,
    status: "running",
    startedAt: now,
    lastActivityAt: now,
    activity: "Running.",
    feedbackSerial: 0,
    toolCalls: new Map(),
    notifyOnCompletion: true,
    reportCompletionToMain: false,
    ...overrides,
  };
}
