import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import type { SubagentRecord, SubagentRole, SubagentStatus } from "./types.ts";

const STATE_DIR_NAME = "subagents";
const RUNS_DIR_NAME = "runs";
const RETAIN_RUN_COUNT = 100;
const RECOVERABLE_RECORD_TTL_MS = 4 * 60 * 60 * 1000;

export type PersistedSubagentRecord = {
  id: string;
  parentSessionId: string;
  harness?: SubagentRecord["harness"];
  name: string;
  task: string;
  cwd: string;
  roleName?: string;
  status: SubagentStatus;
  startedAt: number;
  lastActivityAt: number;
  finishedAt?: number;
  activity: string;
  result?: string;
  error?: string;
  pendingFeedback?: {
    id: string;
    question: string;
    context?: string;
    requestedAt: number;
  };
  contextUsage?: SubagentRecord["contextUsage"];
  resolvedModel?: string;
  nativeRuntimeVersion?: string;
  nativeExecutable?: string;
  nativeSessionId?: string;
};

export function getSubagentRunsDir(agentDir = getAgentDir()): string {
  return join(agentDir, "state", STATE_DIR_NAME, RUNS_DIR_NAME);
}

export function encodeParentSessionId(parentSessionId: string): string {
  if (!parentSessionId) {
    throw new Error("Parent session id is required for sub-agent persistence.");
  }
  return Buffer.from(parentSessionId, "utf8").toString("base64url");
}

export function getSubagentSessionRunsDir(
  parentSessionId: string,
  agentDir = getAgentDir(),
): string {
  return join(getSubagentRunsDir(agentDir), encodeParentSessionId(parentSessionId));
}

export function persistSubagentRecord(record: SubagentRecord): void {
  const sessionRunsDir = getSubagentSessionRunsDir(record.parentSessionId);
  mkdirSync(sessionRunsDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(sessionRunsDir, `${record.id}.json`),
    `${JSON.stringify(toPersistedRecord(record), null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

export function loadPersistedSubagentRecords(
  rolesByName: Map<string, SubagentRole>,
  options: { parentSessionId: string; now?: number },
): SubagentRecord[] {
  const sessionRunsDir = getSubagentSessionRunsDir(options.parentSessionId);
  const now = options.now ?? Date.now();
  if (!existsSync(sessionRunsDir)) {
    return [];
  }

  const records: SubagentRecord[] = [];
  for (const fileName of readdirSync(sessionRunsDir)) {
    if (!fileName.endsWith(".json")) {
      continue;
    }

    try {
      const parsed = JSON.parse(readFileSync(join(sessionRunsDir, fileName), "utf8")) as unknown;
      const persisted = validatePersistedRecord(parsed);
      if (!persisted || !shouldLoadPersistedRecord(persisted, options.parentSessionId, now)) {
        continue;
      }
      records.push(fromPersistedRecord(persisted, rolesByName, now));
    } catch {
      continue;
    }
  }

  return records.sort((a, b) => a.startedAt - b.startedAt);
}

function toPersistedRecord(record: SubagentRecord): PersistedSubagentRecord {
  return {
    id: record.id,
    parentSessionId: record.parentSessionId,
    harness: record.harness,
    name: record.name,
    task: record.task,
    cwd: record.cwd,
    roleName: record.role?.name,
    status: record.status,
    startedAt: record.startedAt,
    lastActivityAt: record.lastActivityAt,
    finishedAt: record.finishedAt,
    activity: record.activity,
    result: record.result,
    error: record.error,
    pendingFeedback: record.pendingFeedback
      ? {
          id: record.pendingFeedback.id,
          question: record.pendingFeedback.question,
          context: record.pendingFeedback.context,
          requestedAt: record.pendingFeedback.requestedAt,
        }
      : undefined,
    contextUsage: record.contextUsage,
    resolvedModel: record.resolvedModel,
    nativeRuntimeVersion: record.nativeRuntimeVersion,
    nativeExecutable: record.nativeExecutable,
    nativeSessionId: record.nativeSessionId,
  };
}

function fromPersistedRecord(
  persisted: PersistedSubagentRecord,
  rolesByName: Map<string, SubagentRole>,
  now: number,
): SubagentRecord {
  const wasActive = isRecoverableActiveStatus(persisted.status);
  const role = persisted.roleName ? rolesByName.get(persisted.roleName.toLowerCase()) : undefined;
  return {
    id: persisted.id,
    parentSessionId: persisted.parentSessionId,
    harness: persisted.harness ?? "pi",
    name: persisted.name,
    task: persisted.task,
    cwd: persisted.cwd,
    role,
    status: wasActive ? "interrupted" : persisted.status,
    startedAt: persisted.startedAt,
    lastActivityAt: persisted.lastActivityAt,
    finishedAt: wasActive ? (persisted.finishedAt ?? now) : persisted.finishedAt,
    activity: wasActive ? "Interrupted by Pi reload or restart." : persisted.activity,
    result: persisted.result,
    error: persisted.error,
    contextUsage: persisted.contextUsage,
    resolvedModel: persisted.resolvedModel,
    nativeRuntimeVersion: persisted.nativeRuntimeVersion,
    nativeExecutable: persisted.nativeExecutable,
    nativeSessionId: persisted.nativeSessionId,
    feedbackSerial: 0,
    toolCalls: new Map(),
    notifyOnCompletion: true,
    reportCompletionToMain: false,
  };
}

function shouldLoadPersistedRecord(
  record: PersistedSubagentRecord,
  parentSessionId: string,
  now: number,
): boolean {
  if (record.parentSessionId !== parentSessionId) {
    return false;
  }
  if (!isRecoverableStatus(record.status)) {
    return false;
  }
  return now - record.lastActivityAt <= RECOVERABLE_RECORD_TTL_MS;
}

function isRecoverableStatus(status: SubagentStatus): boolean {
  return status === "interrupted" || isRecoverableActiveStatus(status);
}

function isRecoverableActiveStatus(status: SubagentStatus): boolean {
  return status === "starting" || status === "running" || status === "waiting for feedback";
}

function validatePersistedRecord(value: unknown): PersistedSubagentRecord | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Partial<PersistedSubagentRecord>;
  if (
    typeof record.id !== "string" ||
    typeof record.parentSessionId !== "string" ||
    typeof record.name !== "string" ||
    typeof record.task !== "string" ||
    typeof record.cwd !== "string" ||
    typeof record.status !== "string" ||
    typeof record.startedAt !== "number" ||
    typeof record.lastActivityAt !== "number" ||
    typeof record.activity !== "string" ||
    (record.harness !== undefined && !["pi", "claude", "codex"].includes(record.harness))
  ) {
    return undefined;
  }
  return record as PersistedSubagentRecord;
}

/**
 * Drops the oldest run files beyond the retention limit. This is intentionally
 * cheap: it sorts by file mtime (one stat per file) instead of reading and
 * parsing every record body, so it is safe to call when a new run is created
 * without it ever landing on the per-activity write path.
 */
export function prunePersistedRecords(runsDir = getSubagentRunsDir()): void {
  if (!existsSync(runsDir)) {
    return;
  }

  const groups: Array<{ directory?: string; paths: string[] }> = [{ paths: [] }];
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    const path = join(runsDir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".json")) {
      groups[0].paths.push(path);
      continue;
    }
    if (!entry.isDirectory()) {
      continue;
    }
    groups.push({
      directory: path,
      paths: readdirSync(path)
        .filter((fileName) => fileName.endsWith(".json"))
        .map((fileName) => join(path, fileName)),
    });
  }

  for (const group of groups) {
    const entries = group.paths
      .map((path) => {
        try {
          return { path, mtimeMs: statSync(path).mtimeMs };
        } catch {
          return { path, mtimeMs: 0 };
        }
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const entry of entries.slice(RETAIN_RUN_COUNT)) {
      rmSync(entry.path, { force: true });
    }
    if (group.directory && readdirSync(group.directory).length === 0) {
      rmSync(group.directory, { recursive: true, force: true });
    }
  }
}
