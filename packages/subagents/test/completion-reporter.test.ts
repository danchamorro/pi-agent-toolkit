import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CompletionReporter } from "../completion-reporter.ts";
import type { StatusMessageOptions, SubagentRecord } from "../types.ts";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PostedMessage = { content: string; options: StatusMessageOptions };

function harness(initialBehavior: string | undefined = undefined) {
  const records = new Map<string, SubagentRecord>();
  const posted: PostedMessage[] = [];
  let behavior = initialBehavior;

  const reporter = new CompletionReporter({
    getRecord: (id) => records.get(id),
    allRecords: () => records.values(),
    post: (content, options) => posted.push({ content, options }),
    getStreamingBehavior: () => behavior,
  });

  function addRecord(
    overrides: Partial<SubagentRecord> & Pick<SubagentRecord, "id">,
  ): SubagentRecord {
    const record = {
      name: overrides.id,
      task: "Task.",
      cwd: "/repo",
      status: "completed",
      startedAt: 0,
      lastActivityAt: 0,
      activity: "Done.",
      feedbackSerial: 0,
      toolCalls: new Map(),
      notifyOnCompletion: false,
      reportCompletionToMain: true,
      ...overrides,
    } as SubagentRecord;
    records.set(record.id, record);
    return record;
  }

  return {
    reporter,
    posted,
    addRecord,
    setBehavior(next: string | undefined) {
      behavior = next;
    },
  };
}

describe("CompletionReporter", () => {
  it("does not report while the launch group is open, then emits one bundle", async () => {
    const { reporter, posted, addRecord } = harness();
    const group = reporter.assignGroup();
    const first = addRecord({ id: "sa-1", completionGroupId: group, result: "Mapped." });
    const second = addRecord({
      id: "sa-2",
      completionGroupId: group,
      status: "failed",
      error: "Boom.",
    });

    reporter.queue(first);
    reporter.queue(second);
    assert.equal(posted.length, 0);

    await wait(150);
    assert.equal(posted.length, 1);
    assert.match(posted[0].content, /2 delegated sub-agents have finished/);
    assert.match(posted[0].content, /BEGIN UNTRUSTED SUB-AGENT JSON DATA/);
    assert.match(posted[0].content, /Mapped\./);
    assert.match(posted[0].content, /Boom\./);
    assert.equal(posted[0].options.deliverAs, "followUp");
    assert.equal(posted[0].options.triggerTurn, true);
    assert.equal(posted[0].options.display, false);
  });

  it("reports a single finished sub-agent", async () => {
    const { reporter, posted, addRecord } = harness();
    const group = reporter.assignGroup();
    reporter.queue(addRecord({ id: "sa-1", completionGroupId: group, result: "ok" }));

    await wait(150);
    assert.equal(posted.length, 1);
    assert.match(posted[0].content, /A delegated sub-agent has finished/);
    assert.equal(posted[0].options.deliverAs, "followUp");
  });

  it("captures streaming behavior at launch even if it is reset before flush", async () => {
    const { reporter, posted, addRecord, setBehavior } = harness("followUp");
    const group = reporter.assignGroup();
    // Simulate turn_end clearing the live streaming behavior before the group
    // close timer fires.
    setBehavior(undefined);
    reporter.queue(addRecord({ id: "sa-1", completionGroupId: group, result: "ok" }));

    await wait(150);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].options.deliverAs, "nextTurn");
    assert.equal(posted[0].options.triggerTurn, true);
  });

  it("returns false and reports nothing for records not flagged for the main session", () => {
    const { reporter, posted, addRecord } = harness();
    const record = addRecord({ id: "sa-1", reportCompletionToMain: false });
    assert.equal(reporter.queue(record), false);
    assert.equal(posted.length, 0);
  });

  it("reset cancels the pending flush so shutdown does not emit a report", async () => {
    const { reporter, posted, addRecord } = harness();
    const group = reporter.assignGroup();
    reporter.queue(addRecord({ id: "sa-1", completionGroupId: group, result: "ok" }));
    reporter.reset();

    await wait(150);
    assert.equal(posted.length, 0);
  });
});
