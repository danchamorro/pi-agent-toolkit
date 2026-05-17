# @danchamorro/pi-handoff-agent

Pi extension package for exporting the current active session branch as clean handoff artifacts.

## Command

```text
/handoff-export
```

The command writes:

```text
.handoffs/<timestamp-pi-agent>/handoff.json
.handoffs/<timestamp-pi-agent>/handoff.md
```

`handoff.json` is canonical for receiving agents. `handoff.md` is generated from the JSON for human review.

## Privacy and gitignore behavior

Handoffs may contain private prompts, code snippets, local paths, and business context. The exporter appends `.handoffs/` to an existing `.gitignore`. If no `.gitignore` exists, it fails safely rather than silently creating one.

## Development note

This package includes a package-local copy of the shared implementation under `shared/handoff/` so the npm tarball is self-contained. Keep those files synchronized with the repo-level canonical source in `shared/handoff/` before publishing.

## CLI for explicit snapshots

```bash
node packages/handoff-pi-agent/scripts/extract-handoff.ts \
  --input shared/handoff/fixtures/simple-transcript.json \
  --cwd "$PWD" \
  --out .handoffs/cli-test \
  --add-gitignore=false
```

Current-session export is only supported through the Pi extension context.
