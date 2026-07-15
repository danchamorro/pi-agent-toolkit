# @danchamorro/pi-subagents

Background sub-agents for Pi that run focused tasks in fresh in-process Pi
sessions while the main session stays in control.

This package adds a practical delegation layer to Pi. You can start a scout to
map unfamiliar code, ask a planner for an implementation plan, run a reviewer
against a diff, or send a worker to execute a bounded change. The main session
can delegate these jobs through tools, and users can still inspect or control
everything manually through `/subagent`.

The important design choice is that each sub-agent starts with a fresh
conversation context. It receives the assigned task, role instructions, working
directory, allowed tools, and explicit follow-up feedback. It does not inherit
the main session transcript, which keeps background work focused and avoids
burning the main session's remaining context.

## Contents

- [Highlights](#highlights)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Roles](#roles)
- [Custom Agents](#custom-agents)
- [Role Settings](#role-settings)
- [Session Limits](#session-limits)
- [User Commands](#user-commands)
- [Main-Agent Tools](#main-agent-tools)
- [How It Works](#how-it-works)
- [Examples](#examples)
- [Development](#development)
- [Current Scope](#current-scope)
- [Source Layout](#source-layout)

## Highlights

- **Fresh context for every child session.** Sub-agents run as new Pi sessions
  with a task-specific system prompt instead of inheriting the full parent
  transcript.
- **In-process background execution.** Sub-agents run inside the current Pi
  process. There are no extra terminal panes, shell jobs, or external services
  to manage.
- **Visible but compact status.** A small below-editor widget shows active and
  recently finished sub-agents, elapsed time, cwd, latest activity, status, and
  context usage.
- **Bundled role prompts.** The package includes `planner`, `scout`,
  `reviewer`, and `worker` roles with role-specific tools, models, thinking
  levels, and output expectations.
- **Custom agents.** Users can drop Markdown agents into their Pi agent
  directory and have them show up beside the bundled roles.
- **Per-role settings.** Built-in and custom roles can override model,
  thinking level, and tools without editing package files.
- **Bounded concurrency.** A configurable soft cap limits how many sub-agents
  run at once, with an optional idle auto-stop for stalled background work.
- **Manual and agent-driven control.** Users can type `/subagent ...` commands,
  while the main agent can use `start_subagent`, `stop_subagent`, and
  `reply_subagent` tools on the user's behalf.
- **Feedback handoff.** A sub-agent can pause and ask the main session for a
  decision through `ask_main_session`. The user can answer naturally, and the
  main agent can route that answer back with `reply_subagent`.
- **Scoped working directories.** Sub-agents stay anchored to their launch cwd.
  If a relative path is missing there, the child is instructed to ask for
  direction instead of wandering across unrelated folders.
- **Completion handoff.** Sub-agents launched by the main agent report
  completion or failure back into the main session as one hidden follow-up
  bundle, so the main agent can produce a single synthesis instead of competing
  per-agent summaries. Users can still inspect full output later with
  `/subagent view <id>`.

## Quick Start

Install the package:

```bash
pi install npm:@danchamorro/pi-subagents
```

Start a fresh Pi session, then confirm the command is loaded:

```text
/subagent agents
```

You should see the bundled roles:

```text
planner
reviewer
scout
worker
```

Start a background scout manually:

```text
/subagent start scout Map packages/subagents and summarize the package design.
```

Ask the main agent to delegate naturally:

```text
Use a scout subagent to map this repo's extension architecture. Launch it in the
background and do not duplicate the scout's investigation yourself.
```

## Installation

### Standalone Install

Most users should install the package directly from npm. You do not need to
clone `pi-agent-toolkit` or copy any files into your Pi config.

```bash
pi install npm:@danchamorro/pi-subagents
```

Then start or restart Pi in any project:

```bash
pi
```

Verify that the extension loaded:

```text
/subagent agents
```

The package is available to every Pi session after installation. You can start
Pi inside any repo and use `/subagent` there:

```bash
cd /path/to/your/project
pi
```

```text
/subagent start scout Map the repo structure and identify the main entrypoints.
```

### Update

Use Pi's package updater when a new version is published:

```bash
pi update npm:@danchamorro/pi-subagents
```

You can also update all installed Pi packages:

```bash
pi update
```

### Remove

Remove the package from your Pi settings:

```bash
pi remove npm:@danchamorro/pi-subagents
```

### Local Development Install

If you are developing this package from a checkout of `pi-agent-toolkit`, install
the local package path instead of the npm package:

```bash
git clone https://github.com/danchamorro/pi-agent-toolkit.git
cd pi-agent-toolkit
pi install ./packages/subagents
```

That stores a path to your local package source, so edits under
`packages/subagents` can be picked up by restarting Pi or running `/reload`.

## Roles

Roles are Markdown prompt files in [agents/](agents/) with frontmatter for
metadata and a body for behavior. The package loads them at startup, validates
their tools/model/thinking settings, and exposes them through `/subagent agents`.

| Role | Purpose | Default tools | Thinking | Output |
|---|---|---|---|---|
| `planner` | Clarifies a request, reads relevant code, compares implementation options, and returns todos. | `read`, `bash`, `ask_main_session` | `high` | `plan.md` |
| `scout` | Performs fast read-only reconnaissance and returns file maps, facts, conventions, and gotchas. | `read`, `bash`, `ask_main_session` | `off` | `context.md` |
| `reviewer` | Reviews changes for bugs, regressions, security issues, and missing validation. | `read`, `bash`, `ask_main_session` | `high` | `review.md` |
| `worker` | Implements a well-scoped task, runs narrow validation, and reports the changed files. | `read`, `bash`, `write`, `edit`, `ask_main_session` | `minimal` | final result |

Role files support these fields:

| Field | Meaning |
|---|---|
| `name` | Role name used by `/subagent start <role> <task>` and `start_subagent.role`. |
| `description` | Short role description shown in `/subagent agents`. |
| `tools` | Allowed Pi tools for that role. `ask_main_session` is added automatically. |
| `model` | Optional `provider/model` override. If omitted, the child uses the active model. |
| `thinking` | Optional thinking level override, including `off`. |
| `auto-exit` | Tells the role to return a final result when the task is done. |
| `output` | Human-readable expected output artifact, such as `plan.md` or `review.md`. |

## Custom Agents

Custom agents use the same Markdown format as bundled roles. Put them in the Pi
agent directory under `agents/*.md`:

```text
~/.pi/agent/agents/thermos-review.md
```

If you use `pi-agent-toolkit`, keep repo-managed custom agents under
`dotfiles/agents/*.md` and run `npm run dev:sync`. Setup links those files into
`~/.pi/agent/agents/`.

Example:

```markdown
---
name: thermos-review
description: Review a change with a strict correctness and maintainability lens.
tools: read, bash, grep, find, ls
model: openai-codex/gpt-5.6-sol
thinking: high
auto-exit: true
output: review.md
---

You are a focused review sub-agent. Inspect the requested change, report
concrete defects first, cite files and lines when possible, and keep the final
answer concise.
```

After adding or editing a custom agent, restart Pi or run `/reload`, then check:

```text
/subagent agents
```

Custom agents are additive. A custom file cannot silently replace a bundled
role such as `scout` or `reviewer`; conflicting custom roles are skipped and
shown as warnings in `/subagent agents`. If you want to change a bundled role's
model, thinking level, or tools, use role settings instead.

This is the intended place to test external agent collections such as
Thermos-style Cursor agents. Keep those prompts outside the package at first,
convert one prompt into this Markdown format, reload Pi, and confirm it appears
as a custom role before deciding whether any behavior belongs in core.

## Role Settings

Role settings live in the Pi agent settings file:

```text
~/.pi/agent/settings.json
```

Add a `subagents.agentOverrides` object keyed by role name:

```json
{
  "subagents": {
    "agentOverrides": {
      "scout": {
        "model": "openai-codex/gpt-5.6-sol",
        "thinking": "off",
        "tools": ["read", "bash", "grep", "find", "ls"]
      },
      "thermos-review": {
        "thinking": "xhigh"
      }
    }
  }
}
```

Supported override fields are:

| Field | Meaning |
|---|---|
| `model` | Optional `provider/model` model override for that role. |
| `thinking` | Optional thinking level override, including `off`. |
| `tools` | Optional tool allowlist as an array or comma-separated string. |

Invalid override values are ignored with a warning and the role keeps its last
valid value. Unknown role names are also reported in `/subagent agents`, which
helps catch typos after a reload.

## Session Limits

Two optional settings in `~/.pi/agent/settings.json` bound background work:

| Field | Meaning | Default |
|---|---|---|
| `subagents.maxConcurrent` | Maximum number of simultaneously active sub-agents. New launches are refused with a clear message once the cap is reached. | `5` |
| `subagents.idleTimeoutMinutes` | Auto-stop a working sub-agent after this many minutes with no activity. `0` disables it. Sub-agents waiting for feedback are never auto-stopped. | `0` (off) |

```json
{
  "subagents": {
    "maxConcurrent": 3,
    "idleTimeoutMinutes": 15
  }
}
```

Each active sub-agent is a full background model session, so the concurrency cap
guards against runaway cost and provider rate limits. Idle auto-stop is opt-in
so background work is never killed unless you ask for it. Invalid values are
ignored with a warning in `/subagent agents` and the default is used.

## User Commands

The package registers one slash command namespace: `/subagent`.

| Command | What it does |
|---|---|
| `/subagent` | Shows current sub-agent status. |
| `/subagent help` | Lists available sub-agent commands. |
| `/subagent agents` | Lists bundled and custom roles, tools, model, thinking settings, source, and warnings. |
| `/subagent start <task>` | Starts a generic background sub-agent using the current model and thinking level. |
| `/subagent start <role> <task>` | Starts a role-specific background sub-agent. |
| `/subagent start <name>: <task>` | Starts a named sub-agent; if `<name>` matches a role, that role is used. |
| `/subagent list` | Lists all known active and recent sub-agents. |
| `/subagent view [id]` | Shows details for one sub-agent, or status for all sub-agents when `id` is omitted. |
| `/subagent stop <id>` | Stops a running or waiting sub-agent. |
| `/subagent reply <id> <feedback>` | Sends feedback to a sub-agent waiting on `ask_main_session`. |

Sub-agent ids are process-local and look like `sa-1`, `sa-2`, and so on. The
command handlers accept exact ids and unambiguous prefixes.

## Main-Agent Tools

The extension also registers tools for the main agent. These are what make the
feature feel natural: the user can say "stop it" or "tell the scout to inspect
the other repo" without typing slash commands.

| Tool | Purpose |
|---|---|
| `start_subagent` | Starts a preset or task-specialized sub-agent for a bounded task and returns after launch. |
| `stop_subagent` | Stops a running or waiting sub-agent. If exactly one is active, the id can be omitted. |
| `reply_subagent` | Replies to a waiting feedback request. If exactly one sub-agent is waiting, the id can be omitted. |
| `ask_main_session` | Child-only tool that lets a sub-agent ask the main session for a decision, missing path, credential, or preference. |

The main agent can omit `role` and pass ephemeral `instructions` that define a
sub-agent's perspective, scope, and expected output for one run. These
instructions specialize the child without creating a persistent role or
changing its tool permissions, model, or thinking level. Configured roles remain
available as reusable presets.

`start_subagent` is intentionally nonblocking. Natural-language delegation
should feel like starting any other background job: the tool result shows which
sub-agent started, then terminates the launch turn so the main session becomes
idle and the user can stop or reply to the child while it runs. When one or more
tool-started children from the same launch group complete or fail, the package
posts one hidden follow-up report back into the main session and triggers the
main agent to synthesize it for the user. The status widget stays visible while
the child runs, and the full result remains available through
`/subagent view <id>` after completion.

## How It Works

1. The package registers `/subagent`, the main-session tools, the child-only
   `ask_main_session` tool, renderers, and lifecycle handlers in
   [index.ts](index.ts#L875).
2. When a sub-agent starts, the package creates an in-memory record with an id,
   name, cwd, task, optional specialization instructions, status, activity text,
   last activity time, context usage, and optional role.
3. The child session is created with `SessionManager.inMemory(...)`, so subagent
   conversation history is not persisted to disk. The package only persists
   lightweight run metadata needed for reload recovery.
4. On startup, the package reloads recent recoverable metadata for the current
   cwd only. Active records from before reload are shown as `interrupted`; old
   completed/stopped/failed records are not restored into new sessions.
5. The child receives a task-specific system prompt built by
   [resource-loader.ts](resource-loader.ts#L8). That prompt includes the launch
   cwd, assigned task, optional role prompt, optional ephemeral specialization,
   and the rule that the child does not have the parent transcript.
6. The child runs with a narrow tool set. Role tools are loaded from the role
   file, and `ask_main_session` is added automatically.
7. The status widget in [status-widget.ts](status-widget.ts#L117) refreshes
   while work is active and keeps recently completed sub-agents visible for a
   short time. Running records with no activity for a while show a `no recent
   activity` hint.
8. If the child calls `ask_main_session`, the main session receives a feedback
   request and the child waits. The user can answer with `/subagent reply`, or
   the main agent can call `reply_subagent`.
9. On completion, failure, stop, or shutdown, the package records the final
   status, captures the last context usage, cancels pending feedback, and
   disposes the child session.

## Examples

Run a read-only scout:

```text
/subagent start scout Map dotfiles/extensions and summarize the extension
registration patterns.
```

Run a planner before implementation:

```text
/subagent start planner Plan how to split packages/subagents/index.ts into
smaller modules without changing behavior.
```

Review the current diff:

```text
/subagent start reviewer Review the current git diff for correctness,
maintainability, and missing validation.
```

Start a named generic task:

```text
/subagent start docs-pass: Read packages/subagents/README.md and suggest gaps.
```

Inspect status:

```text
/subagent list
/subagent view sa-1
```

Stop or reply manually:

```text
/subagent stop sa-1
/subagent reply sa-1 Use /Users/me/project-a instead; the first cwd was wrong.
```

Let the main agent create task-specific specializations:

```text
Explore the codebase with focused background sub-agents. Choose the useful
specializations and expected output for each instead of assigning every task
the same preset role.
```

Use an explicit preset when its reusable prompt and tool policy fit:

```text
Use a scout subagent to map the package source. Launch it in the background,
then tell me how to inspect or stop it. Do not repeat its work in the main
session.
```

## Development

During local development, install the package from this repo once:

```bash
cd /Users/danielchamorro/Documents/Personal/Code/my-projects/pi-agent-toolkit
pi install ./packages/subagents
```

Then edit files under `packages/subagents`, restart Pi or run `/reload`, and
test `/subagent` again.

For a focused session with only this package loaded:

```bash
pi --no-extensions -e ./packages/subagents
```

For non-interactive smoke tests:

```bash
pi --offline --mode json --no-session --no-extensions \
  -e ./packages/subagents \
  -p "/subagent agents"
```

Recommended validation before committing package changes:

```bash
npm run lint
npm run typecheck:packages
npm run typecheck:dotfiles
npm run check:docs
npm pack --dry-run --workspace @danchamorro/pi-subagents
```

The published package is installed with `pi install npm:@danchamorro/pi-subagents`.
Use the local `./packages/subagents` install only when you are actively
developing this package from a checkout.

## Current Scope

This package is intentionally small and in-process.

- Sub-agent records are process-local and in-memory, with lightweight metadata
  persisted only for same-cwd reload recovery. Frequent activity updates are
  written on a short debounce to keep streaming off the synchronous disk path.
- Full sub-agent conversation history is not persisted across Pi shutdown.
- Sub-agents do not open separate terminal panes or external workers.
- Concurrency is bounded by `subagents.maxConcurrent` (default 5), and idle
  auto-stop (`subagents.idleTimeoutMinutes`) is opt-in. Idle auto-stop applies
  to interactive sessions while the status widget is refreshing.
- Running sub-agents are marked interrupted when the main Pi session shuts down.
- A reload picks up source changes for newly started sub-agents, but it does
  not rewrite the code already executing inside an active child session.
- The package does not try to route sub-agents across arbitrary directories. If
  the cwd is unclear, the child should ask for direction.

These boundaries keep the feature predictable while the package matures.

## Source Layout

| File | Responsibility |
|---|---|
| [index.ts](index.ts#L1) | Extension entrypoint: command/tool registration, runner lifecycle, status widget, concurrency/idle limits, and session cleanup. |
| [agents/](agents/) | Bundled role prompts for planner, scout, reviewer, and worker. |
| [roles.ts](roles.ts#L1) | Built-in/custom role loading, settings overrides and limits, frontmatter validation, and `/subagent start` argument parsing. |
| [record-store.ts](record-store.ts#L1) | In-memory sub-agent record store: id allocation, lookups, recovery loading, and debounced/eager persistence scheduling. |
| [completion-reporter.ts](completion-reporter.ts#L1) | Batches tool-launched completions into one hidden main-session report and captures streaming-aware delivery at launch time. |
| [reload-safe-timer.ts](reload-safe-timer.ts#L1) | Single live status-widget refresh timer that survives Pi hot reloads. |
| [resource-loader.ts](resource-loader.ts#L1) | Builds the child session resources and task-specific system prompt. |
| [persistence.ts](persistence.ts#L1) | Persists lightweight same-cwd recovery metadata and prunes old runs cheaply. |
| [status-widget.ts](status-widget.ts#L1) | Compact below-editor status widget for active and recent sub-agents. |
| [views.ts](views.ts#L1) | `/subagent list`, `/subagent agents`, and `/subagent view` text formatting. |
| [tool-rendering.ts](tool-rendering.ts#L1) | Compact and expanded rendering for main-agent tool calls/results. |
| [schemas.ts](schemas.ts#L1) | TypeBox schemas for `start_subagent`, `stop_subagent`, `reply_subagent`, and `ask_main_session`. |
| [types.ts](types.ts#L1) | Shared types for roles, records, feedback requests, and tool details. |
| [format.ts](format.ts#L1), [paths.ts](paths.ts#L1), [details.ts](details.ts#L1) | Small helpers for names, elapsed time, paths, details, and display text. |
