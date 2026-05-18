---
name: handoff-pi-agent
description: Use when a Pi session needs to hand off active work to a fresh session, another model, or another agent with a continuity briefing and tool evidence but without thinking traces
---

# Pi Handoff Agent

Use `/handoff-export` when work needs portable continuity: a fresh agent should understand the current goal, status, decisions, tool evidence, validation, risks, and next steps without inheriting thinking traces or native Pi state.

This is not native session cloning. It creates one continuity packet from the active Pi branch so another session can continue safely.

## When to Use

Use this before:

- switching to a fresh Pi session
- handing work to another agent or model
- preserving a long planning or implementation session before compaction
- moving from a high-context session to a cleaner execution session
- sharing progress with a reviewer who needs conversation context and tool evidence

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

## How It Works

1. Code reads the active Pi branch through Pi's session API.
2. Code builds a cleaned timeline that keeps transcript text and tool evidence.
3. Thinking traces and Pi-only state are removed.
4. A separate one-shot model call uses the active model and a fresh context window to write the briefing from the cleaned timeline and stats.
5. If model briefing generation fails, code writes a deterministic fallback briefing.
6. Code writes `handoff.json` and renders `handoff.md` from that JSON.

## Receiving Prompt

```text
Please read .handoffs/<timestamp-pi-agent>/handoff.json so we can pick up where I left off. Start with the briefing, then inspect timeline messages only if supporting evidence is needed. The companion handoff.md is for human review.
```

The receiving session should summarize the current goal, key decisions, completed work, caveats, validation status, and next action before continuing.

## What Gets Preserved

- model-generated briefing from a separate fresh model call when the active model is available
- deterministic briefing fallback when model access is unavailable
- exact user message text
- exact assistant message text
- tool calls and arguments
- tool results and outputs
- shell command output
- MCP output
- context summaries when present in the active branch
- subagent context messages
- raw pre-compact branch history when Pi has compacted the session
- timestamps and source message IDs when available
- source metadata such as session file, cwd, and generated time

## What Gets Removed

- thinking or reasoning traces
- known Pi settings events
- extension state records such as `custom` and `label` entries
- empty messages left after removing thinking or state-only entries

Stats are recorded so reviewers can see how much evidence was preserved and how much non-context state was omitted.

## Compaction Behavior

Pi compaction appends a summary entry but keeps earlier raw messages in the session branch. The exporter reads the active branch, so it can preserve pre-compact user and assistant messages rather than relying only on the compact summary. Compaction summaries remain marked as context records.

## Privacy

Handoffs can include private prompts, paths, code snippets, command output, API responses, database rows, logs, and business context. Review before sharing. The exporter adds `.handoffs/` to an existing `.gitignore`; if no `.gitignore` exists, it fails safely unless explicit creation is requested through the CLI.

## Troubleshooting

If export fails because `.gitignore` is missing, create one intentionally or use the explicit-input CLI with `--add-gitignore=true` or `--add-gitignore=false`.

If the briefing seems too thin, inspect the `messages` timeline in `handoff.json`. The timeline preserves tool evidence so the receiving agent can verify details without needing a recursive handoff chain.
