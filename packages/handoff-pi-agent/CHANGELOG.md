# Changelog

All notable changes to `@danchamorro/pi-handoff-agent` will be documented in this file.

## [Unreleased]

## [0.1.1] - 2026-05-17

### Fixed

- Omit Pi extension state entries such as `custom` and `label` from exports without warning noise.
- Add regression coverage for compacted sessions so raw pre-compact transcript text is preserved while compaction summaries remain marked as context.

### Changed

- Expand documentation to explain portable continuity, receiving workflows, privacy protections, and why the export must be extension-backed.

## [0.1.0] - 2026-05-17

### Added

- Add `/handoff-export` for exporting the active Pi session branch to `.handoffs/`.
- Generate canonical `handoff.json` artifacts and human-readable `handoff.md` companions.
- Strip tool calls, tool results, thinking blocks, and known non-transcript Pi session events.
- Add `.gitignore` protection for handoff artifacts to reduce accidental commits of private context.
- Include package-local schema, format references, CLI support for explicit snapshots, and regression tests.
