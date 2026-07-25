import { randomUUID } from "node:crypto";

import type { Api, Model } from "@earendil-works/pi-ai";

import type { SessionThinkingLevel, SubagentRecord } from "./types.ts";

export type SubagentLaunchConfig = {
  recordId: string;
  parentSessionId: string;
  name: string;
  task: string;
  cwd: string;
  model: Model<Api>;
  thinkingLevel: SessionThinkingLevel;
  tools: string[];
  systemPrompt: string;
  autoExit: boolean;
  openInHerdr: boolean;
  launchToken: string;
};

export function createSubagentLaunchConfig(options: {
  record: SubagentRecord;
  model: Model<Api>;
  thinkingLevel: SessionThinkingLevel;
  tools: string[];
  systemPrompt: string;
  openInHerdr: boolean;
}): SubagentLaunchConfig {
  return {
    recordId: options.record.id,
    parentSessionId: options.record.parentSessionId,
    name: options.record.name,
    task: options.record.task,
    cwd: options.record.cwd,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    tools: [...options.tools],
    systemPrompt: options.systemPrompt,
    autoExit: options.record.role?.autoExit ?? false,
    openInHerdr: options.openInHerdr,
    launchToken: randomUUID(),
  };
}
