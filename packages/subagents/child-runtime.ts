/**
 * Interactive Subagent Child Runtime Extension
 *
 * Tools: `ask_main_session` waits for parent feedback, and `subagent_done`
 * reports explicit completion for interactive roles.
 *
 * Loaded explicitly only inside an isolated child Pi process. It publishes
 * activity and lifecycle state through the task's private coordination files.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";

import {
  COORDINATION_VERSION,
  isFeedbackResponse,
  isStopControl,
  readCoordinationJson,
  writeCoordinationJson,
  type ActivitySnapshot,
  type CoordinationIdentity,
  type ExitFile,
  type FeedbackRequestFile,
} from "./coordination.ts";
import { AskMainSessionParams, PREFERRED_JSON_SCHEMA_SAMPLING } from "./schemas.ts";

const ACTIVITY_THROTTLE_MS = 200;
const CONTROL_POLL_MS = 250;
const MAX_ACTIVITY_WRITE_FAILURES = 3;
const CONTROL_TIMER_KEY = Symbol.for("pi-agent-toolkit/subagents-child-control-timer");
const SubagentDoneParams = Type.Object(
  {
    result: Type.String({
      minLength: 1,
      description: "The complete final result to return to the main session.",
    }),
  },
  { additionalProperties: false },
);

type ChildRuntimeEnvironment = CoordinationIdentity & {
  runDirectory: string;
  systemPromptPath: string;
  name: string;
  autoExit: boolean;
};

type ChildActivityWriter = {
  update: (
    event: string,
    phase: ActivitySnapshot["phase"],
    message?: string,
    throttled?: boolean,
    contextUsage?: ActivitySnapshot["contextUsage"],
  ) => void;
  dispose: () => void;
  isDisabled: () => boolean;
};

export function readChildRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ChildRuntimeEnvironment {
  const runDirectory = env.PI_SUBAGENT_RUN_DIR;
  const recordId = env.PI_SUBAGENT_RECORD_ID;
  const launchToken = env.PI_SUBAGENT_LAUNCH_TOKEN;
  const systemPromptPath = env.PI_SUBAGENT_SYSTEM_PROMPT_FILE;
  const name = env.PI_SUBAGENT_NAME;
  if (!runDirectory || !recordId || !launchToken || !systemPromptPath || !name) {
    throw new Error(
      "Interactive child runtime requires its run directory, identity, system prompt file, and name environment values.",
    );
  }
  return {
    runDirectory,
    recordId,
    launchToken,
    systemPromptPath,
    name,
    autoExit: env.PI_SUBAGENT_AUTO_EXIT === "1",
  };
}

export function createChildActivityWriter(options: {
  identity: CoordinationIdentity;
  path: string;
  now?: () => number;
  write?: typeof writeCoordinationJson;
}): ChildActivityWriter {
  const now = options.now ?? Date.now;
  const write = options.write ?? writeCoordinationJson;
  let sequence = 0;
  let lastWriteAt = 0;
  let writeFailures = 0;
  let disabled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: ActivitySnapshot | undefined;

  const writeNow = (snapshot: ActivitySnapshot): void => {
    if (disabled) {
      return;
    }
    try {
      write(options.path, snapshot);
      lastWriteAt = now();
      writeFailures = 0;
    } catch {
      writeFailures += 1;
      if (writeFailures >= MAX_ACTIVITY_WRITE_FAILURES) {
        disabled = true;
      }
    }
  };

  const flushPending = (): void => {
    timer = undefined;
    if (!pending) {
      return;
    }
    const snapshot = pending;
    pending = undefined;
    writeNow(snapshot);
  };

  return {
    update(event, phase, message, throttled = false, contextUsage) {
      if (disabled) {
        return;
      }
      const snapshot: ActivitySnapshot = {
        version: COORDINATION_VERSION,
        recordId: options.identity.recordId,
        launchToken: options.identity.launchToken,
        sequence: sequence++,
        phase,
        event,
        updatedAt: now(),
        message,
        contextUsage,
      };
      if (!throttled || now() - lastWriteAt >= ACTIVITY_THROTTLE_MS) {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        pending = undefined;
        writeNow(snapshot);
        return;
      }
      pending = snapshot;
      timer ??= setTimeout(flushPending, ACTIVITY_THROTTLE_MS - (now() - lastWriteAt));
    },
    dispose() {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      pending = undefined;
    },
    isDisabled: () => disabled,
  };
}

export default function childRuntimeExtension(pi: ExtensionAPI): void {
  const environment = readChildRuntimeEnvironment();
  const identity: CoordinationIdentity = environment;
  const activityPath = join(environment.runDirectory, "activity.json");
  const controlPath = join(environment.runDirectory, "control.json");
  const feedbackRequestPath = join(environment.runDirectory, "feedback-request.json");
  const exitPath = join(environment.runDirectory, "exit.json");
  const activity = createChildActivityWriter({ identity, path: activityPath });

  let childSequence = 0;
  let lastControlSequence = -1;
  let terminalWritten = existsSync(exitPath);
  let controlTimer: ReturnType<typeof setInterval> | undefined;
  let controlPollRunning = false;

  const clearControlTimer = (): void => {
    if (controlTimer) {
      clearInterval(controlTimer);
      controlTimer = undefined;
    }
    const globalTimer = (globalThis as Record<PropertyKey, unknown>)[CONTROL_TIMER_KEY];
    if (globalTimer) {
      clearInterval(globalTimer as ReturnType<typeof setInterval>);
      (globalThis as Record<PropertyKey, unknown>)[CONTROL_TIMER_KEY] = undefined;
    }
  };

  const writeTerminal = (
    status: ExitFile["status"],
    details: Pick<ExitFile, "contextUsage" | "error" | "result"> = {},
  ): void => {
    if (terminalWritten) {
      return;
    }
    writeCoordinationJson(exitPath, {
      version: COORDINATION_VERSION,
      ...identity,
      sequence: childSequence++,
      status,
      finishedAt: Date.now(),
      ...details,
    });
    terminalWritten = true;
  };

  const stopChild = async (ctx: ExtensionContext, reason?: string): Promise<void> => {
    if (terminalWritten) {
      return;
    }
    activity.update("stop", "stopped", reason, false, ctx.getContextUsage());
    try {
      ctx.abort();
    } finally {
      writeTerminal("stopped", { error: reason, contextUsage: ctx.getContextUsage() });
      clearControlTimer();
      activity.dispose();
      await ctx.shutdown();
    }
  };

  const pollControl = async (ctx: ExtensionContext): Promise<void> => {
    if (controlPollRunning || terminalWritten) {
      return;
    }
    controlPollRunning = true;
    try {
      const result = readCoordinationJson(
        controlPath,
        identity,
        isStopControl,
        lastControlSequence,
      );
      if (result.ok) {
        lastControlSequence = result.value.sequence;
        await stopChild(ctx, result.value.reason);
      }
    } finally {
      controlPollRunning = false;
    }
  };

  const handleControlFailure = async (ctx: ExtensionContext, error: unknown): Promise<void> => {
    if (terminalWritten) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    activity.update("control_failure", "failed", message, false, ctx.getContextUsage());
    try {
      writeTerminal("failed", { error: message, contextUsage: ctx.getContextUsage() });
    } catch (writeError) {
      process.stderr.write(
        `Could not write interactive child failure: ${writeError instanceof Error ? writeError.message : String(writeError)}\n`,
      );
    }
    clearControlTimer();
    activity.dispose();
    try {
      await ctx.shutdown();
    } catch (shutdownError) {
      process.stderr.write(
        `Could not shut down failed interactive child: ${shutdownError instanceof Error ? shutdownError.message : String(shutdownError)}\n`,
      );
    }
  };

  pi.on("before_agent_start", async () => ({
    systemPrompt: readFileSync(environment.systemPromptPath, "utf8"),
  }));

  pi.on("session_start", async (_event, ctx) => {
    pi.setSessionName(environment.name);
    activity.update("session_start", "starting", undefined, false, ctx.getContextUsage());
    clearControlTimer();
    controlTimer = setInterval(() => {
      void pollControl(ctx).catch((error) => handleControlFailure(ctx, error));
    }, CONTROL_POLL_MS);
    (globalThis as Record<PropertyKey, unknown>)[CONTROL_TIMER_KEY] = controlTimer;
  });

  pi.on("agent_start", async (_event, ctx) => {
    activity.update("agent_start", "running", undefined, false, ctx.getContextUsage());
  });

  pi.on("message_update", async (_event, ctx) => {
    activity.update("message_update", "running", undefined, true, ctx.getContextUsage());
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    activity.update(
      "tool_execution_start",
      "running",
      event.toolName,
      false,
      ctx.getContextUsage(),
    );
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    activity.update("tool_execution_end", "running", event.toolName, false, ctx.getContextUsage());
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (terminalWritten) {
      return;
    }
    if (!environment.autoExit) {
      activity.update("agent_settled", "waiting", undefined, false, ctx.getContextUsage());
      return;
    }
    activity.update("agent_settled", "completed", undefined, false, ctx.getContextUsage());
    try {
      writeTerminal("completed", { contextUsage: ctx.getContextUsage() });
    } catch (error) {
      await handleControlFailure(ctx, error);
      return;
    }
    clearControlTimer();
    activity.dispose();
    await ctx.shutdown();
  });

  pi.on("session_shutdown", async () => {
    clearControlTimer();
    activity.dispose();
  });

  pi.registerTool({
    name: "ask_main_session",
    label: "Ask Main Session",
    description:
      "Ask the main Pi session for a decision or missing information, then wait for its reply.",
    parameters: AskMainSessionParams,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (terminalWritten) {
        throw new Error("The interactive child is already stopping.");
      }
      const requestId = randomUUID();
      const request: FeedbackRequestFile = {
        version: COORDINATION_VERSION,
        ...identity,
        sequence: childSequence++,
        requestId,
        question: params.question,
        context: params.context,
        requestedAt: Date.now(),
      };
      writeCoordinationJson(feedbackRequestPath, request);
      activity.update("feedback_request", "waiting", params.question, false, ctx.getContextUsage());
      const responsePath = join(environment.runDirectory, `feedback-response-${requestId}.json`);

      while (!signal?.aborted && !terminalWritten) {
        const result = readCoordinationJson(responsePath, identity, isFeedbackResponse);
        if (result.ok && result.value.requestId === requestId) {
          rmSync(feedbackRequestPath, { force: true });
          rmSync(responsePath, { force: true });
          activity.update("feedback_response", "running", undefined, false, ctx.getContextUsage());
          return {
            content: [{ type: "text" as const, text: result.value.response }],
            details: { requestId, status: "answered" },
          };
        }
        await wait(CONTROL_POLL_MS, signal);
      }

      rmSync(feedbackRequestPath, { force: true });
      return {
        content: [{ type: "text" as const, text: "Feedback request was cancelled." }],
        details: { requestId, status: "cancelled" },
      };
    },
  });

  pi.registerTool({
    name: "subagent_done",
    label: "Subagent Done",
    description:
      "Submit the complete final result to the main session, then close this interactive Pi session.",
    parameters: SubagentDoneParams,
    constrainedSampling: PREFERRED_JSON_SCHEMA_SAMPLING,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = params.result.trim();
      if (!result) {
        throw new Error("subagent_done requires a non-empty final result.");
      }
      if (!terminalWritten) {
        activity.update("subagent_done", "completed", undefined, false, ctx.getContextUsage());
        try {
          writeTerminal("completed", { result, contextUsage: ctx.getContextUsage() });
        } catch (error) {
          await handleControlFailure(ctx, error);
          return {
            content: [{ type: "text" as const, text: "Sub-agent completion failed." }],
            details: { status: "failed" },
          };
        }
      }
      clearControlTimer();
      activity.dispose();
      await ctx.shutdown();
      return {
        content: [{ type: "text" as const, text: "Sub-agent completion reported." }],
        details: { status: "completed" },
      };
    },
  });
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
