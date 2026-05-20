---
name: code-structure-cleanup
description: Use when a working feature has duplicated mechanics, repeated API calls, inconsistent parsing or validation, messy helpers, or structure that will make review or future agent work harder.
---

# Code Structure Cleanup

## Overview

Run this after a feature works, before review. The goal is a behavior-preserving cleanup pass that reduces duplicated runtime mechanics and makes the changed area easier for humans and agents to understand.

This is not a redesign pass. Keep the scope tied to the feature and keep the diff small.

## When to Use

Use when:

- A feature works locally but the code feels duplicated, messy, or hard to review.
- Similar helper functions, API calls, parsing, validation, or transformations were added in multiple places.
- Calling files contain mechanics that would be clearer behind a reusable module.
- Future agents are likely to copy the messy pattern because it is now the easiest thing to find.

Do not use when:

- The feature does not work yet.
- The requested change is a new feature, not cleanup.
- The only issue is formatting.
- The cleanup would require redesigning unrelated parts of the app.

## Core Rule

This is a behavior-preserving cleanup pass.

Do not add features, change UX, alter API contracts, change data shapes, move business decisions, or modify user-facing behavior. If preserving behavior is uncertain, stop and investigate before editing.

## Service Layer Boundary

A service layer is a place for reusable mechanics:

- sending an email,
- streaming an AI response,
- creating a sandbox,
- validating a webhook,
- calling an external API,
- transforming a payload,
- parsing or normalizing data.

The route, action, component, command, or job decides **what** should happen. The service handles **how** it happens.

Services should not decide permissions, pricing, workflow branching, feature flags, product policy, or user-facing business rules unless the existing architecture already puts that policy in a service.

## Cleanup Process

Before editing, identify the duplication inventory:

- repeated mechanic,
- files involved,
- proposed extraction,
- why this extraction is smaller and clearer than leaving the duplication,
- validation command that will prove behavior was preserved.

Then:

1. Inspect only the feature-touched area plus directly related shared modules.
2. Name the repeated mechanic clearly.
3. Extract the smallest reusable function or module that removes the repetition.
4. Keep domain policy in the caller.
5. Update callers without renaming unrelated concepts.
6. Run the narrowest relevant tests, typecheck, lint, or build.
7. Summarize exactly what got simpler.

## Extraction Test

Do not extract code just because two snippets look similar. Extract only when the repeated logic represents the same runtime mechanic and has the same reason to change.

Good extraction:

- Four routes each build and send the same email payload with minor drift. Create one email service and keep each route's decision to send the email in the route.

Bad extraction:

- Two flows both check `status === "active"`, but one is billing policy and the other is UI display logic. The snippets look similar, but they do not have the same reason to change.

## Common Pitfalls

| Pitfall | Correction |
|---|---|
| Refactoring the whole app | Stay inside the feature area. |
| Renaming everything | Avoid naming churn unless a name blocks understanding. |
| Mixing cleanup with new behavior | Make cleanup a separate pass. |
| Only formatting code | Reduce duplicated mechanics, not just whitespace. |
| Moving policy into services | Keep business decisions in the caller unless the existing architecture says otherwise. |
| Creating a vague abstraction | Prefer a concrete, searchable service name tied to the mechanic. |

## Final Response Format

Report:

- Repeated mechanics removed:
- New or changed service modules:
- Calling files simplified:
- Behavior-preservation evidence:
- Validation run:
- Risks or follow-up:

If no safe extraction exists, say so and explain why duplication is preferable for now.

## Verification Checklist

- [ ] User-facing behavior stayed the same.
- [ ] Repeated mechanics were actually reduced.
- [ ] Calling files became simpler.
- [ ] Domain policy stayed in the caller.
- [ ] The diff stayed focused on the feature area.
- [ ] Relevant tests, typechecks, linters, or builds ran.
- [ ] Missing test coverage or residual risk was reported clearly.
