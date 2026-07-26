import type { ContextUsage } from "@earendil-works/pi-coding-agent";

import type { ClaudeLaunchConfig, CodexLaunchConfig } from "./launch-config.ts";
import type { ReasoningEffort, SubagentHarness } from "./types.ts";

export type HarnessTerminalResult = {
  status: "completed" | "failed" | "stopped" | "interrupted";
  result?: string;
  error?: string;
  contextUsage?: ContextUsage;
  resolvedModel?: string;
  nativeSessionId?: string;
  nativeRuntimeVersion?: string;
  nativeExecutable?: string;
};

export type HarnessCallbacks = {
  activity(text: string, usage?: ContextUsage): void;
  askMainSession(question: string, context?: string): Promise<string>;
};

export type NativeHarnessRunner = {
  run(
    launch: ClaudeLaunchConfig | CodexLaunchConfig,
    callbacks: HarnessCallbacks,
    signal: AbortSignal,
  ): Promise<HarnessTerminalResult>;
};

export const NATIVE_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function resolveHarnessEffort(
  harness: SubagentHarness,
  effort: ReasoningEffort,
): ReasoningEffort {
  if (
    harness === "pi" ||
    NATIVE_REASONING_EFFORTS.includes(effort as (typeof NATIVE_REASONING_EFFORTS)[number])
  ) {
    return effort;
  }
  throw new Error(
    `${harness} does not support reasoning effort "${effort}". Supported values: ${NATIVE_REASONING_EFFORTS.join(", ")}.`,
  );
}
