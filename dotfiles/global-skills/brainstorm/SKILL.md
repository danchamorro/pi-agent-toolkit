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

## Update the notes only when decision state changes

Do not update the notes file after every user response. Discussion, clarification, and explanation should usually stay in chat until they change the durable design state.

Update the notes file only when one of these happens:

- The user makes, confirms, or rejects a decision.
- The user explicitly parks a question as unresolved.
- The user asks to record something in the notes.
- Codebase, documentation, command output, or prior-note evidence materially changes the recommendation.
- A new open question is discovered that must be tracked before moving on.

Do not update the notes file for:

- Clarifying questions.
- The user saying they do not understand.
- Explanations of the current question.
- Back-and-forth discussion that does not change a decision.
- Restating the agent's recommendation.
- Minor wording or framing adjustments.

Before writing, identify the decision-state change in chat. If there is no decision-state change, continue the conversation without editing the notes.

When the user is unsure, do not automatically write the current recommendation to the notes. Keep discussing until the user accepts the recommendation, rejects it, or explicitly asks to park the question as unresolved.

After consensus is reached, or the user explicitly parks the question, update the notes file before moving to the next unresolved decision. Capture the result as useful design notes, not as a raw transcript.

Each update should record:

- The decision, rejected option, parked question, or material evidence that changed the design state.
- Why that direction was chosen or why the question remains unresolved.
- Whether the decision is final, draft, recommended, or unresolved.
- Any evidence gathered from code, docs, commands, or prior notes.
- Follow-up questions created by the decision or parked question.

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
4. Continue updating the same file only when decision state changes, following the rules above.

The notes file should make it possible to come back days later and understand what was decided, why it was decided, what remains unresolved, and what question should be asked next.
