import { randomUUID } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";

import type {
  NativeHarnessSettings,
  ReasoningEffort,
  SessionThinkingLevel,
  SubagentHarness,
  SubagentRecord,
  SubagentRole,
} from "./types.ts";

export type BaseLaunchConfig = {
  harness: SubagentHarness;
  recordId: string;
  parentSessionId: string;
  name: string;
  task: string;
  cwd: string;
  role?: SubagentRole;
  autoExit: boolean;
  thinkingLevel: SessionThinkingLevel;
  launchToken: string;
};

export type PiLaunchConfig = BaseLaunchConfig & {
  harness: "pi";
  backend: "in-process" | "herdr";
  model: Model<Api>;
  tools: string[];
  systemPrompt: string;
  openInHerdr: boolean;
};

export type ClaudeLaunchConfig = BaseLaunchConfig & {
  harness: "claude";
  backend: "claude-sdk";
  model: string;
  resolvedEffort: ReasoningEffort;
  neutralInstructions: string;
  executable?: string;
};

export type CodexLaunchConfig = BaseLaunchConfig & {
  harness: "codex";
  backend: "codex-app-server";
  model: string;
  resolvedEffort: ReasoningEffort;
  neutralInstructions: string;
  executable?: string;
};

export type NativeLaunchConfig = ClaudeLaunchConfig | CodexLaunchConfig;
export type SubagentLaunchConfig = PiLaunchConfig | NativeLaunchConfig;

function baseLaunchConfig(
  record: SubagentRecord,
  thinkingLevel: SessionThinkingLevel,
): BaseLaunchConfig {
  return {
    harness: record.harness,
    recordId: record.id,
    parentSessionId: record.parentSessionId,
    name: record.name,
    task: record.task,
    cwd: record.cwd,
    role: record.role,
    autoExit: record.role?.autoExit ?? false,
    thinkingLevel,
    launchToken: randomUUID(),
  };
}

export function createSubagentLaunchConfig(options: {
  record: SubagentRecord;
  model: Model<Api>;
  thinkingLevel: SessionThinkingLevel;
  tools: string[];
  systemPrompt: string;
  openInHerdr: boolean;
}): PiLaunchConfig {
  return {
    ...baseLaunchConfig(options.record, options.thinkingLevel),
    harness: "pi",
    backend: options.openInHerdr ? "herdr" : "in-process",
    model: options.model,
    tools: [...options.tools],
    systemPrompt: options.systemPrompt,
    openInHerdr: options.openInHerdr,
  };
}

export function createNativeLaunchConfig(options: {
  record: SubagentRecord;
  settings: NativeHarnessSettings;
  effort: ReasoningEffort;
  neutralInstructions: string;
}): NativeLaunchConfig {
  const common = {
    ...baseLaunchConfig(options.record, options.effort),
    model: options.record.requestedModel ?? options.settings.model,
    resolvedEffort: options.effort,
    neutralInstructions: options.neutralInstructions,
    executable: options.settings.executable,
  };
  return options.record.harness === "claude"
    ? { ...common, harness: "claude", backend: "claude-sdk" }
    : { ...common, harness: "codex", backend: "codex-app-server" };
}
