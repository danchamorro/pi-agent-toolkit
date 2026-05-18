# Handoff Format

`handoff.json` is the canonical receiving-agent artifact. `handoff.md` is generated from the JSON for human review.

The artifact is a continuity packet, not a mode selector and not a native session clone. It has one opinionated format:

1. `briefing`: a concise current-state briefing for the receiving agent. `/handoff-export` makes a separate one-shot call to the active model with a fresh context window when possible. That call receives only the cleaned timeline and stats. If model access is unavailable, the exporter falls back to deterministic facts.
2. `messages`: the active branch timeline with transcript text, context summaries, tool calls, tool results, command output, and custom context messages preserved as text evidence.
3. `stats` and `warnings`: counts and parser notes for auditability.

Thinking and reasoning traces are removed. Extension state entries that do not participate in LLM context, such as `custom`, `label`, model changes, thinking-level changes, and session info, are omitted.

Tool calls and tool results are intentionally preserved because they often contain the concrete evidence a future agent needs: files read, edits attempted, command outputs, test results, subagent summaries, and errors observed. Receiving agents should read `briefing` first and inspect `messages` only when supporting evidence is needed.

Context summaries such as Pi branch or compaction summaries use `role: "context"` with a specific `kind`, for example `branch-summary` or `compaction-summary`.

Warnings are reserved for suspicious input such as malformed entries or unknown content block types. Strict mode turns these warnings into failures.
