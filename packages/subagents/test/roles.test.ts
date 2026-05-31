import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadSubagentRoles, parseStartArgs } from "../roles.ts";
import type { SubagentRole } from "../types.ts";

let testDir = "";
let agentDir = "";
let customAgentsDir = "";

function writeCustomRole(fileName: string, content: string): void {
  mkdirSync(customAgentsDir, { recursive: true });
  writeFileSync(join(customAgentsDir, fileName), content);
}

function roleFixture(name: string, extraFrontmatter = ""): string {
  return `---
name: ${name}
description: Thermos-style review agent.
tools: read, bash, grep, find, ls
model: openai-codex/gpt-5.5
thinking: high
auto-exit: true
output: thermos-review.md
${extraFrontmatter}---

# Thermos Review

Review branch changes with a strict correctness and maintainability lens.
`;
}

describe("loadSubagentRoles", () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "pi-subagents-roles-test-"));
    agentDir = join(testDir, "agent");
    customAgentsDir = join(agentDir, "agents");
    mkdirSync(agentDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("loads built-in roles and custom user roles", () => {
    writeCustomRole("thermos-review.md", roleFixture("thermos-review"));

    const result = loadSubagentRoles({ agentDir });
    const roleNames = result.roles.map((role) => role.name).sort();
    const customRole = result.roles.find((role) => role.name === "thermos-review");

    assert.ok(roleNames.includes("planner"));
    assert.ok(roleNames.includes("reviewer"));
    assert.ok(roleNames.includes("scout"));
    assert.ok(roleNames.includes("worker"));
    assert.equal(customRole?.source, "user");
    assert.equal(customRole?.thinking, "high");
    assert.equal(customRole?.model?.label, "openai-codex/gpt-5.5");
    assert.deepEqual(customRole?.tools, ["read", "bash", "grep", "find", "ls"]);
    assert.deepEqual(result.diagnostics, []);
  });

  it("loads symlinked custom user roles", () => {
    const sourceDir = join(testDir, "source");
    const sourcePath = join(sourceDir, "thermos-review.md");
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(customAgentsDir, { recursive: true });
    writeFileSync(sourcePath, roleFixture("thermos-review"));
    symlinkSync(sourcePath, join(customAgentsDir, "thermos-review.md"));

    const result = loadSubagentRoles({ agentDir });
    const customRole = result.roles.find((role) => role.name === "thermos-review");

    assert.equal(customRole?.source, "user");
    assert.deepEqual(result.diagnostics, []);
  });

  it("applies settings overrides to built-in and custom roles", () => {
    writeCustomRole("thermos-review.md", roleFixture("thermos-review"));

    const result = loadSubagentRoles({
      agentDir,
      settings: {
        agentOverrides: {
          scout: {
            model: "openai-codex/gpt-5.5",
            thinking: "off",
            tools: ["read", "grep", "find", "ls"],
          },
          "thermos-review": {
            thinking: "xhigh",
          },
        },
      },
    });

    const scout = result.roles.find((role) => role.name === "scout");
    const thermosReview = result.roles.find((role) => role.name === "thermos-review");

    assert.equal(scout?.overridden, true);
    assert.equal(scout?.model?.label, "openai-codex/gpt-5.5");
    assert.equal(scout?.thinking, "off");
    assert.deepEqual(scout?.tools, ["read", "grep", "find", "ls"]);
    assert.equal(thermosReview?.overridden, true);
    assert.equal(thermosReview?.thinking, "xhigh");
    assert.deepEqual(result.diagnostics, []);
  });

  it("reads role overrides from the Pi agent settings file", () => {
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({
        subagents: {
          agentOverrides: {
            scout: {
              thinking: "low",
            },
          },
        },
      }),
    );

    const result = loadSubagentRoles({ agentDir });
    const scout = result.roles.find((role) => role.name === "scout");

    assert.equal(scout?.overridden, true);
    assert.equal(scout?.thinking, "low");
    assert.deepEqual(result.diagnostics, []);
  });

  it("skips custom roles that conflict with existing role names", () => {
    writeCustomRole("scout.md", roleFixture("scout"));

    const result = loadSubagentRoles({ agentDir });
    const scouts = result.roles.filter((role) => role.name === "scout");

    assert.equal(scouts.length, 1);
    assert.equal(scouts[0]?.source, "built-in");
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0]?.message ?? "", /conflicts with built-in role "scout"/);
  });

  it("keeps valid override fields when another override field is invalid", () => {
    const result = loadSubagentRoles({
      agentDir,
      settings: {
        agentOverrides: {
          scout: {
            thinking: "not-valid",
            tools: "read, grep",
          },
        },
      },
    });

    const scout = result.roles.find((role) => role.name === "scout");

    assert.equal(scout?.overridden, true);
    assert.equal(scout?.thinking, "off");
    assert.deepEqual(scout?.tools, ["read", "grep"]);
    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0]?.message ?? "", /Ignored thinking override/);
  });

  it("reports unknown role overrides", () => {
    const result = loadSubagentRoles({
      agentDir,
      settings: {
        agentOverrides: {
          missing: {
            thinking: "high",
          },
        },
      },
    });

    assert.equal(result.diagnostics.length, 1);
    assert.match(result.diagnostics[0]?.message ?? "", /unknown sub-agent role "missing"/);
  });

  it("defaults concurrency and idle limits when settings omit them", () => {
    const result = loadSubagentRoles({ agentDir });
    assert.equal(result.limits.maxConcurrent, 5);
    assert.equal(result.limits.idleTimeoutMs, 0);
  });

  it("reads valid concurrency and idle limits from settings", () => {
    const result = loadSubagentRoles({
      agentDir,
      settings: { maxConcurrent: 3, idleTimeoutMinutes: 2 },
    });
    assert.equal(result.limits.maxConcurrent, 3);
    assert.equal(result.limits.idleTimeoutMs, 120_000);
    assert.deepEqual(result.diagnostics, []);
  });

  it("ignores invalid limit values with diagnostics and keeps safe defaults", () => {
    const result = loadSubagentRoles({
      agentDir,
      settings: {
        maxConcurrent: 0,
        idleTimeoutMinutes: -5,
      },
    });
    assert.equal(result.limits.maxConcurrent, 5);
    assert.equal(result.limits.idleTimeoutMs, 0);
    assert.equal(result.diagnostics.length, 2);
    assert.match(result.diagnostics[0]?.message ?? "", /maxConcurrent/);
    assert.match(result.diagnostics[1]?.message ?? "", /idleTimeoutMinutes/);
  });
});

describe("parseStartArgs", () => {
  function buildRoles(): Map<string, SubagentRole> {
    const scout: SubagentRole = {
      name: "scout",
      description: "",
      tools: ["read"],
      systemPrompt: "",
      filePath: "/tmp/scout.md",
      source: "built-in",
    };
    return new Map([["scout", scout]]);
  }

  it("returns null for empty input", () => {
    assert.equal(parseStartArgs("   ", buildRoles()), null);
  });

  it("derives a name for a plain ad hoc task", () => {
    const parsed = parseStartArgs("Investigate the flaky test", buildRoles());
    assert.equal(parsed?.role, undefined);
    assert.equal(parsed?.task, "Investigate the flaky test");
    assert.equal(parsed?.name, "Investigate the flaky test");
  });

  it("matches a leading role word", () => {
    const parsed = parseStartArgs("scout map the repo", buildRoles());
    assert.equal(parsed?.role?.name, "scout");
    assert.equal(parsed?.name, "scout");
    assert.equal(parsed?.task, "map the repo");
  });

  it("supports a leading role via the name: task form", () => {
    const parsed = parseStartArgs("scout: map the repo", buildRoles());
    assert.equal(parsed?.role?.name, "scout");
    assert.equal(parsed?.task, "map the repo");
  });

  it("treats a non-role name prefix as a display name", () => {
    const parsed = parseStartArgs("docs: read the readme", buildRoles());
    assert.equal(parsed?.role, undefined);
    assert.equal(parsed?.name, "docs");
    assert.equal(parsed?.task, "read the readme");
  });

  it("returns null when a role is named without a task", () => {
    assert.equal(parseStartArgs("scout", buildRoles()), null);
  });

  it("does not treat a far-away colon as a name separator", () => {
    const input = `${"x".repeat(60)}: do the thing`;
    const parsed = parseStartArgs(input, buildRoles());
    assert.equal(parsed?.role, undefined);
    assert.equal(parsed?.task, input);
  });
});
