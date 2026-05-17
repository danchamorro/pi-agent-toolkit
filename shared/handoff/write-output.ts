import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  assertHandoffArtifact,
  type AddGitignoreMode,
  type HandoffArtifact,
} from "./extractor-core.ts";
import { renderHandoffMarkdown } from "./render-markdown.ts";

export interface WriteHandoffOptions {
  cwd: string;
  addGitignore: AddGitignoreMode;
}

export async function writeHandoffArtifact(
  handoff: HandoffArtifact,
  options: WriteHandoffOptions,
): Promise<HandoffArtifact> {
  assertHandoffArtifact(handoff);
  assertProjectRelativeOutput(options.cwd, handoff);
  await protectGitignore(options.cwd, options.addGitignore);

  const outDir = path.resolve(options.cwd, handoff.output.directory);
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.resolve(options.cwd, handoff.output.json_file),
    `${JSON.stringify(handoff, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.resolve(options.cwd, handoff.output.markdown_file),
    renderHandoffMarkdown(handoff),
    "utf8",
  );
  return handoff;
}

export function assertProjectRelativeOutput(cwd: string, handoff: HandoffArtifact): void {
  for (const outputPath of [
    handoff.output.directory,
    handoff.output.json_file,
    handoff.output.markdown_file,
  ]) {
    const resolved = path.resolve(cwd, outputPath);
    const relative = path.relative(cwd, resolved);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) continue;
    throw new Error(`Handoff output path must stay inside cwd: ${outputPath}`);
  }
}

export async function protectGitignore(cwd: string, addGitignore: AddGitignoreMode): Promise<void> {
  const gitignore = path.join(cwd, ".gitignore");
  if (!existsSync(gitignore)) {
    if (addGitignore === true) {
      await writeFile(gitignore, ".handoffs/\n", "utf8");
      return;
    }
    if (addGitignore === "ask") {
      throw new Error(
        "No .gitignore exists. Re-run with an explicit addGitignore choice before writing handoffs.",
      );
    }
    return;
  }

  const original = await readFile(gitignore, "utf8");
  if (original.split(/\r?\n/).some((line) => line.trim() === ".handoffs/")) return;
  const separator = original.endsWith("\n") || original.length === 0 ? "" : "\n";
  await writeFile(gitignore, `${original}${separator}.handoffs/\n`, "utf8");
}
