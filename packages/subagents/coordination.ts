import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import { encodeParentSessionId } from "./persistence.ts";

export const COORDINATION_VERSION = 1;
export const MAX_COORDINATION_FILE_BYTES = 64 * 1024;

export type CoordinationIdentity = {
  recordId: string;
  launchToken: string;
};

export type CoordinationEnvelope = CoordinationIdentity & {
  version: typeof COORDINATION_VERSION;
  sequence: number;
};

export type CoordinationContextUsage = {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
};

export type ActivitySnapshot = CoordinationEnvelope & {
  phase: "starting" | "running" | "waiting" | "completed" | "failed" | "stopped";
  event: string;
  updatedAt: number;
  message?: string;
  contextUsage?: CoordinationContextUsage;
};

export type StopControl = CoordinationEnvelope & {
  action: "stop";
  reason?: string;
};

export type FeedbackRequestFile = CoordinationEnvelope & {
  requestId: string;
  question: string;
  context?: string;
  requestedAt: number;
};

export type FeedbackResponseFile = CoordinationEnvelope & {
  requestId: string;
  response: string;
  respondedAt: number;
};

export type ExitFile = CoordinationEnvelope & {
  status: "completed" | "failed" | "stopped";
  finishedAt: number;
  result?: string;
  error?: string;
  contextUsage?: CoordinationContextUsage;
};

export type CoordinationPaths = {
  rootDirectory: string;
  parentDirectory: string;
  runDirectory: string;
  activity: string;
  control: string;
  feedbackRequest: string;
  exit: string;
  systemPrompt: string;
  task: string;
  session: string;
  feedbackResponse: (requestId: string) => string;
};

export type CoordinationReadResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: "missing" | "oversized" | "invalid" | "wrong-record" | "wrong-token" | "stale";
      error?: string;
    };

export function createCoordinationPaths(options: {
  parentSessionId: string;
  recordId: string;
  launchToken: string;
  agentDir?: string;
}): CoordinationPaths {
  if (!/^sa-\d+$/u.test(options.recordId)) {
    throw new Error(`Invalid sub-agent record id: ${options.recordId}.`);
  }
  if (!/^[0-9a-f-]{36}$/u.test(options.launchToken)) {
    throw new Error("Invalid sub-agent launch token.");
  }

  const rootDirectory = join(
    options.agentDir ?? getAgentDir(),
    "state",
    "subagents",
    "interactive",
  );
  const parentDirectory = join(rootDirectory, encodeParentSessionId(options.parentSessionId));
  const runDirectory = join(parentDirectory, `${options.recordId}-${options.launchToken}`);
  mkdirSync(runDirectory, { recursive: true, mode: 0o700 });

  return {
    rootDirectory,
    parentDirectory,
    runDirectory,
    activity: join(runDirectory, "activity.json"),
    control: join(runDirectory, "control.json"),
    feedbackRequest: join(runDirectory, "feedback-request.json"),
    exit: join(runDirectory, "exit.json"),
    systemPrompt: join(runDirectory, "system-prompt.md"),
    task: join(runDirectory, "task.md"),
    session: join(runDirectory, "session.jsonl"),
    feedbackResponse(requestId) {
      if (!/^[a-zA-Z0-9-]+$/u.test(requestId)) {
        throw new Error("Invalid feedback request id.");
      }
      return join(runDirectory, `feedback-response-${requestId}.json`);
    },
  };
}

export function writePrivateText(path: string, content: string, mode: 0o600 | 0o700 = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, content, { encoding: "utf8", mode });
}

export function writeCoordinationJson<T extends CoordinationEnvelope>(
  path: string,
  value: T,
): void {
  const content = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(content) > MAX_COORDINATION_FILE_BYTES) {
    throw new Error(`Coordination payload exceeds ${MAX_COORDINATION_FILE_BYTES} bytes.`);
  }

  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, path);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // Preserve the original write error; the unique temporary file is safe to
      // remove with the run directory if immediate cleanup also fails.
    }
    throw error;
  }
}

export function readCoordinationJson<T extends CoordinationEnvelope>(
  path: string,
  identity: CoordinationIdentity,
  validatePayload: (value: Record<string, unknown>) => value is T,
  afterSequence = -1,
): CoordinationReadResult<T> {
  if (!existsSync(path)) {
    return { ok: false, reason: "missing" };
  }
  try {
    if (statSync(path).size > MAX_COORDINATION_FILE_BYTES) {
      return { ok: false, reason: "oversized" };
    }
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, reason: "invalid", error: "Payload must be an object." };
    }
    const value = parsed as Record<string, unknown>;
    if (
      value.version !== COORDINATION_VERSION ||
      typeof value.sequence !== "number" ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0
    ) {
      return { ok: false, reason: "invalid", error: "Invalid protocol version or sequence." };
    }
    if (value.recordId !== identity.recordId) {
      return { ok: false, reason: "wrong-record" };
    }
    if (value.launchToken !== identity.launchToken) {
      return { ok: false, reason: "wrong-token" };
    }
    if (value.sequence <= afterSequence) {
      return { ok: false, reason: "stale" };
    }
    if (!validatePayload(value)) {
      return { ok: false, reason: "invalid", error: "Invalid coordination payload." };
    }
    return { ok: true, value };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { ok: false, reason: "missing" };
    }
    return {
      ok: false,
      reason: "invalid",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isActivitySnapshot(value: Record<string, unknown>): value is ActivitySnapshot {
  return (
    typeof value.recordId === "string" &&
    typeof value.launchToken === "string" &&
    typeof value.phase === "string" &&
    ["starting", "running", "waiting", "completed", "failed", "stopped"].includes(value.phase) &&
    typeof value.event === "string" &&
    typeof value.updatedAt === "number" &&
    (value.message === undefined || typeof value.message === "string") &&
    (value.contextUsage === undefined || isContextUsage(value.contextUsage))
  );
}

function isContextUsage(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const usage = value as Record<string, unknown>;
  return (
    (usage.tokens === null ||
      (typeof usage.tokens === "number" && Number.isFinite(usage.tokens))) &&
    typeof usage.contextWindow === "number" &&
    Number.isFinite(usage.contextWindow) &&
    (usage.percent === null ||
      (typeof usage.percent === "number" && Number.isFinite(usage.percent)))
  );
}

export function isStopControl(value: Record<string, unknown>): value is StopControl {
  return (
    typeof value.recordId === "string" &&
    typeof value.launchToken === "string" &&
    value.action === "stop" &&
    (value.reason === undefined || typeof value.reason === "string")
  );
}

export function isFeedbackRequest(value: Record<string, unknown>): value is FeedbackRequestFile {
  return (
    typeof value.recordId === "string" &&
    typeof value.launchToken === "string" &&
    typeof value.requestId === "string" &&
    typeof value.question === "string" &&
    typeof value.requestedAt === "number" &&
    (value.context === undefined || typeof value.context === "string")
  );
}

export function isFeedbackResponse(value: Record<string, unknown>): value is FeedbackResponseFile {
  return (
    typeof value.recordId === "string" &&
    typeof value.launchToken === "string" &&
    typeof value.requestId === "string" &&
    typeof value.response === "string" &&
    typeof value.respondedAt === "number"
  );
}

export function isExitFile(value: Record<string, unknown>): value is ExitFile {
  return (
    typeof value.recordId === "string" &&
    typeof value.launchToken === "string" &&
    typeof value.status === "string" &&
    ["completed", "failed", "stopped"].includes(value.status) &&
    typeof value.finishedAt === "number" &&
    (value.result === undefined || typeof value.result === "string") &&
    (value.error === undefined || typeof value.error === "string") &&
    (value.contextUsage === undefined || isContextUsage(value.contextUsage))
  );
}

export function cleanupCoordinationRun(paths: CoordinationPaths): void {
  const root = `${resolve(paths.rootDirectory)}${sep}`;
  const runDirectory = resolve(paths.runDirectory);
  if (!runDirectory.startsWith(root)) {
    throw new Error("Refusing to remove a coordination directory outside the state root.");
  }
  rmSync(runDirectory, { recursive: true, force: true });
}
