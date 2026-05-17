import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHandoffArtifact } from "./shared/handoff/extractor-core.ts";
import { createPiBranchSnapshot } from "./pi-branch-parser.ts";

describe("createPiBranchSnapshot", () => {
  it("normalizes Pi message entries and strips nonportable blocks", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      sessionFile: "/tmp/session.jsonl",
      branch: [
        { type: "message", message: { id: "u1", role: "user", content: "Hi" } },
        {
          type: "message",
          message: {
            id: "a1",
            role: "assistant",
            content: [
              { type: "text", text: "Hello" },
              { type: "tool_use", name: "read" },
              { type: "tool_result", content: "hidden" },
              { type: "thinking", text: "hidden" },
            ],
          },
        },
      ],
    });

    const handoff = createHandoffArtifact(snapshot);
    assert.equal(handoff.source.session_file, "/tmp/session.jsonl");
    assert.equal(handoff.messages[0].content, "Hi");
    assert.equal(handoff.messages[1].content, "Hello");
    assert.equal(handoff.stats.tool_calls_removed, 1);
    assert.equal(handoff.stats.tool_results_removed, 1);
    assert.equal(handoff.stats.thinking_blocks_removed, 1);
  });

  it("maps branch summaries to context records", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      branch: [{ type: "branchSummary", id: "b1", summary: "Earlier context" }],
    });
    const handoff = createHandoffArtifact(snapshot);
    assert.equal(handoff.messages[0].role, "context");
    assert.equal(handoff.messages[0].kind, "branch-summary");
    assert.equal(handoff.messages[0].content, "Earlier context");
  });

  it("strips tool-call and tool-result message entries", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      branch: [
        { type: "message", message: { id: "tc1", role: "toolCall", content: "hidden" } },
        { type: "message", message: { id: "tr1", role: "toolResult", content: "hidden" } },
      ],
    });
    const handoff = createHandoffArtifact(snapshot);
    assert.equal(handoff.messages.length, 0);
    assert.equal(handoff.stats.omitted_empty_messages, 2);
    assert.equal(handoff.stats.tool_calls_removed, 1);
    assert.equal(handoff.stats.tool_results_removed, 1);
  });

  it("omits known non-transcript settings entries without warnings", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      branch: [
        { type: "model_change" },
        { type: "thinking_level_change" },
        { type: "session_info" },
      ],
    });
    const handoff = createHandoffArtifact(snapshot);
    assert.deepEqual(handoff.warnings, []);
    assert.equal(handoff.stats.source_entries_seen, 0);
    assert.equal(handoff.messages.length, 0);
  });

  it("warns on unknown entries", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      branch: [{ type: "customThing" }],
    });
    const handoff = createHandoffArtifact(snapshot);
    assert.equal(handoff.warnings[0], "Unknown content block: customThing");
    assert.equal(handoff.messages.length, 0);
  });
});
