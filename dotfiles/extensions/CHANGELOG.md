# Extensions Changelog

All notable changes to extensions in `~/.pi/agent/extensions/`.

## 2026-03-29

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
