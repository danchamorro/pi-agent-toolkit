import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatRoleDetails, formatRoleList, formatSubagentList } from "../views.ts";
import type { SubagentRecord, SubagentRole } from "../types.ts";

function role(overrides: Partial<SubagentRole> & Pick<SubagentRole, "name">): SubagentRole {
  return {
    name: overrides.name,
    description: overrides.description ?? `${overrides.name} role description.`,
    tools: overrides.tools ?? ["read", "bash"],
    model: overrides.model ?? {
      provider: "openai-codex",
      modelId: "gpt-5.5",
      label: "openai-codex/gpt-5.5",
    },
    thinking: overrides.thinking ?? "off",
    systemPrompt: overrides.systemPrompt ?? "You are a test sub-agent.",
    filePath: overrides.filePath ?? `/tmp/${overrides.name}.md`,
    source: overrides.source ?? "built-in",
    overridden: overrides.overridden,
  };
}

function record(
  overrides: Partial<SubagentRecord> & Pick<SubagentRecord, "id" | "name">,
): SubagentRecord {
  return {
    id: overrides.id,
    name: overrides.name,
    task: overrides.task ?? "Map the package source.",
    cwd: overrides.cwd ?? "/repo",
    role: overrides.role,
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? Date.now() - 1_000,
    lastActivityAt: overrides.lastActivityAt ?? Date.now(),
    finishedAt: overrides.finishedAt,
    activity: overrides.activity ?? "Reading files.",
    result: overrides.result,
    error: overrides.error,
    contextUsage: overrides.contextUsage ?? {
      tokens: 100,
      contextWindow: 1_000,
      percent: 10,
    },
    pendingFeedback: overrides.pendingFeedback,
    feedbackSerial: overrides.feedbackSerial ?? 0,
    toolCalls: overrides.toolCalls ?? new Map(),
    completion: overrides.completion,
    notifyOnCompletion: overrides.notifyOnCompletion ?? false,
    reportCompletionToMain: overrides.reportCompletionToMain ?? false,
    completionGroupId: overrides.completionGroupId,
  };
}

describe("subagent views", () => {
  it("formats roles as guided chooser cards with grouped capability badges", () => {
    const output = formatRoleList([
      role({ name: "worker", tools: ["read", "bash", "edit", "write"], thinking: "off" }),
      role({ name: "scout", tools: ["read", "grep", "find", "ls"], thinking: "off" }),
      role({ name: "planner", tools: ["read", "bash"], thinking: "high" }),
    ]);

    assert.match(output, /┌─ Available sub-agent roles/);
    assert.match(output, /Choose by intent/);
    assert.match(output, /│ Role\s+│ Best for\s+│ Capabilities/);
    assert.match(output, /scout[\s\S]*scout role description\./);
    assert.match(output, /Use first when you need fast read-only codebase/);
    assert.match(output, /read feedback[\s\S]*openai-codex\/gpt-5\.5[\s\S]*thinking: off/);
    assert.match(output, /worker[\s\S]*read shell write feedback/);
    assert.ok(output.indexOf("scout") < output.indexOf("planner"));
    assert.ok(output.indexOf("planner") < output.indexOf("worker"));
    assert.doesNotMatch(output, /tools: read, bash/);
  });

  it("keeps exact tools and source details in role detail output", () => {
    const output = formatRoleDetails(
      role({
        name: "custom-review",
        source: "user",
        overridden: true,
        tools: ["read", "bash", "edit"],
        thinking: "high",
      }),
    );

    assert.match(output, /Sub-agent role: custom-review/);
    assert.match(output, /Tools: read, bash, edit, ask_main_session/);
    assert.match(output, /Source: custom, overridden/);
    assert.match(output, /Start: \/subagent start custom-review <task>/);
  });

  it("prioritizes feedback requests above running and recent subagents", () => {
    const scout = role({ name: "scout" });
    const output = formatSubagentList([
      record({ id: "sa-2", name: "worker", status: "completed", finishedAt: Date.now() }),
      record({
        id: "sa-1",
        name: "planner",
        role: role({ name: "planner" }),
        status: "waiting for feedback",
        pendingFeedback: {
          id: "feedback-1",
          question: "Which migration path should I plan around?",
          requestedAt: Date.now(),
          resolve() {},
          cancel() {},
        },
      }),
      record({
        id: "sa-3",
        name: "scout",
        role: scout,
        status: "running",
        activity: "Mapping packages/subagents.",
      }),
    ]);

    assert.match(output, /Subagents \(2 active, 1 recent\)/);
    assert.ok(output.indexOf("Needs feedback") < output.indexOf("Running"));
    assert.ok(output.indexOf("Running") < output.indexOf("Recent"));
    assert.match(output, /needs reply:[\s\S]*\/subagent reply sa-1 <feedback>/);
    assert.match(output, /Mapping packages\/subagents\./);
    assert.match(output, /Inspect: \/subagent view <id>\s+Stop: \/subagent stop <id>/);
  });
});
