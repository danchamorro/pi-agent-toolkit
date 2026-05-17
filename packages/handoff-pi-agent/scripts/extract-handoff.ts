#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createHandoffArtifact,
  type AddGitignoreMode,
  type HandoffSnapshot,
} from "../shared/handoff/extractor-core.ts";
import { writeHandoffArtifact } from "../shared/handoff/write-output.ts";

interface CliOptions {
  input?: string;
  cwd: string;
  out?: string;
  addGitignore?: AddGitignoreMode;
  strict: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.input)
    throw new Error(
      "--input is required. fromCurrent is only available inside the Pi extension context.",
    );
  if (options.addGitignore === undefined) {
    throw new Error("--add-gitignore must be explicit: true, false, or ask.");
  }

  const inputPath = path.resolve(options.input);
  const snapshot = JSON.parse(await readFile(inputPath, "utf8")) as HandoffSnapshot;
  const generatedAt = new Date().toISOString();
  const directory = options.out ? resolveOutputDirectory(options.cwd, options.out) : undefined;
  const handoff = createHandoffArtifact(
    { ...snapshot, cwd: options.cwd },
    {
      generatedAt,
      outputDirectory: directory,
      jsonFile: directory ? `${directory}/handoff.json` : undefined,
      markdownFile: directory ? `${directory}/handoff.md` : undefined,
      strict: options.strict,
    },
  );

  await writeHandoffArtifact(handoff, { cwd: options.cwd, addGitignore: options.addGitignore });
  console.log(handoff.output.json_file);
  console.log(handoff.output.markdown_file);
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { cwd: process.cwd(), strict: false };
  for (let index = 0; index < args.length; index += 1) {
    const [arg, inlineValue] = splitArg(args[index]);
    const next = inlineValue ?? args[index + 1];
    const consumedNext = inlineValue === undefined;
    if (arg === "--input") {
      options.input = requiredValue(arg, next);
      if (consumedNext) index += 1;
    } else if (arg === "--cwd") {
      options.cwd = path.resolve(requiredValue(arg, next));
      if (consumedNext) index += 1;
    } else if (arg === "--out") {
      options.out = requiredValue(arg, next);
      if (consumedNext) index += 1;
    } else if (arg === "--add-gitignore") {
      options.addGitignore = parseAddGitignore(requiredValue(arg, next));
      if (consumedNext) index += 1;
    } else if (arg === "--strict") {
      options.strict = true;
    } else if (arg === "fromCurrent" || arg === "--from-current") {
      throw new Error(
        "fromCurrent requires the Pi extension context. Use /handoff-export instead.",
      );
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function resolveOutputDirectory(cwd: string, output: string): string {
  const resolved = path.isAbsolute(output) ? output : path.resolve(cwd, output);
  return path.relative(cwd, resolved);
}

function splitArg(value: string): [string, string | undefined] {
  const separator = value.indexOf("=");
  if (separator === -1) return [value, undefined];
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function requiredValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseAddGitignore(value: string): AddGitignoreMode {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "ask") return "ask";
  throw new Error("--add-gitignore must be true, false, or ask");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
