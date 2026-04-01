# Changelog

All notable changes to `pi-agent-toolkit` will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [Semantic Versioning](https://semver.org/).

## [0.5.7] - 2026-04-01

### Added

- Bundled `1password-developer` skill for 1Password SSH agent, Environments,
  and op CLI workflows.

## [0.5.6] - 2026-03-29

### Fixed

- Migrated btw overlay keybinding from legacy `selectCancel` to namespaced
  `tui.select.cancel`, fixing broken cancel/dismiss on Pi 0.61.0+. Falls
  back to the legacy id for backward compatibility.
- Fixed pre-existing type mismatch in btw session context seeding.

### Added

- Unit tests for btw dismiss key matching logic.

## [0.5.5] - 2026-03-29

### Changed

- Normalized repository URL in package.json.
- Aligned published package documentation across all packages.

## [0.5.4] - 2026-03-29

### Fixed

- Fixed documentation inconsistencies across the repo.

## [0.5.3] - 2026-03-29

### Fixed

- Template configs (auth.json, mcp.json) are now always copied, never
  symlinked, so machine-specific secrets stay local even in link mode.

### Changed

- Renamed manifest file from `.pi-toolkit.json` to `.pi-agent-toolkit.json`.
- Added README for the npm package page.

## [0.5.1] - 2026-03-29

### Fixed

- Status command now detects installed components via filesystem scan
  instead of relying solely on the manifest.

### Changed

- Renamed from `pi-toolkit` to `pi-agent-toolkit` across the repo and CLI.

## [0.5.0] - 2026-03-29

### Added

- `pi-agent-toolkit update` command for self-updating the CLI.
- Added code-review skill to the component registry.

### Fixed

- Added control hints to the interactive multiselect prompts.

## [0.3.0] - 2026-03-28

### Added

- Prompts, agents, and themes as installable component categories.
- Select-all option in the interactive picker.

## [0.2.0] - 2026-03-28

### Added

- `pi-agent-toolkit sync` command to absorb unmanaged extensions, skills,
  prompts, agents, and themes back into the repo.

## [0.1.0] - 2026-03-28

### Added

- Initial release. Interactive CLI for selective installation of extensions,
  skills, configs, and MCP server configurations.
