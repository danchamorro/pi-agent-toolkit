---
name: brainstorm
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "brainstorm".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.

## Brainstorm notes

Use a markdown notes file as the durable source of truth for the brainstorm. Long brainstorms are easy to lose track of, so do not rely on chat history alone.

Do not ask the user to choose between Markdown and HTML. Always create or update the Markdown notes file during the brainstorm. At the end, generate a companion visual HTML plan from the finalized Markdown notes.

Before the first question, create or identify the notes file. When working inside a repository, prefer:

```text
plans/brainstorm-<topic>.md
```

Use a short, descriptive, kebab-case topic. Examples:

- `plans/brainstorm-cache-layer.md`
- `plans/brainstorm-migration-design.md`
- `plans/brainstorm-auth-flow.md`

Reserve the matching HTML path for the final visual plan:

```text
plans/brainstorm-<topic>.html
```

If there is no `plans/` directory, create it when appropriate. If the right location is unclear, ask where to save the notes file before continuing.

At the start of the session, tell the user which Markdown file you will update and that you will generate the matching HTML plan when the brainstorm is finalized. If the Markdown file already exists, read it first and resume from its open questions, unresolved decisions, or latest status.

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

Use this structure unless the existing file already has a better one. Treat `Open Questions` and `Operating Assumptions` as temporary working sections only while the brainstorm is still active.

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

Only include questions that are genuinely unresolved right now. Remove or convert each question as soon as it is answered, rejected, or intentionally deferred.

## Operating Assumptions So Far

Only include assumptions that still affect active decisions. Convert assumptions into explicit decisions once confirmed, or remove them once they are no longer relevant.

## Follow-ups
```

Keep the document organized as the brainstorm grows. It is fine to add sections that fit the topic, such as constraints, risks, rejected options, or implementation phases.

## Maintaining open questions and assumptions

Do not let stale questions accumulate. Before adding or asking the next question, check whether prior open questions have been answered by later decisions.

When a question is resolved:

- Remove it from `Open Questions`.
- Record the answer under `Decisions Made`, `Rejected Options`, or `Explicitly Deferred Future Options`, whichever best fits.
- If it creates an implementation task rather than a design uncertainty, move it to `Follow-ups`.

When an assumption is confirmed:

- Convert it into an explicit decision with rationale.
- Remove it from `Operating Assumptions So Far`.

When an assumption is disproven:

- Remove it from assumptions.
- Record the corrected decision or evidence.

A completed brainstorm should not contain stale open questions or broad assumptions. If anything remains unresolved at the end, it must be intentionally parked with a clear reason, owner if known, and the decision it blocks.

## Finalizing a brainstorm for handoff

When the user says the brainstorm is complete, asks to stop, or asks another session to implement the result, rewrite the notes into an implementation-ready handoff. After the Markdown handoff is finalized, generate the matching visual HTML plan from the Markdown file.

The final Markdown handoff should:

- Remove `Open Questions` if all questions were answered.
- Remove `Operating Assumptions So Far` if assumptions were confirmed or no longer needed.
- Keep only genuinely unresolved items in a section such as `Parked Unresolved Decisions`.
- Convert stale questions into decisions, rejected options, explicit future options, or implementation follow-ups.
- Include a concise final stack, architecture, or plan summary near the top.
- Include an implementation order or next steps section when useful.
- Make the file understandable to a new LLM or developer without relying on chat history.

Prefer final Markdown sections such as:

```markdown
## Final Summary

## Implementation Decisions

## Research and Evidence

## Explicitly Deferred Future Options

## Implementation Handoff Order
```

Use `Explicitly Deferred Future Options` for choices that are not open v1 questions but may become relevant later. For example, moving from SQLite to Postgres later is a deferred future option if SQLite was chosen for v1.

## Generating the final visual HTML plan

Generate the HTML file only after the Markdown notes are finalized or intentionally paused for handoff. The Markdown file remains the source of truth. The HTML file is a visual companion that helps the user understand the implementation plan at a glance.

Create a self-contained `.html` file at the reserved matching path. Make it useful when opened locally in a browser:

- Use embedded CSS in the file. Do not rely on external stylesheets, CDNs, images, or scripts unless the user asks.
- Keep the layout readable, responsive, and accessible with semantic headings, descriptive labels, and sufficient contrast.
- Prefer simple visual structures that communicate planning state clearly: phase cards, decision maps, timelines, dependency lists, status badges, risk matrices, and compact architecture diagrams.
- Use lightweight inline SVG, CSS grids, tables, or lists when they make the plan easier to understand.
- Preserve the underlying reasoning from the Markdown notes. A visual plan still needs enough text for another LLM or developer to implement from it.

Include sections like these unless the topic needs a different structure:

```text
Goal and current recommendation
Implementation plan at a glance
Decision map
Architecture or workflow view
Phases and sequencing
Dependencies and blockers
Risks and tradeoffs
Evidence gathered
Parked unresolved decisions
Follow-ups
```

For HTML handoffs, make the final plan visibly implementation-ready. Include a clear summary, phase order, decision map, dependencies, risks, and remaining parked items if any. Do not include stale questions or assumptions that were already resolved in the Markdown notes.

## Resuming long brainstorms

When continuing a prior brainstorm:

1. Read the existing Markdown notes file.
2. Summarize the current decisions and open questions briefly.
3. Ask the next highest-leverage unresolved question.
4. Continue updating the same Markdown file only when decision state changes, following the rules above.

If a matching HTML file already exists, treat it as a generated companion view. Do not use it as the source of truth. Regenerate it from the Markdown notes when the brainstorm is finalized again.

The notes file should make it possible to come back days later and understand what was decided, why it was decided, what remains unresolved, and what question should be asked next.
