import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";

import { createSubagentResourceLoader, formatToolPromptGuidelines } from "../resource-loader.ts";
import type { SubagentRecord } from "../types.ts";

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

describe("createSubagentResourceLoader", () => {
  it("adds ephemeral specialization instructions to the child system prompt", () => {
    const now = Date.now();
    const record: SubagentRecord = {
      id: "sa-1",
      name: "architecture-cartographer",
      task: "Map the codebase architecture.",
      instructions: "Focus on module boundaries and dependency flow.",
      cwd: "/tmp/project",
      status: "starting",
      startedAt: now,
      lastActivityAt: now,
      activity: "Queued.",
      feedbackSerial: 0,
      toolCalls: new Map(),
      notifyOnCompletion: false,
      reportCompletionToMain: true,
    };
    const ctx = {
      getSystemPrompt: () => "Main system prompt.",
    } as ExtensionContext;

    const prompt = createSubagentResourceLoader(ctx, record).getSystemPrompt() ?? "";

    assert.match(prompt, /Task-specific specialization/);
    assert.match(prompt, /Focus on module boundaries and dependency flow/);
    assert.match(prompt, /cannot override safety, tool, working-directory/);
  });
});
