import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHandoffArtifact, type HandoffSnapshot } from "./shared/handoff/extractor-core.ts";
import { protectGitignore, writeHandoffArtifact } from "./shared/handoff/write-output.ts";

const snapshot: HandoffSnapshot = {
  sourceAgent: "pi-agent",
  cwd: "/tmp/project",
  entries: [{ role: "user", sourceRole: "user", content: "Continue this task." }],
};

async function withTempDir(test: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "handoff-output-test-"));
  try {
    await test(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("writeHandoffArtifact", () => {
  it("appends .handoffs/ to an existing .gitignore before writing artifacts", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, ".gitignore"), "dist/\n", "utf8");
      const handoff = createHandoffArtifact({ ...snapshot, cwd: dir });

      await writeHandoffArtifact(handoff, { cwd: dir, addGitignore: "ask" });

      assert.equal(await readFile(path.join(dir, ".gitignore"), "utf8"), "dist/\n.handoffs/\n");
      assert.match(
        await readFile(path.join(dir, handoff.output.json_file), "utf8"),
        /Continue this task/,
      );
      assert.match(
        await readFile(path.join(dir, handoff.output.markdown_file), "utf8"),
        /Handoff Export/,
      );
    });
  });

  it("does not duplicate an existing .handoffs/ gitignore entry", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, ".gitignore"), ".handoffs/\n", "utf8");

      await protectGitignore(dir, "ask");

      assert.equal(await readFile(path.join(dir, ".gitignore"), "utf8"), ".handoffs/\n");
    });
  });

  it("fails safely when .gitignore is missing and addGitignore is ask", async () => {
    await withTempDir(async (dir) => {
      await assert.rejects(() => protectGitignore(dir, "ask"), /No \.gitignore exists/);
    });
  });

  it("rejects output paths outside cwd", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, ".gitignore"), ".handoffs/\n", "utf8");
      const handoff = createHandoffArtifact(
        { ...snapshot, cwd: dir },
        {
          outputDirectory: "../outside",
          jsonFile: "../outside/handoff.json",
          markdownFile: "../outside/handoff.md",
        },
      );

      await assert.rejects(
        () => writeHandoffArtifact(handoff, { cwd: dir, addGitignore: "ask" }),
        /must stay inside cwd/,
      );
    });
  });
});
