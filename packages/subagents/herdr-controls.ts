import {
  COORDINATION_VERSION,
  getControlPath,
  getFeedbackResponsePath,
  writeCoordinationJson,
} from "./coordination.ts";

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
  writeCoordinationJson(getFeedbackResponsePath(target.runDirectory, requestId), {
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
  writeCoordinationJson(getControlPath(target.runDirectory), {
    version: COORDINATION_VERSION,
    recordId: target.recordId,
    launchToken: target.launchToken,
    sequence: target.sequence,
    action: "stop",
    reason,
  });
  return target.sequence + 1;
}
