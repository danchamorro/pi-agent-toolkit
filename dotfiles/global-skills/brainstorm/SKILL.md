---
name: brainstorm
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "brainstorm".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Brainstorm notes

Use a markdown notes file as the durable source of truth for the brainstorm. Long brainstorms are easy to lose track of, so do not rely on chat history alone.

Before the first question, create or identify the notes file. When working inside a repository, prefer:

```text
plans/brainstorm-<topic>.md
```

Use a short, descriptive, kebab-case topic. Examples:

- `plans/brainstorm-cache-layer.md`
- `plans/brainstorm-migration-design.md`
- `plans/brainstorm-auth-flow.md`

If there is no `plans/` directory, create it when appropriate. If the right location is unclear, ask where to save the notes file before continuing.

At the start of the session, tell the user which file you will update. If the file already exists, read it first and resume from its open questions, unresolved decisions, or latest status.

## Update the notes after each answer

After the user answers a question, update the notes file before asking another question. Capture the result as useful design notes, not as a raw transcript.

Each update should record:

- The decision, recommendation, or open question that came out of the answer.
- Why that direction was chosen.
- Whether the decision is final, draft, recommended, or unresolved.
- Any evidence gathered from code, docs, commands, or prior notes.
- Follow-up questions created by the answer.

If the user is unsure, record the current recommendation and mark the status as draft or unresolved. If a branch is parked, add it to open questions instead of dropping it.

## Suggested notes structure

Use this structure unless the existing file already has a better one:

```markdown
# <Topic> Brainstorm Notes

## Goal

## Working Vision

## Decisions Made

### 1. <Decision area>

Decision:
- ...

Why:
- ...

Status:
- Final | Draft | Recommended | Unresolved

## Evidence Gathered

## Open Questions

## Operating Assumptions So Far

## Follow-ups
```

Keep the document organized as the brainstorm grows. It is fine to add sections that fit the topic, such as constraints, risks, rejected options, or implementation phases.

## Resuming long brainstorms

When continuing a prior brainstorm:

1. Read the existing notes file.
2. Summarize the current decisions and open questions briefly.
3. Ask the next highest-leverage unresolved question.
4. Continue updating the same file after every answer.

The notes file should make it possible to come back days later and understand what was decided, why it was decided, what remains unresolved, and what question should be asked next.
