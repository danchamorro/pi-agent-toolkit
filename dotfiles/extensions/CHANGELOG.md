# Extensions Changelog

All notable changes to extensions in `~/.pi/agent/extensions/`.

## 2026-03-31

### commit-approval.ts

- Added staged-file previews to the commit approval dialog so approvals show
  what is about to be committed, not just the message.
- Added warnings when staged files still match gitignore rules, which helps
  surface files that were likely staged with `git add -f` or `git add --force`.

### damage-control

- Blocked `git add -f` and `git add --force` in the shared damage-control
  rules so ignored files cannot be force-staged accidentally.
- Blocked `git add` commands that override `core.excludesFile`, such as
  `git -c core.excludesFile=/dev/null add ...`, to prevent bypassing global
  gitignore rules without editing ignore files.

## 2026-03-29

### qna-interactive.ts

- Documented `Ctrl+.` shortcut key in the file header comment.

### files.ts

- Documented `Ctrl+Shift+O`, `Ctrl+Shift+F`, and `Ctrl+Shift+R` shortcut
  keys in the file header comment.

### btw.ts

- Added `Ctrl+Shift+B` keyboard shortcut to open the BTW side chat overlay
  mid-typing without clearing or submitting the current message draft.
- Widened `createSideSession`, `ensureSideSession`, `runBtwPrompt`, and
  `submitFromOverlay` from `ExtensionCommandContext` to `ExtensionContext`
  so the overlay works from both shortcut and command contexts.
- Removed the `waitForIdle` duck-type guard in `submitFromOverlay` (the side
  session runs independently and never needed command-context methods).
- Removed unused `ExtensionCommandContext` import and simplified five
  redundant union types to plain `ExtensionContext`.
- Simplified `extractEventAssistantText` filter predicate to use optional
  chaining instead of a verbose three-line type guard.
- Removed unnecessary destructure in `getModelKey`.
