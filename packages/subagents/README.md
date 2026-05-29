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
- **Manual and agent-driven control.** Users can type `/subagent ...` commands,
  while the main agent can use `start_subagent`, `stop_subagent`, and
  `reply_subagent` tools on the user's behalf.
- **Feedback handoff.** A sub-agent can pause and ask the main session for a
  decision through `ask_main_session`. The user can answer naturally, and the
  main agent can route that answer back with `reply_subagent`.
- **Scoped working directories.** Sub-agents stay anchored to their launch cwd.
  If a relative path is missing there, the child is instructed to ask for
  direction instead of wandering across unrelated folders.
- **Compact result rendering.** Tool-launched sub-agent output is summarized by
  default and can be expanded, or inspected later with `/subagent view <id>`.

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
Use a scout subagent to map this repo's extension architecture. Do not duplicate
the scout's investigation yourself; synthesize its result.
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

## User Commands

The package registers one slash command namespace: `/subagent`.

| Command | What it does |
|---|---|
| `/subagent` | Shows current sub-agent status. |
| `/subagent help` | Lists available sub-agent commands. |
| `/subagent agents` | Lists bundled roles, tools, model, and thinking settings. |
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
| `start_subagent` | Starts a sub-agent for a bounded task and waits until it completes, fails, or asks for feedback. |
| `stop_subagent` | Stops a running or waiting sub-agent. If exactly one is active, the id can be omitted. |
| `reply_subagent` | Replies to a waiting feedback request. If exactly one sub-agent is waiting, the id can be omitted. |
| `ask_main_session` | Child-only tool that lets a sub-agent ask the main session for a decision, missing path, credential, or preference. |

`start_subagent` intentionally waits for the child handoff. That keeps the main
agent from doing the same investigation in parallel and then dumping duplicate
summaries into the terminal. The tool result is compact by default, with the
full result available through expansion or `/subagent view <id>`.

## How It Works

1. The package registers `/subagent`, the main-session tools, the child-only
   `ask_main_session` tool, renderers, and lifecycle handlers in
   [index.ts](index.ts#L875).
2. When a sub-agent starts, the package creates an in-memory record with an id,
   name, cwd, task, status, activity text, context usage, and optional role.
3. The child session is created with `SessionManager.inMemory(...)`, so subagent
   history is not persisted to disk.
4. The child receives a task-specific system prompt built by
   [resource-loader.ts](resource-loader.ts#L8). That prompt includes the launch
   cwd, assigned task, role prompt, and the rule that the child does not have
   the parent transcript.
5. The child runs with a narrow tool set. Role tools are loaded from the role
   file, and `ask_main_session` is added automatically.
6. The status widget in [status-widget.ts](status-widget.ts#L117) refreshes
   while work is active and keeps recently completed sub-agents visible for a
   short time.
7. If the child calls `ask_main_session`, the main session receives a feedback
   request and the child waits. The user can answer with `/subagent reply`, or
   the main agent can call `reply_subagent`.
8. On completion, failure, stop, or shutdown, the package records the final
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

Let the main agent drive the workflow:

```text
Use a scout subagent to map the package source. If it gets blocked, ask me.
When it finishes, summarize the scout's result and do not repeat its work.
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

- Sub-agent records are process-local and in-memory.
- Sub-agent history is not persisted across Pi shutdown.
- Sub-agents do not open separate terminal panes or external workers.
- Running sub-agents are stopped when the main Pi session shuts down.
- A reload picks up source changes for newly started sub-agents, but it does
  not rewrite the code already executing inside an active child session.
- The package does not try to route sub-agents across arbitrary directories. If
  the cwd is unclear, the child should ask for direction.

These boundaries keep the feature predictable while the package matures.

## Source Layout

| File | Responsibility |
|---|---|
| [index.ts](index.ts#L1) | Extension entrypoint, command/tool registration, sub-agent records, runner lifecycle, and session cleanup. |
| [agents/](agents/) | Bundled role prompts for planner, scout, reviewer, and worker. |
| [roles.ts](roles.ts#L1) | Role prompt loading, frontmatter validation, and `/subagent start` argument parsing. |
| [resource-loader.ts](resource-loader.ts#L1) | Builds the child session resources and task-specific system prompt. |
| [status-widget.ts](status-widget.ts#L1) | Compact below-editor status widget for active and recent sub-agents. |
| [views.ts](views.ts#L1) | `/subagent list`, `/subagent agents`, and `/subagent view` text formatting. |
| [tool-rendering.ts](tool-rendering.ts#L1) | Compact and expanded rendering for main-agent tool calls/results. |
| [schemas.ts](schemas.ts#L1) | TypeBox schemas for `start_subagent`, `stop_subagent`, `reply_subagent`, and `ask_main_session`. |
| [types.ts](types.ts#L1) | Shared types for roles, records, feedback requests, and tool details. |
| [format.ts](format.ts#L1), [paths.ts](paths.ts#L1), [details.ts](details.ts#L1) | Small helpers for names, elapsed time, paths, details, and display text. |
