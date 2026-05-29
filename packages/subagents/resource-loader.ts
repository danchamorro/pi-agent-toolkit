import {
  createExtensionRuntime,
  type ExtensionContext,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

import { stripDynamicSystemPromptFooter } from "./format.ts";
import type { SubagentRecord } from "./types.ts";

export function createSubagentResourceLoader(
  ctx: ExtensionContext,
  record: SubagentRecord,
): ResourceLoader {
  const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };
  const mainSystemPrompt = stripDynamicSystemPromptFooter(ctx.getSystemPrompt());
  const subagentPrompt = [
    "You are a focused Pi sub-agent running in the background for the main session.",
    `Sub-agent id: ${record.id}`,
    `Sub-agent name: ${record.name}`,
    `Launch working directory: ${record.cwd}`,
    `Assigned task: ${record.task}`,
    "You do not have the main session's conversation history. Treat the assigned task, role instructions, accessible workspace files, and explicit feedback as your source of truth.",
    "Stay scoped to the launch working directory. If a requested relative path is missing there, ask the main session for direction instead of searching unrelated directories.",
    "Work independently, keep the scope narrow, and produce a concise final result.",
    "When blocked, missing a decision, or needing user input, call ask_main_session with a specific question and wait for the reply.",
    "Do not assume feedback that was not provided.",
  ].join("\n");
  const rolePrompt = record.role
    ? [
        `Selected role: ${record.role.name}`,
        record.role.description ? `Role description: ${record.role.description}` : "",
        record.role.output ? `Expected output artifact: ${record.role.output}` : "",
        record.role.autoExit
          ? "When the assigned work is complete, return the final result and stop."
          : "",
        record.role.systemPrompt,
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";

  return {
    getExtensions: () => extensionsResult,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      [mainSystemPrompt, subagentPrompt, rolePrompt].filter(Boolean).join("\n\n"),
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
