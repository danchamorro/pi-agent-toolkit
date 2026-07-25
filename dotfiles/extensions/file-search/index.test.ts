import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { buildFdArgs, buildRgArgs } from "./index.ts";

test("fd builds bounded arguments and keeps patterns after --", () => {
  assert.deepEqual(buildFdArgs({ pattern: "-rf", path: "@src", extension: ".ts", type: "file" }), [
    "--color=never",
    "--type",
    "f",
    "--extension",
    "ts",
    "--max-results",
    "1000",
    "--",
    "-rf",
    "src",
  ]);
});

test("fd lists a home-relative path when pattern is omitted", () => {
  assert.deepEqual(
    buildFdArgs({ path: "~/code", hidden: true, glob: true, max_depth: 3, limit: 25 }),
    [
      "--color=never",
      "--hidden",
      "--glob",
      "--max-depth",
      "3",
      "--max-results",
      "25",
      "--",
      "",
      join(homedir(), "code"),
    ],
  );
});

test("rg uses smart-case defaults and keeps patterns after --", () => {
  assert.deepEqual(buildRgArgs({ pattern: "--help" }), [
    "--line-number",
    "--color=never",
    "--no-heading",
    "--with-filename",
    "--smart-case",
    "--max-count",
    "100",
    "--",
    "--help",
  ]);
});

test("rg translates literal search options", () => {
  assert.deepEqual(
    buildRgArgs({
      pattern: "a.b",
      path: "@config",
      glob: "*.json",
      file_type: "json",
      case_sensitive: false,
      fixed_strings: true,
      hidden: true,
      context: 2,
      limit: 10,
    }),
    [
      "--line-number",
      "--color=never",
      "--no-heading",
      "--with-filename",
      "--ignore-case",
      "--fixed-strings",
      "--hidden",
      "--context",
      "2",
      "--glob",
      "*.json",
      "--type",
      "json",
      "--max-count",
      "10",
      "--",
      "a.b",
      "config",
    ],
  );
});
