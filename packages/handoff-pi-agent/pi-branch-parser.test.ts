import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHandoffArtifact } from "./shared/handoff/extractor-core.ts";
import { createPiBranchSnapshot } from "./pi-branch-parser.ts";

describe("createPiBranchSnapshot", () => {
  it("normalizes Pi message entries and preserves tool evidence", () => {
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
              { type: "tool_use", name: "read", arguments: { path: "src/app.ts" } },
              { type: "thinking", text: "hidden" },
            ],
          },
        },
        {
          type: "message",
          message: {
            id: "tr1",
            role: "toolResult",
            toolName: "read",
            toolCallId: "call_1",
            content: [{ type: "text", text: "file contents" }],
            isError: false,
          },
        },
      ],
    });

    const handoff = createHandoffArtifact(snapshot);
    assert.equal(handoff.source.session_file, "/tmp/session.jsonl");
    assert.equal(handoff.messages[0].content, "Hi");
    assert.match(handoff.messages[1].content, /Hello/);
    assert.match(handoff.messages[1].content, /name: read/);
    assert.match(handoff.messages[1].content, /arguments: {"path":"src\/app\.ts"}/);
    assert.equal(handoff.messages[2].kind, "tool-result");
    assert.match(handoff.messages[2].content, /tool: read/);
    assert.match(handoff.messages[2].content, /file contents/);
    assert.equal(handoff.stats.tool_calls_preserved, 1);
    assert.equal(handoff.stats.tool_results_preserved, 1);
    assert.equal(handoff.stats.thinking_blocks_removed, 1);
  });

  it("preserves bash execution messages as command evidence", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      branch: [
        {
          type: "message",
          id: "b1",
          message: {
            role: "bashExecution",
            command: "pnpm verify",
            output: "all checks passed",
            exitCode: 0,
            cancelled: false,
            truncated: false,
          },
        },
      ],
    });

    const handoff = createHandoffArtifact(snapshot);
    assert.equal(handoff.messages[0].kind, "bash-execution");
    assert.match(handoff.messages[0].content, /command: pnpm verify/);
    assert.match(handoff.messages[0].content, /all checks passed/);
    assert.equal(handoff.stats.bash_executions_preserved, 1);
    assert.deepEqual(handoff.warnings, []);
  });

  it("maps branch summaries to context records", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      branch: [{ type: "branch_summary", id: "b1", summary: "Earlier context" }],
    });
    const handoff = createHandoffArtifact(snapshot);
    assert.equal(handoff.messages[0].role, "context");
    assert.equal(handoff.messages[0].kind, "branch-summary");
    assert.equal(handoff.messages[0].content, "Earlier context");
  });

  it("preserves custom messages that participate in context", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      branch: [
        {
          type: "custom_message",
          id: "c1",
          customType: "subagent-result",
          content: "Reviewer found no blockers.",
          display: true,
        },
      ],
    });
    const handoff = createHandoffArtifact(snapshot);
    assert.equal(handoff.messages[0].role, "context");
    assert.equal(handoff.messages[0].kind, "custom-message");
    assert.equal(handoff.messages[0].content, "Reviewer found no blockers.");
  });

  it("preserves compacted branch history and marks compactions as context", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      branch: [
        { type: "message", id: "u1", message: { role: "user", content: "Before compact" } },
        {
          type: "message",
          id: "a1",
          message: { role: "assistant", content: "Pre-compact answer" },
        },
        {
          type: "compaction",
          id: "c1",
          summary: "Compact summary of earlier context",
          firstKeptEntryId: "u2",
        },
        { type: "message", id: "u2", message: { role: "user", content: "After compact" } },
      ],
    });

    const handoff = createHandoffArtifact(snapshot);
    assert.deepEqual(
      handoff.messages.map((message) => [message.role, message.kind, message.content]),
      [
        ["user", "message", "Before compact"],
        ["assistant", "message", "Pre-compact answer"],
        ["context", "compaction-summary", "Compact summary of earlier context"],
        ["user", "message", "After compact"],
      ],
    );
  });

  it("omits known non-context state entries without warnings", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      branch: [
        { type: "custom", customType: "tilldone-state", data: { enabled: true } },
        { type: "label", targetId: "u1", label: "bookmark" },
        { type: "model_change" },
        { type: "thinking_level_change" },
        { type: "session_info" },
      ],
    });
    const handoff = createHandoffArtifact(snapshot);
    assert.deepEqual(handoff.warnings, []);
    assert.equal(handoff.stats.source_entries_seen, 5);
    assert.equal(handoff.stats.omitted_non_context_entries, 5);
    assert.equal(handoff.messages.length, 0);
  });

  it("warns on unknown entries", () => {
    const snapshot = createPiBranchSnapshot({
      cwd: "/tmp/project",
      branch: [{ type: "customThing" }],
    });
    const handoff = createHandoffArtifact(snapshot);
    assert.equal(handoff.warnings[0], "Unknown content block: customThing");
    assert.equal(handoff.stats.unknown_entries_seen, 1);
    assert.equal(handoff.messages.length, 0);
  });
});
