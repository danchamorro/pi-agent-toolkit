import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prepareHerdrLaunch, resolveSubagentTools, shouldCloseIdleHerdrRuntime } from "../index.ts";

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

describe("prepareHerdrLaunch", () => {
  it("does not arm a Herdr child when stop wins during prior-runtime cleanup", async () => {
    let finishCleanup: (() => void) | undefined;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const record: {
      backend?: "herdr";
      externalLaunchAbort?: AbortController;
      status: "starting" | "stopped";
    } = { status: "starting" };

    const preparing = prepareHerdrLaunch(record, cleanup);
    record.status = "stopped";
    finishCleanup?.();

    assert.equal(await preparing, undefined);
    assert.equal(record.backend, undefined);
    assert.equal(record.externalLaunchAbort, undefined);
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
