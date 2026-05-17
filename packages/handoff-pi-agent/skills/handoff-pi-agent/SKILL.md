---
name: handoff-pi-agent
description: Use when exporting the active Pi session for another agent or a fresh session to continue from clean handoff files
---

# Pi Handoff Agent

Use `/handoff-export` in Pi when you need portable continuity without native session cloning.

The command reads the active in-memory Pi branch, not the newest session file. It writes `.handoffs/<timestamp-pi-agent>/handoff.json` as the canonical artifact and `handoff.md` for human review.

## Receiving Prompt

```text
Please read .handoffs/<timestamp-pi-agent>/handoff.json so we can pick up where I left off. The companion handoff.md is for human review.
```

## Privacy

Handoffs can include private prompts, paths, code snippets, and business context. Review before sharing. The exporter adds `.handoffs/` to an existing `.gitignore`; if no `.gitignore` exists, it fails safely unless explicit creation is requested through the CLI.

## What Gets Stripped

Tool calls, tool results, command output, MCP output, and thinking traces are removed. Empty messages left after stripping are omitted and counted in stats.

## Troubleshooting

If export fails because `.gitignore` is missing, create one intentionally or use the explicit-input CLI with `--add-gitignore=true` or `--add-gitignore=false`.
