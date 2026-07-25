import { join } from "node:path";

import { COORDINATION_VERSION, writeCoordinationJson } from "./coordination.ts";

export type HerdrCoordinationTarget = {
  recordId: string;
  launchToken: string;
  runDirectory: string;
  sequence: number;
};

export function writeHerdrFeedbackResponse(
  target: HerdrCoordinationTarget,
  requestId: string,
  feedback: string,
): number {
  if (!/^[a-zA-Z0-9-]+$/u.test(requestId)) {
    throw new Error("Invalid feedback request id.");
  }
  writeCoordinationJson(join(target.runDirectory, `feedback-response-${requestId}.json`), {
    version: COORDINATION_VERSION,
    recordId: target.recordId,
    launchToken: target.launchToken,
    sequence: target.sequence,
    requestId,
    response: feedback,
    respondedAt: Date.now(),
  });
  return target.sequence + 1;
}

export function writeHerdrStopControl(target: HerdrCoordinationTarget, reason: string): number {
  writeCoordinationJson(join(target.runDirectory, "control.json"), {
    version: COORDINATION_VERSION,
    recordId: target.recordId,
    launchToken: target.launchToken,
    sequence: target.sequence,
    action: "stop",
    reason,
  });
  return target.sequence + 1;
}
