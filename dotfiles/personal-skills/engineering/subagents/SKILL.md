---
name: subagents
description: Route delegated work across the current host's supported sub-agent mechanisms. In Pi, select Pi, Claude Code, or Codex harnesses. Use whenever the user asks for a subagent, Pi agent, Claude or Claude Code agent, Codex agent, or independent multi-agent work.
---

# Sub-Agent Harness Routing

Each child has a fresh context and cannot see the parent conversation. Include
all relevant paths, constraints, context, and expected output in its
self-contained task.

## Pi

When `start_subagent` is available, use it:

- Generic “subagent” requests use `harness: "pi"`.
- “Pi agent” or “Pi subagent” uses `harness: "pi"`.
- “Claude,” “Claude Code,” “Claude agent,” “Claude subagent,” or “cc” uses `harness: "claude"`.
- “Codex,” “Codex CLI,” “Codex agent,” or “Codex subagent” uses `harness: "codex"`.
- Do not move a generic request away from Pi unless the user names another harness.

Pi inherits the parent model and thinking level unless explicitly overridden.
Claude defaults to `claude-opus-5` at `high` effort. Codex defaults to
`gpt-5.6-sol` at `high` effort. Pass explicit `model` or `reasoning_effort`
when the user requests an override.

Native Claude and Codex accept only `low`, `medium`, `high`, `xhigh`, or `max`.
Do not clamp unsupported values.

Start children and return control immediately. Results arrive automatically;
do not immediately wait unless progress is blocked on the child.

## Other hosts

If `start_subagent` is unavailable, use only the current host's documented
native delegation mechanism. Do not claim Pi harness routing or silently
substitute a different named harness when the host cannot provide it.
