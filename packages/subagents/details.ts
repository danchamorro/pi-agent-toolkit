import { elapsedFor } from "./format.ts";
import type { StartSubagentDetails, SubagentControlDetails, SubagentRecord } from "./types.ts";

export function detailsForRecord(record: SubagentRecord): StartSubagentDetails {
  return {
    status: record.status,
    subagentId: record.id,
    name: record.name,
    role: record.role?.name,
    harness: record.harness,
    resolvedModel: record.resolvedModel,
    nativeRuntimeVersion: record.nativeRuntimeVersion,
    toolPolicy: record.toolPolicy,
    toolPolicyDiagnostic: record.externalDiagnostics?.find((message) =>
      message.includes("native runs use broad tool authority"),
    ),
    cwd: record.cwd,
    task: record.task,
    command: `/subagent view ${record.id}`,
    activity: record.activity,
    elapsed: elapsedFor(record),
    result: record.result,
    error: record.error,
  };
}

export function detailsForControl(
  action: SubagentControlDetails["action"],
  status: SubagentControlDetails["status"],
  record: SubagentRecord | undefined,
  message: string | undefined,
  error?: string,
): SubagentControlDetails {
  return {
    action,
    status,
    subagentId: record?.id,
    name: record?.name,
    cwd: record?.cwd,
    subagentStatus: record?.status,
    activity: record?.activity,
    elapsed: record ? elapsedFor(record) : undefined,
    message,
    error,
  };
}
