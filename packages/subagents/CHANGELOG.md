# @danchamorro/pi-subagents Changelog

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
