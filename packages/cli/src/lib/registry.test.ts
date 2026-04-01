import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  registry,
  getByCategory,
  getExtensionGroups,
  GROUP_LABELS,
  type Component,
  type ComponentCategory,
  type ExtensionGroup,
} from "./registry.ts";

describe("registry", () => {
  it("contains all expected component counts", () => {
    const extensions = getByCategory("extensions");
    const bundled = getByCategory("skills-bundled");
    const external = getByCategory("skills-external");
    const packages = getByCategory("packages");
    const configs = getByCategory("configs");

    assert.equal(extensions.length, 22);
    assert.equal(bundled.length, 9);
    assert.equal(external.length, 25);
    assert.equal(packages.length, 2);
    assert.equal(configs.length, 8);
    assert.equal(registry.length, 66);
  });

  it("has unique names across all components", () => {
    const names = registry.map((c) => c.name);
    const unique = new Set(names);
    assert.equal(
      names.length,
      unique.size,
      `Duplicate names found: ${names.filter((n, i) => names.indexOf(n) !== i)}`,
    );
  });

  it("every component has required fields", () => {
    for (const c of registry) {
      assert.ok(c.name, `Component missing name`);
      assert.ok(c.category, `${c.name} missing category`);
      assert.ok(c.description, `${c.name} missing description`);
      assert.ok(c.method, `${c.name} missing method`);
    }
  });

  it("copy/symlink components have a source path", () => {
    const local = registry.filter((c) => c.method === "copy" || c.method === "symlink");
    for (const c of local) {
      assert.ok(c.source, `${c.name} uses ${c.method} but has no source`);
    }
  });

  it("skills-cli and pi-install components have a remote", () => {
    const remote = registry.filter((c) => c.method === "skills-cli" || c.method === "pi-install");
    for (const c of remote) {
      assert.ok(c.remote, `${c.name} uses ${c.method} but has no remote`);
    }
  });

  it("recommends references point to valid component names", () => {
    const allNames = new Set(registry.map((c) => c.name));
    for (const c of registry) {
      if (!c.recommends) continue;
      for (const rec of c.recommends) {
        assert.ok(
          allNames.has(rec),
          `${c.name} recommends "${rec}" which doesn't exist in registry`,
        );
      }
    }
  });

  it("all extensions have a group", () => {
    const extensions = getByCategory("extensions");
    for (const ext of extensions) {
      assert.ok(ext.group, `Extension ${ext.name} missing group`);
    }
  });

  it("config templates have isTemplate set", () => {
    const configs = getByCategory("configs");
    for (const c of configs) {
      assert.equal(c.isTemplate, true, `Config ${c.name} missing isTemplate`);
    }
  });
});

describe("getByCategory", () => {
  it("returns only components of the specified category", () => {
    const categories: ComponentCategory[] = [
      "extensions",
      "skills-bundled",
      "skills-external",
      "packages",
      "configs",
    ];

    for (const cat of categories) {
      const results = getByCategory(cat);
      assert.ok(results.length > 0, `No components found for category ${cat}`);
      for (const c of results) {
        assert.equal(c.category, cat, `${c.name} has wrong category`);
      }
    }
  });

  it("returns empty array for unknown category", () => {
    const results = getByCategory("nonexistent" as ComponentCategory);
    assert.equal(results.length, 0);
  });
});

describe("getExtensionGroups", () => {
  it("returns all groups defined in GROUP_LABELS", () => {
    const groups = getExtensionGroups();
    for (const group of Object.keys(GROUP_LABELS) as ExtensionGroup[]) {
      assert.ok(groups[group]?.length > 0, `Group "${group}" is empty or missing`);
    }
  });

  it("every extension appears in exactly one group", () => {
    const groups = getExtensionGroups();
    const allGrouped: Component[] = [];

    for (const components of Object.values(groups)) {
      allGrouped.push(...components);
    }

    const extensions = getByCategory("extensions");
    assert.equal(
      allGrouped.length,
      extensions.length,
      "Grouped extension count doesn't match total extensions",
    );
  });

  it("has display labels for all groups", () => {
    const groups = getExtensionGroups();
    for (const group of Object.keys(groups) as ExtensionGroup[]) {
      assert.ok(GROUP_LABELS[group], `Group "${group}" has no display label`);
    }
  });
});
