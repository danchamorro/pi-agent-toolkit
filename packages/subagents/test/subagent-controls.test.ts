import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import { writeHerdrFeedbackResponse, writeHerdrStopControl } from "../herdr-controls.ts";
import {
  createCoordinationPaths,
  isFeedbackResponse,
  isStopControl,
  readCoordinationJson,
} from "../coordination.ts";

let testDir = "";

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "pi-subagent-controls-test-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("Herdr parent controls", () => {
  it("writes feedback for the exact request, record, and launch token", () => {
    const launchToken = randomUUID();
    const paths = createCoordinationPaths({
      parentSessionId: "parent",
      recordId: "sa-1",
      launchToken,
      agentDir: testDir,
    });
    const target = {
      recordId: "sa-1",
      launchToken,
      runDirectory: paths.runDirectory,
      sequence: 3,
    };

    assert.equal(writeHerdrFeedbackResponse(target, "request-1", "Proceed."), 4);
    const response = readCoordinationJson(
      paths.feedbackResponse("request-1"),
      { recordId: "sa-1", launchToken },
      isFeedbackResponse,
      2,
    );
    assert.equal(response.ok, true);
    assert.equal(response.ok ? response.value.response : undefined, "Proceed.");
    assert.equal(
      readCoordinationJson(
        paths.feedbackResponse("request-1"),
        { recordId: "sa-2", launchToken },
        isFeedbackResponse,
      ).ok,
      false,
    );
    assert.throws(
      () => writeHerdrFeedbackResponse(target, "../escape", "unsafe"),
      /Invalid feedback request id/,
    );
  });

  it("writes a sequenced stop control scoped to one child", () => {
    const launchToken = randomUUID();
    const paths = createCoordinationPaths({
      parentSessionId: "parent",
      recordId: "sa-1",
      launchToken,
      agentDir: testDir,
    });
    const nextSequence = writeHerdrStopControl(
      {
        recordId: "sa-1",
        launchToken,
        runDirectory: paths.runDirectory,
        sequence: 7,
      },
      "Stop now.",
    );

    assert.equal(nextSequence, 8);
    const control = readCoordinationJson(
      paths.control,
      { recordId: "sa-1", launchToken },
      isStopControl,
      6,
    );
    assert.equal(control.ok, true);
    assert.equal(control.ok ? control.value.reason : undefined, "Stop now.");
  });
});
