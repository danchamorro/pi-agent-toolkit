import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const PREFERRED_JSON_SCHEMA_SAMPLING = {
  type: "json_schema",
  strict: "prefer",
} as const;

export const AskMainSessionParams = Type.Object({
  question: Type.String({
    description: "The specific question or decision needed from the main session.",
  }),
  context: Type.Optional(
    Type.String({
      description: "Brief context explaining why the sub-agent is blocked.",
    }),
  ),
});

const HarnessSchema = StringEnum(["pi", "claude", "codex"] as const, {
  description: "Native agent harness. Defaults to pi.",
});
const ReasoningEffortSchema = StringEnum(
  ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const,
  { description: "Optional reasoning effort override for the selected harness." },
);

export const StartSubagentParams = Type.Object({
  role: Type.Optional(
    Type.String({
      description:
        "Optional sub-agent role name. Use /subagent agents to list bundled and custom roles.",
    }),
  ),
  task: Type.String({
    description: "The concrete task the sub-agent should work on.",
  }),
  instructions: Type.Optional(
    Type.String({
      description:
        "Optional ephemeral specialization for this run. Use this to define the sub-agent's focus and expected output without creating a persistent role.",
    }),
  ),
  name: Type.Optional(
    Type.String({
      description: "Optional display name. Defaults to the role name or a task-derived name.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Optional working directory for the sub-agent. Use only when the target repo/folder is explicit or already verified.",
    }),
  ),
  harness: Type.Optional(HarnessSchema),
  model: Type.Optional(
    Type.String({ description: "Optional native model override for the selected harness." }),
  ),
  reasoning_effort: Type.Optional(ReasoningEffortSchema),
});

export const StopSubagentParams = Type.Object({
  id: Type.Optional(
    Type.String({
      description:
        "Sub-agent id or id prefix to stop. Omit only when exactly one sub-agent is active or waiting for feedback.",
    }),
  ),
  reason: Type.Optional(
    Type.String({
      description: "Optional reason to record when stopping the sub-agent.",
    }),
  ),
});

export const ReplySubagentParams = Type.Object({
  id: Type.Optional(
    Type.String({
      description:
        "Sub-agent id or id prefix to reply to. Omit only when exactly one sub-agent is waiting for feedback.",
    }),
  ),
  feedback: Type.String({
    description: "Feedback or instruction to send to the waiting sub-agent.",
  }),
});
