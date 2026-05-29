# @danchamorro/pi-subagents Changelog

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
