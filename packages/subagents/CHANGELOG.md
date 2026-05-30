# @danchamorro/pi-subagents Changelog

## 0.4.0 - 2026-05-30

### Added

- Added guided role discovery output for `/subagent agents`, including workflow
  ordering, role-specific guidance, grouped capability badges, and quick start
  and detail commands.
- Added `/subagent view <role>` support so exact role tools, source details,
  model, and thinking configuration stay available outside the default role
  list.
- Added targeted view tests covering role discovery, role details, and
  feedback-first status output.

### Changed

- Reworked sub-agent status output to prioritize feedback requests before
  running and recent sub-agents, making user action requirements easier to
  spot.
- Applied Pi theme styling to sub-agent role, status, command, and capability
  output while preserving plain-text fallbacks for tests and non-themed
  contexts.

## 0.3.0 - 2026-05-29

### Changed

- Hidden tool-launched completion reports now use Pi's streaming-aware input
  signal to avoid jumping ahead of a user follow-up queued during streaming.
- Sub-agent system prompts now include prompt guidelines for their enabled
  inherited tools using Pi's `getAllTools()` metadata.

## 0.2.1 - 2026-05-29

### Fixed

- Tool-launched sub-agents now report completion or failure back into the main
  session as one hidden follow-up bundle, so the main agent can relay results
  without competing with raw per-agent summaries or silently requiring manual
  `/subagent view` inspection.
- `start_subagent` now terminates the launch turn after the background records
  start, keeping the main session idle and interruptible while sub-agents run
  instead of letting the main agent continue its own duplicate investigation.

## 0.2.0 - 2026-05-29

### Added

- Added custom role discovery from the Pi agent directory's `agents/*.md`
  files, so users can add external sub-agent prompts without editing the
  package.
- Added `settings.json` role overrides for per-role model, thinking, and tool
  settings.
- Added role loader tests covering custom roles, settings overrides, duplicate
  role names, and invalid override diagnostics.

### Changed

- Updated `/subagent agents` output to show whether each role is built-in,
  custom, or settings-overridden.
- Restored `start_subagent` to return immediately after launch so
  natural-language sub-agent delegation stays interruptible.
- Custom role discovery now follows symlinked Markdown files, matching
  repo-managed link-mode setups.
- Custom roles with names that conflict with existing roles are skipped with an
  explicit warning instead of silently replacing bundled behavior.

## 0.1.0 - 2026-05-29

### Added

- Added the initial `@danchamorro/pi-subagents` package for running fresh
  in-process Pi sub-agents from the main session.
- Added bundled `planner`, `reviewer`, `scout`, and `worker` role prompts with
  role-specific model, thinking, tool, and output metadata.
- Added `/subagent` commands for listing roles, starting agents, inspecting
  status, stopping agents, and replying to feedback requests.
- Added main-agent tools for starting, stopping, and replying to sub-agents on
  the user's behalf.
- Added a compact status widget for active and recently finished sub-agents.
- Added README documentation for installation, usage, role metadata, command
  examples, development, and the current MVP scope.
