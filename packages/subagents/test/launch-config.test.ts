import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Api, Model } from "@earendil-works/pi-ai";

import { createSubagentLaunchConfig } from "../launch-config.ts";
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
        cwd: first.cwd,
        model: first.model,
        thinkingLevel: first.thinkingLevel,
        tools: first.tools,
        systemPrompt: first.systemPrompt,
        openInHerdr: first.openInHerdr,
      },
      {
        recordId: "sa-1",
        parentSessionId: "parent-session",
        cwd: "/repo",
        model,
        thinkingLevel: "high",
        tools: ["read", "ask_main_session"],
        systemPrompt: "Resolved prompt.",
        openInHerdr: true,
      },
    );
    assert.notEqual(first.launchToken, second.launchToken);
    assert.match(first.launchToken, /^[0-9a-f-]{36}$/u);
  });
});

function createRecord(): SubagentRecord {
  return {
    id: "sa-1",
    parentSessionId: "parent-session",
    name: "scout",
    task: "Map the repository.",
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
