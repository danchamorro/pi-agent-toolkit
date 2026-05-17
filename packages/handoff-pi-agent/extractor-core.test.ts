import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHandoffArtifact, type HandoffSnapshot } from "./shared/handoff/extractor-core.ts";
import { renderHandoffMarkdown } from "./shared/handoff/render-markdown.ts";

async function fixture(name: string): Promise<HandoffSnapshot> {
  return JSON.parse(
    await readFile(new URL(`./shared/handoff/fixtures/${name}.json`, import.meta.url), "utf8"),
  );
}

describe("createHandoffArtifact", () => {
  it("preserves simple user and assistant text", async () => {
    const handoff = createHandoffArtifact(await fixture("simple-transcript"), {
      generatedAt: "2026-05-16T14:30:00.000Z",
    });
    assert.equal(handoff.messages.length, 2);
    assert.equal(handoff.messages[0].content, "Please fix the bug.");
    assert.equal(handoff.messages[1].content, "I will inspect the code.");
    assert.equal(handoff.output.directory, ".handoffs/2026-05-16-1430-pi-agent");
  });

  it("strips tool calls and results while preserving text", async () => {
    const handoff = createHandoffArtifact(await fixture("tool-heavy"));
    assert.equal(handoff.messages[0].content, "I found the file.\nThe fix is small.");
    assert.equal(handoff.stats.tool_calls_removed, 1);
    assert.equal(handoff.stats.tool_results_removed, 1);
  });

  it("strips thinking blocks", async () => {
    const handoff = createHandoffArtifact(await fixture("thinking-heavy"));
    assert.equal(handoff.messages[0].content, "Final answer only.");
    assert.equal(handoff.stats.thinking_blocks_removed, 1);
  });

  it("keeps branch summaries as context records", async () => {
    const handoff = createHandoffArtifact(await fixture("pi-branch-summary"));
    assert.equal(handoff.messages[0].role, "context");
    assert.equal(handoff.messages[0].kind, "branch-summary");
  });

  it("omits messages that are empty after stripping", async () => {
    const handoff = createHandoffArtifact(await fixture("empty-after-stripping"));
    assert.equal(handoff.messages.length, 0);
    assert.equal(handoff.stats.omitted_empty_messages, 1);
  });

  it("warns on unknown content and strict mode fails", async () => {
    const snapshot = await fixture("unknown-content");
    const handoff = createHandoffArtifact(snapshot);
    assert.deepEqual(handoff.warnings, ["Unknown content block: audio"]);
    assert.equal(handoff.messages[0].content, "Known text.");
    assert.throws(
      () => createHandoffArtifact(snapshot, { strict: true }),
      /Unknown content block: audio/,
    );
  });

  it("renders Markdown from the handoff object", async () => {
    const handoff = createHandoffArtifact(await fixture("simple-transcript"));
    const markdown = renderHandoffMarkdown(handoff);
    assert.match(markdown, /canonical artifact/);
    assert.match(markdown, /Please fix the bug\./);
  });
});
