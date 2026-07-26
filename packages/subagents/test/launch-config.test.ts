import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Api, Model } from "@earendil-works/pi-ai";

import { createNativeLaunchConfig, createSubagentLaunchConfig } from "../launch-config.ts";
import type { SubagentRecord } from "../types.ts";

const model = { provider: "test", id: "model" } as Model<Api>;

describe("createSubagentLaunchConfig", () => {
  it("copies resolved launch decisions and allocates unique launch tokens", () => {
    const record = createRecord();
    const options = {
      record,
      model,
      thinkingLevel: "high" as const,
      tools: ["read", "ask_main_session"],
      systemPrompt: "Resolved prompt.",
      openInHerdr: true,
    };

    const first = createSubagentLaunchConfig(options);
    const second = createSubagentLaunchConfig(options);

    assert.deepEqual(
      {
        recordId: first.recordId,
        parentSessionId: first.parentSessionId,
        name: first.name,
        task: first.task,
        cwd: first.cwd,
        model: first.model,
        thinkingLevel: first.thinkingLevel,
        tools: first.tools,
        systemPrompt: first.systemPrompt,
        autoExit: first.autoExit,
        openInHerdr: first.openInHerdr,
      },
      {
        recordId: "sa-1",
        parentSessionId: "parent-session",
        name: "scout",
        task: "Map the repository.",
        cwd: "/repo",
        model,
        thinkingLevel: "high",
        tools: ["read", "ask_main_session"],
        systemPrompt: "Resolved prompt.",
        autoExit: true,
        openInHerdr: true,
      },
    );
    assert.notEqual(first.launchToken, second.launchToken);
    assert.match(first.launchToken, /^[0-9a-f-]{36}$/u);
    assert.equal(first.harness, "pi");
    assert.equal(first.backend, "herdr");
  });

  it("creates native launch variants without Pi-only fields", () => {
    const record = {
      ...createRecord(),
      harness: "claude" as const,
      requestedModel: "claude-opus-5",
    };
    const launch = createNativeLaunchConfig({
      record,
      settings: { model: "ignored-default", reasoningEffort: "high" },
      effort: "max",
      neutralInstructions: "Review independently.",
    });

    assert.equal(launch.harness, "claude");
    assert.equal(launch.backend, "claude-sdk");
    assert.equal(launch.model, "claude-opus-5");
    assert.equal(launch.resolvedEffort, "max");
    assert.equal(launch.neutralInstructions, "Review independently.");
    assert.equal("systemPrompt" in launch, false);
    assert.equal("tools" in launch, false);
  });
});

function createRecord(): SubagentRecord {
  return {
    id: "sa-1",
    parentSessionId: "parent-session",
    harness: "pi",
    name: "scout",
    task: "Map the repository.",
    role: {
      name: "scout",
      description: "Maps repositories.",
      tools: ["read"],
      systemPrompt: "Inspect only.",
      filePath: "/agents/scout.md",
      source: "built-in",
      autoExit: true,
    },
    cwd: "/repo",
    status: "starting",
    startedAt: 0,
    lastActivityAt: 0,
    activity: "Queued.",
    feedbackSerial: 0,
    toolCalls: new Map(),
    notifyOnCompletion: true,
    reportCompletionToMain: false,
  };
}
