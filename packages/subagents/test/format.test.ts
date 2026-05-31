import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveName, formatRecordChoices, stripDynamicSystemPromptFooter } from "../format.ts";
import type { SubagentRecord } from "../types.ts";

describe("stripDynamicSystemPromptFooter", () => {
  const body = "You are Pi.\n\nSome instructions.";

  it("strips a combined date and working-directory footer", () => {
    const prompt = `${body}\nCurrent date and time: 2026-05-30T23:55:00-04:00\nCurrent working directory: /Users/me/project`;
    assert.equal(stripDynamicSystemPromptFooter(prompt), body);
  });

  it("strips a date-only footer", () => {
    const prompt = `${body}\nCurrent date and time: 2026-05-30T23:55:00-04:00`;
    assert.equal(stripDynamicSystemPromptFooter(prompt), body);
  });

  it("strips a working-directory-only footer", () => {
    const prompt = `${body}\nCurrent working directory: /Users/me/project`;
    assert.equal(stripDynamicSystemPromptFooter(prompt), body);
  });

  it("is a no-op (aside from trim) when no dynamic footer is present", () => {
    assert.equal(stripDynamicSystemPromptFooter(`${body}\n`), body);
  });

  it("keeps body content that precedes the footer intact", () => {
    const prompt = `Line one.\nLine two mentions Current working directory inline.\nCurrent date and time: now\nCurrent working directory: /tmp`;
    assert.equal(
      stripDynamicSystemPromptFooter(prompt),
      "Line one.\nLine two mentions Current working directory inline.",
    );
  });
});

describe("deriveName", () => {
  it("uses the first few task words", () => {
    assert.equal(
      deriveName("Map the package source quickly and thoroughly"),
      "Map the package source quickly",
    );
  });

  it("falls back to sub-agent when the task has no usable words", () => {
    assert.equal(deriveName("!!!"), "sub-agent");
  });
});

describe("formatRecordChoices", () => {
  it("renders id, name, and status for each record", () => {
    const records = [
      { id: "sa-1", name: "scout", status: "running" },
      { id: "sa-2", name: "worker", status: "waiting for feedback" },
    ] as SubagentRecord[];
    assert.equal(
      formatRecordChoices(records),
      "sa-1 scout (running), sa-2 worker (waiting for feedback)",
    );
  });
});
