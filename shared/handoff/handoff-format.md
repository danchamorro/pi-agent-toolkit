# Handoff Format

`handoff.json` is the canonical receiving-agent artifact. `handoff.md` is generated from the JSON for human review.

The artifact preserves user, assistant, system, other, and context records as verbatim text after removing nonportable blocks. Tool calls, tool results, command output, MCP output, and thinking traces are stripped. Messages that become empty after stripping are omitted and counted in aggregate stats.

Context summaries such as Pi branch or compaction summaries use `role: "context"` with a specific `kind`, for example `branch-summary` or `compaction-summary`.

Warnings are reserved for suspicious input such as malformed entries or unknown content block types. Strict mode turns these warnings into failures.
