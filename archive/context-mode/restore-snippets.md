# Context-mode restore snippets

Context-mode was disabled from the active Pi toolkit setup but kept here for a
possible future restore.

Upstream repository: https://github.com/mksglu/context-mode
Installed live package version observed: `context-mode@1.0.168`

## Restore package

Add this package back to live Pi settings or reinstall with Pi:

```json
"npm:context-mode"
```

Likely install command:

```bash
pi install npm:context-mode
```

## Restore guard extension

Move this file back into the active extensions directory:

```bash
cp archive/context-mode/ctx-approval-gate.ts dotfiles/extensions/ctx-approval-gate.ts
npm run dev:sync
```

## Upstream uninstall check

The upstream `context-mode` CLI exposes `doctor`, `upgrade`, `hook`, `index`,
`search`, `insight`, and `statusline`. It does not expose a dedicated
`uninstall` command in `src/cli.ts` at the fetched main branch or in the
installed `context-mode@1.0.168` package.
