# @danchamorro/pi-subagents Changelog

## 0.1.0

- Staged the subagents extension as an installable Pi package source.
- Included the bundled planner, reviewer, scout, and worker role prompts.
- Declared `./index.ts` as the Pi extension entry point.
- Moved the repo setup to install this local package source through
  `manifest.json` instead of loading a duplicate dotfiles extension.
- Split package-local helpers into modules for constants, details, formatting,
  paths, resource loading, role loading, schemas, status widget rendering, tool
  rendering, types, and slash-command views.
