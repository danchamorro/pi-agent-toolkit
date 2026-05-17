---
name: handoff-pi-agent
description: Use when a Pi session needs to hand off active work to a fresh session, another model, or another agent without carrying over tool output or native session internals
---

# Pi Handoff Agent

Use `/handoff-export` when work needs portable continuity: a fresh agent should understand the exact user and assistant conversation so far, but should not inherit noisy tool calls, command output, MCP payloads, or thinking traces.

This is not native session cloning. It creates a clean handoff artifact from the active Pi branch so another session can continue safely.

## When to Use

Use this before:

- switching to a fresh Pi session
- handing work to another agent or model
- preserving a long planning or implementation session before compaction
- moving from a high-context session to a cleaner execution session
- sharing progress with a reviewer who needs conversation context but not raw tool output

## Command

```text
/handoff-export
```

The command reads the active in-memory Pi branch, not the newest session file. This matters because resumed, forked, compacted, or concurrent sessions can make file-based detection wrong.

It writes:

```text
.handoffs/<timestamp-pi-agent>/handoff.json
.handoffs/<timestamp-pi-agent>/handoff.md
```

`handoff.json` is canonical for receiving agents. `handoff.md` is for human review.

## Receiving Prompt

```text
Please read .handoffs/<timestamp-pi-agent>/handoff.json so we can pick up where I left off. The companion handoff.md is for human review.
```

The receiving session should summarize the current goal, key decisions, completed work, caveats, and next action before continuing.

## What Gets Preserved

- exact user message text
- exact assistant message text
- context summaries when present in the active branch
- timestamps and source message IDs when available
- source metadata such as session file, cwd, and generated time

## What Gets Stripped

- tool calls
- tool results
- shell command output
- MCP output
- thinking or reasoning traces
- known Pi settings events
- empty messages left after stripping

Stripped counts are recorded in `stats` so reviewers can see how much nonportable material was removed.

## Privacy

Handoffs can include private prompts, paths, code snippets, and business context. Review before sharing. The exporter adds `.handoffs/` to an existing `.gitignore`; if no `.gitignore` exists, it fails safely unless explicit creation is requested through the CLI.

## Troubleshooting

If export fails because `.gitignore` is missing, create one intentionally or use the explicit-input CLI with `--add-gitignore=true` or `--add-gitignore=false`.

If the receiving session lacks important context, inspect `handoff.json` first. The exporter is intentionally stripping tool output, so important conclusions should be present in user or assistant text, not only in raw command output.
