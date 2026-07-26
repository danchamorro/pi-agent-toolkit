import { fileURLToPath } from "node:url";

import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";

import {
  cleanupCoordinationRun,
  createCoordinationPaths,
  isActivitySnapshot,
  isExitFile,
  isFeedbackRequest,
  readCoordinationJson,
  writePrivateText,
  type ActivitySnapshot,
  type CoordinationPaths,
  type FeedbackRequestFile,
} from "./coordination.ts";
import { extractText } from "./format.ts";
import type { HerdrChild, HerdrSessionController } from "./herdr.ts";
import type { PiLaunchConfig } from "./launch-config.ts";

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_MS = 250;

export type HerdrTerminalResult =
  | { kind: "fallback"; reason: string }
  | {
      kind: "terminal";
      status: "completed" | "failed" | "stopped" | "interrupted";
      result?: string;
      error?: string;
      contextUsage?: ActivitySnapshot["contextUsage"];
    };

export type HerdrController = Pick<
  HerdrSessionController,
  "sessionName" | "ensureServer" | "createChild" | "startAgent" | "childExists" | "closeChild"
>;

export type HerdrRunOptions = {
  launch: PiLaunchConfig;
  controller: HerdrController;
  agentDir?: string;
  childRuntimePath?: string;
  startupTimeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  beforeDispatchSignal?: AbortSignal;
  onServerReady?: (sessionName: string) => Promise<void>;
  onPrepared?: (paths: CoordinationPaths, child: HerdrChild) => void;
  onDispatch?: () => void;
  onActivity?: (activity: ActivitySnapshot) => void;
  onFeedbackRequest?: (request: FeedbackRequestFile, paths: CoordinationPaths) => void;
  onDiagnostic?: (message: string) => void;
};

export async function runHerdrSubagent(options: HerdrRunOptions): Promise<HerdrTerminalResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;
  const startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  const childRuntimePath =
    options.childRuntimePath ?? fileURLToPath(new URL("./child-runtime.ts", import.meta.url));
  if (options.beforeDispatchSignal?.aborted) {
    return { kind: "terminal", status: "stopped" };
  }

  const paths = createCoordinationPaths({
    parentSessionId: options.launch.parentSessionId,
    recordId: options.launch.recordId,
    launchToken: options.launch.launchToken,
    agentDir: options.agentDir,
  });
  let child: HerdrChild | undefined;
  let dispatchAttempted = false;
  try {
    writePrivateText(paths.task, `${options.launch.task}\n`);
    writePrivateText(paths.systemPrompt, options.launch.systemPrompt);
    await options.controller.ensureServer(options.beforeDispatchSignal);
    child = await options.controller.createChild(
      options.launch.recordId,
      options.launch.name,
      options.launch.cwd,
      buildChildEnvironment(options.launch, paths),
      options.beforeDispatchSignal,
    );
    options.onPrepared?.(paths, child);
    await options.onServerReady?.(options.controller.sessionName);
    if (options.beforeDispatchSignal?.aborted) {
      return { kind: "terminal", status: "stopped" };
    }

    let launchFailure: unknown;
    let launchReady = false;
    const start = options.controller
      .startAgent(
        child,
        buildChildPiArguments({ launch: options.launch, paths, childRuntimePath }),
        {
          signal: options.beforeDispatchSignal,
          onAttempt() {
            if (!dispatchAttempted) {
              dispatchAttempted = true;
              options.onDispatch?.();
            }
          },
        },
      )
      .then(
        () => {
          launchReady = true;
          return { kind: "started" as const };
        },
        (error: unknown) => {
          launchFailure = error;
          return { kind: "start-failed" as const, error };
        },
      );
    const watch = watchHerdrChild({
      ...options,
      paths,
      child,
      startupTimeoutMs,
      pollMs,
      now,
      sleep,
      launchFailure: () => launchFailure,
      launchReady: () => launchReady,
    });
    const first = await Promise.race([
      start,
      watch.then((terminal) => ({ kind: "terminal" as const, terminal })),
    ]);
    if (first.kind === "terminal") {
      return first.terminal;
    }
    return await watch;
  } catch (error) {
    if (options.beforeDispatchSignal?.aborted) {
      return { kind: "terminal", status: "stopped" };
    }
    const message = errorMessage(error);
    return dispatchAttempted
      ? { kind: "terminal", status: "failed", error: message }
      : { kind: "fallback", reason: message };
  } finally {
    if (child) {
      try {
        await options.controller.closeChild(child.recordId);
      } catch (error) {
        options.onDiagnostic?.(
          `Could not close Herdr child ${child.recordId}: ${errorMessage(error)}`,
        );
      }
    }
    try {
      cleanupCoordinationRun(paths);
    } catch (error) {
      options.onDiagnostic?.(`Could not remove ${paths.runDirectory}: ${errorMessage(error)}`);
    }
  }
}

export function buildChildPiArguments(options: {
  launch: PiLaunchConfig;
  paths: CoordinationPaths;
  childRuntimePath: string;
}): string[] {
  return [
    "--session",
    options.paths.session,
    "--model",
    `${options.launch.model.provider}/${options.launch.model.id}`,
    "--thinking",
    options.launch.thinkingLevel,
    "--tools",
    [...new Set([...options.launch.tools, "subagent_done"])].join(","),
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-approve",
    "-e",
    options.childRuntimePath,
    `@${options.paths.task}`,
  ];
}

export function buildChildEnvironment(
  launch: PiLaunchConfig,
  paths: CoordinationPaths,
): Record<string, string> {
  return {
    PI_SUBAGENT_RUN_DIR: paths.runDirectory,
    PI_SUBAGENT_RECORD_ID: launch.recordId,
    PI_SUBAGENT_LAUNCH_TOKEN: launch.launchToken,
    PI_SUBAGENT_SYSTEM_PROMPT_FILE: paths.systemPrompt,
    PI_SUBAGENT_NAME: launch.name,
    PI_SUBAGENT_AUTO_EXIT: launch.autoExit ? "1" : "0",
  };
}

async function watchHerdrChild(
  options: HerdrRunOptions & {
    paths: CoordinationPaths;
    child: HerdrChild;
    startupTimeoutMs: number;
    pollMs: number;
    now: () => number;
    sleep: (milliseconds: number) => Promise<void>;
    launchFailure: () => unknown;
    launchReady: () => boolean;
  },
): Promise<HerdrTerminalResult> {
  const identity = {
    recordId: options.launch.recordId,
    launchToken: options.launch.launchToken,
  };
  const startupDeadline = options.now() + options.startupTimeoutMs;
  let started = false;
  let lastActivitySequence = -1;
  let lastFeedbackSequence = -1;

  while (true) {
    const activity = readCoordinationJson(
      options.paths.activity,
      identity,
      isActivitySnapshot,
      lastActivitySequence,
    );
    if (activity.ok) {
      lastActivitySequence = activity.value.sequence;
      started = true;
      options.onActivity?.(activity.value);
    } else if (!["missing", "stale"].includes(activity.reason)) {
      options.onDiagnostic?.(`Ignored activity sidecar: ${activity.reason}.`);
    }

    const feedback = readCoordinationJson(
      options.paths.feedbackRequest,
      identity,
      isFeedbackRequest,
      lastFeedbackSequence,
    );
    if (feedback.ok) {
      lastFeedbackSequence = feedback.value.sequence;
      options.onFeedbackRequest?.(feedback.value, options.paths);
    } else if (!["missing", "stale"].includes(feedback.reason)) {
      options.onDiagnostic?.(`Ignored feedback sidecar: ${feedback.reason}.`);
    }

    const exit = readCoordinationJson(options.paths.exit, identity, isExitFile);
    if (exit.ok) {
      const finalActivity = readCoordinationJson(
        options.paths.activity,
        identity,
        isActivitySnapshot,
        lastActivitySequence,
      );
      if (finalActivity.ok) {
        options.onActivity?.(finalActivity.value);
      }
      if (exit.value.status === "stopped") {
        return {
          kind: "terminal",
          status: "stopped",
          error: exit.value.error,
          ...(exit.value.contextUsage ? { contextUsage: exit.value.contextUsage } : {}),
        };
      }
      if (exit.value.status === "failed") {
        return {
          kind: "terminal",
          status: "failed",
          error: exit.value.error,
          ...(exit.value.contextUsage ? { contextUsage: exit.value.contextUsage } : {}),
        };
      }
      if (exit.value.result?.trim()) {
        return {
          kind: "terminal",
          status: "completed",
          result: exit.value.result,
          ...(exit.value.contextUsage ? { contextUsage: exit.value.contextUsage } : {}),
        };
      }
      const completed = await readCompletedResult(options.paths.session, options.sleep);
      return completed.kind === "terminal" && exit.value.contextUsage
        ? { ...completed, contextUsage: exit.value.contextUsage }
        : completed;
    }
    if (!["missing", "stale"].includes(exit.reason)) {
      options.onDiagnostic?.(`Ignored exit sidecar: ${exit.reason}.`);
    }

    const launchFailure = options.launchFailure();
    if (launchFailure && !started) {
      return {
        kind: "terminal",
        status: "failed",
        error: errorMessage(launchFailure),
      };
    }
    if (
      (started || options.launchReady()) &&
      !(await options.controller.childExists(options.child.recordId))
    ) {
      return {
        kind: "terminal",
        status: "interrupted",
        error: "Interactive Herdr child tab was closed.",
      };
    }
    if (!started && options.now() >= startupDeadline) {
      return {
        kind: "terminal",
        status: "failed",
        error: `Interactive Herdr child did not start within ${options.startupTimeoutMs}ms.`,
      };
    }
    await options.sleep(options.pollMs);
  }
}

async function readCompletedResult(
  sessionPath: string,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<HerdrTerminalResult> {
  let lastError = "Interactive child completed without a readable session.";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const session = SessionManager.open(sessionPath);
      const branch = session.getBranch();
      for (let index = branch.length - 1; index >= 0; index -= 1) {
        const entry = branch[index];
        if (entry.type !== "message" || entry.message.role !== "assistant") {
          continue;
        }
        const message = entry.message as AssistantMessage;
        if (message.stopReason === "error") {
          return {
            kind: "terminal",
            status: "failed",
            error: message.errorMessage || "Interactive child request failed.",
          };
        }
        const text = extractText(message.content);
        if (text) {
          return { kind: "terminal", status: "completed", result: text };
        }
      }
      lastError = "Interactive child completed without an assistant text response.";
    } catch (error) {
      lastError = errorMessage(error);
    }
    await sleep(50);
  }
  return { kind: "terminal", status: "failed", error: lastError };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
