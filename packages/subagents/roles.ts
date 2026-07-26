import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CODEX_EXECUTABLE,
  DEFAULT_CODEX_MODEL,
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_NATIVE_REASONING_EFFORT,
  DEFAULT_TOOLS,
  ROLE_AGENT_FILES,
  SUBAGENT_TOOL_NAMES,
  THINKING_LEVELS,
} from "./constants.ts";
import { deriveName, splitCommand } from "./format.ts";
import { expandUserPath } from "./paths.ts";
import type {
  NativeHarnessSettings,
  ParsedStartArgs,
  ReasoningEffort,
  RoleModelSpec,
  SessionThinkingLevel,
  SubagentHarness,
  SubagentLimits,
  SubagentRoleDiagnostic,
  SubagentRoleLoadResult,
  SubagentRoleOverride,
  SubagentRole,
  SubagentSettings,
} from "./types.ts";

const ROLE_AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "agents");
const USER_AGENT_DIR_NAME = "agents";
const SETTINGS_FILE_NAME = "settings.json";

type RoleLoadOptions = {
  agentDir?: string;
  settings?: SubagentSettings;
};

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

function readSubagentSettings(agentDir: string): {
  settings: SubagentSettings;
  diagnostics: SubagentRoleDiagnostic[];
} {
  const settingsPath = join(agentDir, SETTINGS_FILE_NAME);
  if (!existsSync(settingsPath)) {
    return { settings: {}, diagnostics: [] };
  }

  try {
    const raw = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      subagents?: unknown;
    };
    const subagents = raw.subagents;
    if (!subagents || typeof subagents !== "object" || Array.isArray(subagents)) {
      return { settings: {}, diagnostics: [] };
    }
    return { settings: subagents as SubagentSettings, diagnostics: [] };
  } catch (error) {
    return {
      settings: {},
      diagnostics: [
        {
          level: "warning",
          filePath: settingsPath,
          message: `Could not read subagent settings: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

function parseRoleFile(filePath: string, source: SubagentRole["source"]): SubagentRole {
  const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(
    readFileSync(filePath, "utf8"),
  );
  const name = parseOptionalString(frontmatter.name, "name", filePath);
  if (!name) {
    throw new Error(`Role file ${filePath} must declare a name.`);
  }

  return {
    name,
    description: parseOptionalString(frontmatter.description, "description", filePath) ?? "",
    tools: parseRoleTools(frontmatter.tools, filePath),
    model: parseModelSpec(frontmatter.model, filePath),
    thinking: parseThinkingLevel(frontmatter.thinking, filePath),
    systemPrompt: body.trim(),
    filePath,
    source,
    autoExit: parseOptionalBoolean(frontmatter["auto-exit"], "auto-exit", filePath),
    output: parseOptionalString(frontmatter.output, "output", filePath),
  };
}

function loadBuiltInRoles(): SubagentRole[] {
  return ROLE_AGENT_FILES.map((fileName) => {
    const filePath = join(ROLE_AGENT_DIR, fileName);
    if (!existsSync(filePath)) {
      throw new Error(`Missing sub-agent role file: ${filePath}`);
    }
    return parseRoleFile(filePath, "built-in");
  });
}

function listUserRoleFiles(agentDir: string): string[] {
  const userAgentDir = join(agentDir, USER_AGENT_DIR_NAME);
  if (!existsSync(userAgentDir)) {
    return [];
  }

  return readdirSync(userAgentDir, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.name.endsWith(".md")) {
        return false;
      }
      if (entry.isFile()) {
        return true;
      }
      if (!entry.isSymbolicLink()) {
        return false;
      }
      try {
        return statSync(join(userAgentDir, entry.name)).isFile();
      } catch {
        return false;
      }
    })
    .map((entry) => join(userAgentDir, entry.name))
    .sort();
}

function addUserRoles(
  roles: SubagentRole[],
  diagnostics: SubagentRoleDiagnostic[],
  agentDir: string,
): void {
  const rolesByName = new Map(roles.map((role) => [role.name.toLowerCase(), role]));

  for (const filePath of listUserRoleFiles(agentDir)) {
    let role: SubagentRole;
    try {
      role = parseRoleFile(filePath, "user");
    } catch (error) {
      diagnostics.push({
        level: "warning",
        filePath,
        message: `Skipped custom sub-agent role: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const existing = rolesByName.get(role.name.toLowerCase());
    if (existing) {
      diagnostics.push({
        level: "warning",
        filePath,
        message: `Skipped custom sub-agent role "${role.name}" because it conflicts with ${existing.source} role "${existing.name}". Use settings.json subagents.agentOverrides.${existing.name} to override model/thinking/tools.`,
      });
      continue;
    }

    roles.push(role);
    rolesByName.set(role.name.toLowerCase(), role);
  }
}

function applyRoleOverride(
  role: SubagentRole,
  override: SubagentRoleOverride,
  diagnostics: SubagentRoleDiagnostic[],
): SubagentRole {
  let next = role;

  const setOverride = (updates: Partial<SubagentRole>) => {
    next = { ...next, ...updates, overridden: true };
  };

  if (override.model !== undefined) {
    try {
      setOverride({ model: parseModelSpec(override.model, `settings override for ${role.name}`) });
    } catch (error) {
      diagnostics.push({
        level: "warning",
        message: `Ignored model override for sub-agent role "${role.name}": ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (override.thinking !== undefined) {
    try {
      setOverride({
        thinking: parseThinkingLevel(override.thinking, `settings override for ${role.name}`),
      });
    } catch (error) {
      diagnostics.push({
        level: "warning",
        message: `Ignored thinking override for sub-agent role "${role.name}": ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  if (override.tools !== undefined) {
    try {
      setOverride({ tools: parseRoleTools(override.tools, `settings override for ${role.name}`) });
    } catch (error) {
      diagnostics.push({
        level: "warning",
        message: `Ignored tools override for sub-agent role "${role.name}": ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return next;
}

function applyRoleOverrides(
  roles: SubagentRole[],
  settings: SubagentSettings,
  diagnostics: SubagentRoleDiagnostic[],
): SubagentRole[] {
  const overrides = settings.agentOverrides;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    return roles;
  }

  const overridesByName = new Map(
    Object.entries(overrides).map(([name, override]) => [name.toLowerCase(), override]),
  );
  const rolesByName = new Map(roles.map((role) => [role.name.toLowerCase(), role]));

  for (const name of overridesByName.keys()) {
    if (!rolesByName.has(name)) {
      diagnostics.push({
        level: "warning",
        message: `Ignored settings override for unknown sub-agent role "${name}".`,
      });
    }
  }

  return roles.map((role) => {
    const override = overridesByName.get(role.name.toLowerCase());
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      return role;
    }
    return applyRoleOverride(role, override, diagnostics);
  });
}

function parseOpenInHerdr(
  settings: SubagentSettings,
  diagnostics: SubagentRoleDiagnostic[],
): boolean {
  if (settings.openInHerdr === undefined) {
    return false;
  }
  if (typeof settings.openInHerdr === "boolean") {
    return settings.openInHerdr;
  }
  diagnostics.push({
    level: "warning",
    message: "Ignored invalid subagents.openInHerdr value; using false.",
  });
  return false;
}

function parseHarnessSettings(
  settings: SubagentSettings,
  diagnostics: SubagentRoleDiagnostic[],
): Record<"claude" | "codex", NativeHarnessSettings> {
  const defaults: Record<"claude" | "codex", NativeHarnessSettings> = {
    claude: {
      model: DEFAULT_CLAUDE_MODEL,
      reasoningEffort: DEFAULT_NATIVE_REASONING_EFFORT,
    },
    codex: {
      executable: expandUserPath(DEFAULT_CODEX_EXECUTABLE),
      model: DEFAULT_CODEX_MODEL,
      reasoningEffort: DEFAULT_NATIVE_REASONING_EFFORT,
    },
  };
  const rawHarnesses = settings.harnesses;
  if (rawHarnesses === undefined) {
    return defaults;
  }
  if (!rawHarnesses || typeof rawHarnesses !== "object" || Array.isArray(rawHarnesses)) {
    diagnostics.push({
      level: "warning",
      message: "Ignored invalid subagents.harnesses value; using native harness defaults.",
    });
    return defaults;
  }

  for (const harness of ["claude", "codex"] as const) {
    const raw = (rawHarnesses as Record<string, unknown>)[harness];
    if (raw === undefined) {
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      diagnostics.push({
        level: "warning",
        message: `Ignored invalid subagents.harnesses.${harness} value; using defaults.`,
      });
      continue;
    }
    const value = raw as Record<string, unknown>;
    if (value.model !== undefined) {
      if (typeof value.model === "string" && value.model.trim()) {
        defaults[harness].model = value.model.trim();
      } else {
        diagnostics.push({
          level: "warning",
          message: `Ignored invalid subagents.harnesses.${harness}.model value.`,
        });
      }
    }
    if (value.reasoningEffort !== undefined) {
      if (
        typeof value.reasoningEffort === "string" &&
        ["low", "medium", "high", "xhigh", "max"].includes(value.reasoningEffort)
      ) {
        defaults[harness].reasoningEffort = value.reasoningEffort as ReasoningEffort;
      } else {
        diagnostics.push({
          level: "warning",
          message: `Ignored invalid subagents.harnesses.${harness}.reasoningEffort value; using ${DEFAULT_NATIVE_REASONING_EFFORT}.`,
        });
      }
    }
    if (value.executable !== undefined) {
      if (typeof value.executable === "string" && value.executable.trim()) {
        const executable = expandUserPath(value.executable.trim());
        if (isAbsolute(executable)) {
          defaults[harness].executable = executable;
        } else {
          diagnostics.push({
            level: "warning",
            message: `Ignored relative subagents.harnesses.${harness}.executable value; using the default.`,
          });
        }
      } else {
        diagnostics.push({
          level: "warning",
          message: `Ignored invalid subagents.harnesses.${harness}.executable value; using the default.`,
        });
      }
    }
  }
  return defaults;
}

function parseLimits(
  settings: SubagentSettings,
  diagnostics: SubagentRoleDiagnostic[],
): SubagentLimits {
  let maxConcurrent = DEFAULT_MAX_CONCURRENT;
  if (settings.maxConcurrent !== undefined) {
    if (
      typeof settings.maxConcurrent === "number" &&
      Number.isInteger(settings.maxConcurrent) &&
      settings.maxConcurrent >= 1
    ) {
      maxConcurrent = settings.maxConcurrent;
    } else {
      diagnostics.push({
        level: "warning",
        message: `Ignored invalid subagents.maxConcurrent value; using ${DEFAULT_MAX_CONCURRENT}.`,
      });
    }
  }

  let idleTimeoutMinutes = DEFAULT_IDLE_TIMEOUT_MINUTES;
  if (settings.idleTimeoutMinutes !== undefined) {
    if (
      typeof settings.idleTimeoutMinutes === "number" &&
      Number.isFinite(settings.idleTimeoutMinutes) &&
      settings.idleTimeoutMinutes >= 0
    ) {
      idleTimeoutMinutes = settings.idleTimeoutMinutes;
    } else {
      diagnostics.push({
        level: "warning",
        message: "Ignored invalid subagents.idleTimeoutMinutes value; idle auto-stop disabled.",
      });
    }
  }

  return { maxConcurrent, idleTimeoutMs: Math.round(idleTimeoutMinutes * 60_000) };
}

export function loadSubagentRoles(options: RoleLoadOptions = {}): SubagentRoleLoadResult {
  const agentDir = options.agentDir ?? getAgentDir();
  const diagnostics: SubagentRoleDiagnostic[] = [];
  const roles = loadBuiltInRoles();

  addUserRoles(roles, diagnostics, agentDir);

  const settingsResult =
    options.settings === undefined
      ? readSubagentSettings(agentDir)
      : { settings: options.settings, diagnostics: [] };
  diagnostics.push(...settingsResult.diagnostics);

  return {
    roles: applyRoleOverrides(roles, settingsResult.settings, diagnostics),
    diagnostics,
    limits: parseLimits(settingsResult.settings, diagnostics),
    openInHerdr: parseOpenInHerdr(settingsResult.settings, diagnostics),
    harnesses: parseHarnessSettings(settingsResult.settings, diagnostics),
  };
}

export function parseStartArgs(
  input: string,
  rolesByName: Map<string, SubagentRole>,
): ParsedStartArgs | null {
  let taskInput = input.trim();
  if (!taskInput) {
    return null;
  }

  let harness: SubagentHarness | undefined;
  const harnessMatch = /^--harness=([^\s]+)(?:\s+|$)/u.exec(taskInput);
  if (harnessMatch) {
    const value = harnessMatch[1];
    if (value !== "pi" && value !== "claude" && value !== "codex") {
      throw new Error(
        `Unknown sub-agent harness "${value}". Supported harnesses: pi, claude, codex.`,
      );
    }
    harness = value;
    taskInput = taskInput.slice(harnessMatch[0].length).trim();
  }
  if (!taskInput) {
    return null;
  }

  const colonIndex = taskInput.indexOf(":");
  if (colonIndex > 0 && colonIndex <= 48) {
    const name = taskInput.slice(0, colonIndex).trim();
    const task = taskInput.slice(colonIndex + 1).trim();
    if (name && task) {
      const role = rolesByName.get(name.toLowerCase());
      return role ? { name: role.name, task, role, harness } : { name, task, harness };
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
      harness,
    };
  }

  return {
    name: deriveName(taskInput),
    task: taskInput,
    harness,
  };
}
