# @danchamorro/pi-handoff-agent

Export the active Pi conversation into a portable handoff that another agent session can read and continue from.

## Why this exists

Long-running agent work often outlives a single session. You may need to move from one Pi session to another, continue work after compaction, hand context to a different model, or preserve the exact decision trail before switching tasks. Native session files are not a good handoff format: they contain tool calls, command output, MCP payloads, thinking traces, and Pi-specific event records that are noisy, private, and not portable.

`pi-handoff-agent` turns the current active Pi branch into a clean continuity artifact:

- preserves the exact user and assistant message text
- keeps branch or compaction summaries when they are part of active context
- preserves raw pre-compact branch history instead of relying only on lossy compact summaries
- strips tool calls, tool results, command output, MCP output, thinking traces, and extension state records
- writes a canonical JSON file for the next agent session
- writes a Markdown companion for human review
- protects `.handoffs/` with `.gitignore` so private context is not accidentally committed

The point is not native session cloning. The point is portable continuity: a fresh agent can quickly understand where the previous session left off without inheriting hidden tool output or Pi internals.

## Install

```bash
pi install npm:@danchamorro/pi-handoff-agent
```

For local development from this repo:

```bash
pi install ./packages/handoff-pi-agent
```

## Command

Run this inside the Pi session you want to export:

```text
/handoff-export
```

The command writes project-local files:

```text
.handoffs/<timestamp-pi-agent>/handoff.json
.handoffs/<timestamp-pi-agent>/handoff.md
```

`handoff.json` is the canonical artifact for receiving agents. `handoff.md` is generated from the JSON for inspection and review.

## Receiving workflow

Start a fresh agent session in the same repo and say:

```text
Please read .handoffs/<timestamp-pi-agent>/handoff.json so we can pick up where I left off. The companion handoff.md is for human review.
```

A good receiving session should be able to identify the current goal, key decisions, completed work, open caveats, and the next action.

## Why a package-backed extension

The export must read the live Pi session branch. File modification time is not reliable when sessions are resumed, forked, compacted, or running concurrently. This package registers a Pi extension command so it can use Pi runtime APIs for the active branch and session metadata instead of guessing from session files.

## Privacy and gitignore behavior

Handoffs may contain private prompts, code snippets, local paths, and business context. The exporter appends `.handoffs/` to an existing `.gitignore`. If no `.gitignore` exists, it fails safely rather than silently creating one.

Review handoffs before sharing them outside the project or organization.

## What gets stripped

The exporter removes nonportable artifacts by default:

- tool calls
- tool results
- shell command output
- MCP output
- thinking or reasoning blocks
- known Pi settings events such as model changes
- extension state records such as `custom` and `label` entries
- empty messages left after stripping

The output stats record how many items were seen, written, omitted, and stripped.

## Compaction behavior

Pi compaction is append-only: compacting a session appends a summary entry but does not delete the earlier raw messages from the session file. Because this package exports the active branch path, handoffs can still include pre-compact user and assistant messages. Compaction summaries are preserved as `context` records so a receiving agent can see that compaction occurred, but they are not the only source of continuity.

## CLI for explicit snapshots

The CLI is for tests and explicit normalized snapshots. It cannot export the current Pi session because that requires the live extension context.

```bash
node packages/handoff-pi-agent/scripts/extract-handoff.ts \
  --input shared/handoff/fixtures/simple-transcript.json \
  --cwd "$PWD" \
  --out .handoffs/cli-test \
  --add-gitignore=false
```

## Development note

This package includes a package-local copy of the shared implementation under `shared/handoff/` so the npm tarball is self-contained. Keep those files synchronized with the repo-level canonical source in `shared/handoff/` before publishing.
