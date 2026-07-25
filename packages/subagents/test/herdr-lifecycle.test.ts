import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveSubagentTools, shouldCloseIdleHerdrRuntime } from "../index.ts";

describe("resolveSubagentTools", () => {
  it("never grants tools disabled in the parent session", () => {
    assert.deepEqual(resolveSubagentTools([], ["read", "bash"]), ["ask_main_session"]);
    assert.deepEqual(resolveSubagentTools(["read", "start_subagent"], ["read", "bash"]), [
      "read",
      "ask_main_session",
    ]);
    assert.deepEqual(resolveSubagentTools(["read", "bash"]), ["read", "bash", "ask_main_session"]);
  });
});

describe("shouldCloseIdleHerdrRuntime", () => {
  it("closes only after every Herdr sub-agent reaches a terminal state", () => {
    assert.equal(
      shouldCloseIdleHerdrRuntime([
        { backend: "herdr", status: "completed" },
        { backend: "herdr", status: "failed" },
        { backend: "in-process", status: "running" },
      ]),
      true,
    );
    assert.equal(
      shouldCloseIdleHerdrRuntime([
        { backend: "herdr", status: "completed" },
        { backend: "herdr", status: "running" },
      ]),
      false,
    );
  });
});
