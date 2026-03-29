import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  lstatSync,
  readlinkSync,
  cpSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveSource, resolveTarget } from "./installer.ts";
import {
  BUNDLED_DOTFILES,
  PI_EXTENSIONS_DIR,
  PI_SKILLS_DIR,
  PI_AGENT_DIR,
  AGENTS_SKILLS_DIR,
} from "./paths.ts";
import type { Component } from "./registry.ts";

// ---------------------------------------------------------------------------
// resolveSource
// ---------------------------------------------------------------------------

describe("resolveSource", () => {
  it("throws when component has no source", () => {
    const component: Component = {
      name: "test",
      category: "extensions",
      description: "test",
      method: "copy",
    };
    assert.throws(
      () => resolveSource(component, { link: false, overrideConfigs: false, cliVersion: "1.0" }),
      /no source path/,
    );
  });

  it("resolves to bundled dotfiles in copy mode", () => {
    const component: Component = {
      name: "tilldone",
      category: "extensions",
      description: "test",
      method: "copy",
      source: "extensions/tilldone.ts",
    };
    const result = resolveSource(component, {
      link: false,
      overrideConfigs: false,
      cliVersion: "1.0",
    });
    assert.equal(result, resolve(BUNDLED_DOTFILES, "extensions/tilldone.ts"));
  });

  it("resolves to repo path in link mode", () => {
    const component: Component = {
      name: "tilldone",
      category: "extensions",
      description: "test",
      method: "copy",
      source: "extensions/tilldone.ts",
    };
    const result = resolveSource(component, {
      link: true,
      repoPath: "/home/user/pi-agent-toolkit",
      overrideConfigs: false,
      cliVersion: "1.0",
    });
    assert.equal(result, "/home/user/pi-agent-toolkit/dotfiles/extensions/tilldone.ts");
  });
});

// ---------------------------------------------------------------------------
// resolveTarget
// ---------------------------------------------------------------------------

describe("resolveTarget", () => {
  it("resolves single-file extensions to extensions dir", () => {
    const component: Component = {
      name: "tilldone",
      category: "extensions",
      description: "test",
      method: "copy",
      source: "extensions/tilldone.ts",
    };
    assert.equal(resolveTarget(component), resolve(PI_EXTENSIONS_DIR, "tilldone.ts"));
  });

  it("resolves directory extensions by name", () => {
    const component: Component = {
      name: "damage-control",
      category: "extensions",
      description: "test",
      method: "copy",
      source: "extensions/damage-control",
      isDirectory: true,
    };
    assert.equal(resolveTarget(component), resolve(PI_EXTENSIONS_DIR, "damage-control"));
  });

  it("resolves bundled global skills to agents skills dir", () => {
    const component: Component = {
      name: "brainstorm",
      category: "skills-bundled",
      description: "test",
      method: "copy",
      source: "global-skills/brainstorm",
      target: "global-skills",
      isDirectory: true,
    };
    assert.equal(resolveTarget(component), resolve(AGENTS_SKILLS_DIR, "brainstorm"));
  });

  it("resolves bundled agent skills to pi skills dir", () => {
    const component: Component = {
      name: "exa-search",
      category: "skills-bundled",
      description: "test",
      method: "copy",
      source: "agent-skills/exa-search",
      target: "agent-skills",
      isDirectory: true,
    };
    assert.equal(resolveTarget(component), resolve(PI_SKILLS_DIR, "exa-search"));
  });

  it("resolves config templates by stripping .template suffix", () => {
    const component: Component = {
      name: "auth.json",
      category: "configs",
      description: "test",
      method: "copy",
      source: "auth.json.template",
      isTemplate: true,
    };
    assert.equal(resolveTarget(component), resolve(PI_AGENT_DIR, "auth.json"));
  });

  it("resolves plain configs by source name", () => {
    const component: Component = {
      name: "AGENTS.md",
      category: "configs",
      description: "test",
      method: "copy",
      source: "AGENTS.md",
      isTemplate: true,
    };
    assert.equal(resolveTarget(component), resolve(PI_AGENT_DIR, "AGENTS.md"));
  });
});

// ---------------------------------------------------------------------------
// Copy and symlink mechanics (using temp directories)
// ---------------------------------------------------------------------------

let testDir: string;

beforeEach(() => {
  testDir = join(
    tmpdir(),
    `pi-toolkit-installer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("copy mechanics", () => {
  it("copies a single file", () => {
    const source = join(testDir, "source.ts");
    const target = join(testDir, "dest", "source.ts");
    writeFileSync(source, "export const x = 1;");

    mkdirSync(join(testDir, "dest"), { recursive: true });
    cpSync(source, target);

    assert.equal(readFileSync(target, "utf-8"), "export const x = 1;");
  });

  it("copies a directory recursively", () => {
    const sourceDir = join(testDir, "ext");
    mkdirSync(sourceDir);
    writeFileSync(join(sourceDir, "index.ts"), "export default {};");
    writeFileSync(join(sourceDir, "package.json"), "{}");

    const targetDir = join(testDir, "dest", "ext");
    cpSync(sourceDir, targetDir, { recursive: true });

    assert.ok(existsSync(join(targetDir, "index.ts")));
    assert.ok(existsSync(join(targetDir, "package.json")));
  });
});

describe("symlink mechanics", () => {
  it("creates a symlink to a file", () => {
    const source = join(testDir, "source.ts");
    const target = join(testDir, "link.ts");
    writeFileSync(source, "export const x = 1;");

    symlinkSync(source, target);

    assert.ok(lstatSync(target).isSymbolicLink());
    assert.equal(readlinkSync(target), source);
    assert.equal(readFileSync(target, "utf-8"), "export const x = 1;");
  });

  it("creates a symlink to a directory", () => {
    const sourceDir = join(testDir, "ext");
    mkdirSync(sourceDir);
    writeFileSync(join(sourceDir, "index.ts"), "code");

    const target = join(testDir, "link-ext");
    symlinkSync(sourceDir, target);

    assert.ok(lstatSync(target).isSymbolicLink());
    assert.ok(existsSync(join(target, "index.ts")));
  });

  it("detects dangling symlinks via lstatSync", () => {
    const target = join(testDir, "dangling");
    symlinkSync("/nonexistent/path", target);

    // lstatSync succeeds on dangling symlinks
    assert.ok(lstatSync(target).isSymbolicLink());
    // existsSync returns false for dangling symlinks
    assert.equal(existsSync(target), false);
  });
});

describe("config protection", () => {
  it("existing file blocks copy when overrideConfigs is false", () => {
    const target = join(testDir, "AGENTS.md");
    writeFileSync(target, "original content");

    // Simulate the protection check from installLocal
    const isTemplate = true;
    const overrideConfigs = false;
    const shouldSkip = isTemplate && existsSync(target) && !overrideConfigs;

    assert.equal(shouldSkip, true);
  });

  it("existing file allows copy when overrideConfigs is true", () => {
    const target = join(testDir, "AGENTS.md");
    writeFileSync(target, "original content");

    const isTemplate = true;
    const overrideConfigs = true;
    const shouldSkip = isTemplate && existsSync(target) && !overrideConfigs;

    assert.equal(shouldSkip, false);
  });

  it("missing file allows copy regardless of flag", () => {
    const target = join(testDir, "AGENTS.md");

    const isTemplate = true;
    const overrideConfigs = false;
    const shouldSkip = isTemplate && existsSync(target) && !overrideConfigs;

    assert.equal(shouldSkip, false);
  });
});
