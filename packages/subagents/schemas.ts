import { Type } from "typebox";

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
