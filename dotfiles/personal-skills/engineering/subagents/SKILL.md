---
name: subagents
description: Route delegated work through the current host's supported sub-agent mechanism. In Pi, use the installed pi-subagents package. Use whenever the user asks for a subagent, Pi agent, Claude or Codex agent, or independent multi-agent work.
---

# Sub-Agent Host Routing

## Pi

When the `subagent` tool is available, use it and follow the bundled
`pi-subagents` skill for single, parallel, chained, background, and
forked-context delegation.

Treat explicit Claude or Codex wording as a model/provider preference inside
Pi, not as a native CLI harness. Use an exact available model when the request
identifies one; otherwise ask rather than guessing.

Do not use legacy `start_subagent`, `stop_subagent`, or `reply_subagent` tools.

## Other hosts

Use only the current host's documented native delegation mechanism. Do not
claim Pi package behavior or silently substitute a different host.
