import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  getSubagentRunsDir,
  getSubagentSessionRunsDir,
  loadPersistedSubagentRecords,
  persistSubagentRecord,
} from "../persistence.ts";
import type { SubagentRecord } from "../types.ts";

const PARENT_SESSION_ID = "parent-session-1";
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
    persistSubagentRecord(createRecord({ status: "completed", result: "Done." }));

    const loaded = loadPersistedSubagentRecords(new Map(), {
      parentSessionId: PARENT_SESSION_ID,
    });
    assert.equal(
      getSubagentSessionRunsDir(PARENT_SESSION_ID),
      join(
        testDir,
        "agent",
        "state",
        "subagents",
        "runs",
        Buffer.from(PARENT_SESSION_ID).toString("base64url"),
      ),
    );
    assert.equal(loaded.length, 0);
  });

  it("marks active records from the same parent session as interrupted", () => {
    persistSubagentRecord(createRecord({ status: "running" }));

    const loaded = loadPersistedSubagentRecords(new Map(), {
      parentSessionId: PARENT_SESSION_ID,
    });
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].parentSessionId, PARENT_SESSION_ID);
    assert.equal(loaded[0].status, "interrupted");
    assert.equal(loaded[0].activity, "Interrupted by Pi reload or restart.");
    assert.equal(typeof loaded[0].finishedAt, "number");
  });

  it("does not load records from another parent session in the same cwd", () => {
    persistSubagentRecord(createRecord({ status: "running" }));

    const loaded = loadPersistedSubagentRecords(new Map(), {
      parentSessionId: "parent-session-2",
    });
    assert.equal(loaded.length, 0);
  });

  it("keeps identical record ids isolated between parent sessions", () => {
    persistSubagentRecord(createRecord({ task: "First task." }));
    persistSubagentRecord(
      createRecord({ parentSessionId: "parent-session-2", task: "Second task." }),
    );

    const first = loadPersistedSubagentRecords(new Map(), {
      parentSessionId: PARENT_SESSION_ID,
    });
    const second = loadPersistedSubagentRecords(new Map(), {
      parentSessionId: "parent-session-2",
    });
    assert.equal(first[0]?.task, "First task.");
    assert.equal(second[0]?.task, "Second task.");
  });

  it("ignores legacy flat records without attributable ownership", () => {
    const runsDir = getSubagentRunsDir();
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(
      join(runsDir, "sa-1.json"),
      JSON.stringify({ ...createRecord(), parentSessionId: PARENT_SESSION_ID }),
    );

    const loaded = loadPersistedSubagentRecords(new Map(), {
      parentSessionId: PARENT_SESSION_ID,
    });
    assert.equal(loaded.length, 0);
    assert.equal(existsSync(join(runsDir, "sa-1.json")), true);
  });

  it("does not load stale recoverable records", () => {
    const now = Date.now();
    persistSubagentRecord(
      createRecord({
        status: "running",
        startedAt: now - 5 * 60 * 60 * 1000,
        lastActivityAt: now - 5 * 60 * 60 * 1000,
      }),
    );

    const loaded = loadPersistedSubagentRecords(new Map(), {
      parentSessionId: PARENT_SESSION_ID,
      now,
    });
    assert.equal(loaded.length, 0);
  });
});

function createRecord(overrides: Partial<SubagentRecord> = {}): SubagentRecord {
  const now = Date.now();
  return {
    id: "sa-1",
    parentSessionId: PARENT_SESSION_ID,
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
