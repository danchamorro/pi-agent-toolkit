import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TOOLS,
  ROLE_AGENT_FILES,
  SUBAGENT_TOOL_NAMES,
  THINKING_LEVELS,
} from "./constants.ts";
import { deriveName, splitCommand } from "./format.ts";
import type {
  ParsedStartArgs,
  RoleModelSpec,
  SessionThinkingLevel,
  SubagentRole,
} from "./types.ts";

const ROLE_AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "agents");

function parseModelSpec(value: unknown, source: string): RoleModelSpec | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Role file ${source} has an invalid model value.`);
  }

  const label = value.trim();
  const slashIndex = label.indexOf("/");
  if (slashIndex <= 0 || slashIndex === label.length - 1) {
    throw new Error(`Role file ${source} model must use provider/model format.`);
  }

  return {
    provider: label.slice(0, slashIndex),
    modelId: label.slice(slashIndex + 1),
    label,
  };
}

function parseThinkingLevel(value: unknown, source: string): SessionThinkingLevel | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !THINKING_LEVELS.has(value as SessionThinkingLevel)) {
    throw new Error(`Role file ${source} has an invalid thinking level.`);
  }
  return value as SessionThinkingLevel;
}

function parseRoleTools(value: unknown, source: string): string[] {
  if (value === undefined) {
    return DEFAULT_TOOLS;
  }

  const rawTools =
    typeof value === "string"
      ? value.split(",")
      : Array.isArray(value)
        ? value.map((item) => {
            if (typeof item !== "string") {
              throw new Error(`Role file ${source} has a non-string tool value.`);
            }
            return item;
          })
        : undefined;

  if (!rawTools) {
    throw new Error(`Role file ${source} has an invalid tools value.`);
  }

  const tools = rawTools.map((tool) => tool.trim()).filter(Boolean);
  for (const tool of tools) {
    if (!SUBAGENT_TOOL_NAMES.has(tool)) {
      throw new Error(`Role file ${source} references unsupported tool "${tool}".`);
    }
  }

  return [...new Set(tools)];
}

function parseOptionalBoolean(value: unknown, field: string, source: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Role file ${source} has an invalid ${field} value.`);
  }
  return value;
}

function parseOptionalString(value: unknown, field: string, source: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Role file ${source} has an invalid ${field} value.`);
  }
  return value.trim() || undefined;
}

export function loadSubagentRoles(): SubagentRole[] {
  return ROLE_AGENT_FILES.map((fileName) => {
    const filePath = join(ROLE_AGENT_DIR, fileName);
    if (!existsSync(filePath)) {
      throw new Error(`Missing sub-agent role file: ${filePath}`);
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(
      readFileSync(filePath, "utf8"),
    );
    const name = parseOptionalString(frontmatter.name, "name", fileName);
    if (!name) {
      throw new Error(`Role file ${fileName} must declare a name.`);
    }

    return {
      name,
      description: parseOptionalString(frontmatter.description, "description", fileName) ?? "",
      tools: parseRoleTools(frontmatter.tools, fileName),
      model: parseModelSpec(frontmatter.model, fileName),
      thinking: parseThinkingLevel(frontmatter.thinking, fileName),
      systemPrompt: body.trim(),
      filePath,
      autoExit: parseOptionalBoolean(frontmatter["auto-exit"], "auto-exit", fileName),
      output: parseOptionalString(frontmatter.output, "output", fileName),
    };
  });
}

export function parseStartArgs(
  input: string,
  rolesByName: Map<string, SubagentRole>,
): ParsedStartArgs | null {
  const taskInput = input.trim();
  if (!taskInput) {
    return null;
  }

  const colonIndex = taskInput.indexOf(":");
  if (colonIndex > 0 && colonIndex <= 48) {
    const name = taskInput.slice(0, colonIndex).trim();
    const task = taskInput.slice(colonIndex + 1).trim();
    if (name && task) {
      const role = rolesByName.get(name.toLowerCase());
      return role ? { name: role.name, task, role } : { name, task };
    }
  }

  const { command: firstWord, rest } = splitCommand(taskInput);
  const role = rolesByName.get(firstWord.toLowerCase());
  if (role) {
    if (!rest) {
      return null;
    }
    return {
      name: role.name,
      task: rest,
      role,
    };
  }

  return {
    name: deriveName(taskInput),
    task: taskInput,
  };
}
