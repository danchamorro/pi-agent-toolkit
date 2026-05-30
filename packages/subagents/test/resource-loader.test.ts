import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ToolInfo } from "@earendil-works/pi-coding-agent";

import { formatToolPromptGuidelines } from "../resource-loader.ts";

describe("formatToolPromptGuidelines", () => {
  it("includes prompt guidelines only for enabled sub-agent tools", () => {
    const tools = [
      {
        name: "read",
        description: "Read a file",
        parameters: {},
        promptGuidelines: ["Use read before editing files."],
        sourceInfo: { source: "builtin" },
      },
      {
        name: "write",
        description: "Write a file",
        parameters: {},
        promptGuidelines: ["Prefer edit for existing files."],
        sourceInfo: { source: "builtin" },
      },
      {
        name: "bash",
        description: "Run a command",
        parameters: {},
        sourceInfo: { source: "builtin" },
      },
    ] as ToolInfo[];

    const result = formatToolPromptGuidelines(tools, ["read", "bash"]);

    assert.match(result, /Tool-specific guidance/);
    assert.match(result, /read:/);
    assert.match(result, /Use read before editing files/);
    assert.doesNotMatch(result, /write:/);
    assert.doesNotMatch(result, /Prefer edit/);
    assert.doesNotMatch(result, /bash:/);
  });
});
