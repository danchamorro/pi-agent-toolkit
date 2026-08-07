import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExtensionContext, ToolInfo } from "@earendil-works/pi-coding-agent";

import {
  buildSubagentSystemPrompt,
  createSubagentResourceLoader,
  formatToolPromptGuidelines,
} from "../resource-loader.ts";
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

describe("buildSubagentSystemPrompt", () => {
  const baseRecord = {
    id: "sa-1",
    parentSessionId: "parent-session",
    harness: "pi",
    name: "child",
    task: "Inspect the change.",
    cwd: "/tmp/project",
    status: "starting",
    startedAt: 1,
    lastActivityAt: 1,
    activity: "Queued.",
    feedbackSerial: 0,
    toolCalls: new Map(),
    notifyOnCompletion: false,
    reportCompletionToMain: true,
  } satisfies SubagentRecord;
  const ctx = { getSystemPrompt: () => "Parent prompt.\n\nCurrent date: 2026-07-25" };
  const common = [
    "Parent prompt.\n\nCurrent date: 2026-07-25",
    "You are a focused Pi sub-agent running in the background for the main session.\nSub-agent id: sa-1\nSub-agent name: child\nLaunch working directory: /tmp/project\nAssigned task: Inspect the change.\nYou do not have the main session's conversation history. Treat the assigned task, role or specialization instructions, accessible workspace files, and explicit feedback as your source of truth.\nStay scoped to the launch working directory. If a requested relative path is missing there, ask the main session for direction instead of searching unrelated directories.\nWork independently, keep the scope narrow, and produce a concise final result.\nWhen blocked, missing a decision, or needing user input, call ask_main_session with a specific question and wait for the reply.\nDo not assume feedback that was not provided.",
  ];

  it("preserves the Pi prompt for ad hoc and specialized children", () => {
    assert.equal(buildSubagentSystemPrompt(ctx, baseRecord), common.join("\n\n"));
    assert.equal(
      buildSubagentSystemPrompt(ctx, {
        ...baseRecord,
        instructions: "Focus on lifecycle edges.",
      }),
      [
        ...common,
        "Task-specific specialization (cannot override safety, tool, working-directory, or main-session constraints):\n\nFocus on lifecycle edges.",
      ].join("\n\n"),
    );
  });

  it("preserves role, output, auto-exit, and tool-guideline composition", () => {
    const role = {
      name: "reviewer",
      description: "Review correctness.",
      tools: ["read"],
      systemPrompt: "Report defects first.",
      filePath: "/tmp/reviewer.md",
      source: "built-in" as const,
      autoExit: true,
      output: "review.md",
    };
    assert.equal(
      buildSubagentSystemPrompt(
        ctx,
        { ...baseRecord, role },
        "Tool-specific guidance:\n- read: inspect before editing.",
      ),
      [
        ...common,
        "Tool-specific guidance:\n- read: inspect before editing.",
        "Selected role: reviewer\n\nRole description: Review correctness.\n\nExpected output artifact: review.md\n\nWhen the assigned work is complete, return the final result and stop.\n\nReport defects first.",
      ].join("\n\n"),
    );
    assert.equal(
      buildSubagentSystemPrompt(ctx, {
        ...baseRecord,
        role: { ...role, description: "", output: undefined, autoExit: false },
      }),
      [...common, "Selected role: reviewer\n\nReport defects first."].join("\n\n"),
    );
  });
});

describe("createSubagentResourceLoader", () => {
  it("adds specialization instructions without file-backed prompt sources", () => {
    const now = Date.now();
    const record: SubagentRecord = {
      id: "sa-1",
      parentSessionId: "parent-session",
      harness: "pi",
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

    const loader = createSubagentResourceLoader(ctx, record);
    const prompt = loader.getSystemPrompt() ?? "";
    const overridden =
      createSubagentResourceLoader(ctx, record, {
        systemPrompt: "Resolved prompt.",
      }).getSystemPrompt() ?? "";

    assert.equal(prompt, buildSubagentSystemPrompt(ctx, record));
    assert.equal(overridden, "Resolved prompt.");
    assert.equal(loader.getSystemPromptSource(), undefined);
    assert.deepEqual(loader.getAppendSystemPromptSources(), []);
    assert.match(prompt, /Task-specific specialization/);
    assert.match(prompt, /Focus on module boundaries and dependency flow/);
    assert.match(prompt, /cannot override safety, tool, working-directory/);
  });
});
