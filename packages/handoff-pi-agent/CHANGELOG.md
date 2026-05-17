# Changelog

All notable changes to `@danchamorro/pi-handoff-agent` will be documented in this file.

## [0.1.0] - 2026-05-17

### Added

- Add `/handoff-export` for exporting the active Pi session branch to `.handoffs/`.
- Generate canonical `handoff.json` artifacts and human-readable `handoff.md` companions.
- Strip tool calls, tool results, thinking blocks, and known non-transcript Pi session events.
- Add `.gitignore` protection for handoff artifacts to reduce accidental commits of private context.
- Include package-local schema, format references, CLI support for explicit snapshots, and regression tests.
