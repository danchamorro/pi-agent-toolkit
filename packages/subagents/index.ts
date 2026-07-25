/**
 * Subagents Extension
 *
 * Commands:
 * - /subagent start <task> - start a background sub-agent.
 * - /subagent start <role> <task> - start a role-specific background sub-agent.
 * - /subagent agents - list bundled and custom sub-agent roles.
 * - /subagent list - show known sub-agents.
 * - /subagent view [id|role] - show sub-agent run or role details.
 * - /subagent stop <id> - stop a running sub-agent.
 * - /subagent reply <id> <feedback> - answer a sub-agent feedback request.
 *
 * Tools:
 * - start_subagent - let the main agent launch a preset or task-specialized background sub-agent.
 *   The tool returns after launch and can target an explicit working directory.
 * - stop_subagent - let the main agent stop a running or waiting sub-agent.
 * - reply_subagent - let the main agent answer a sub-agent feedback request.
 *
 * Shortcut: none.
 *
 * Runs sub-agents in fresh in-process Pi sessions by default, or optionally as
 * fully interactive isolated Pi sessions in one parent-owned Herdr session. On
 * cmux, one helper surface hosts the Herdr client while all children live in
 * Herdr tabs. Children do not inherit the main conversation transcript, can ask the parent for
 * feedback, use bundled or custom roles, and report through one compact status
 * widget and grouped completion path. Concurrency and idle auto-stop remain
 * shared across both backends.
 */

import {
  createAgentSession,
  SessionManager,
  type AgentSessionEvent,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type InputEvent,
  type ToolCallEvent,
  type ToolCallEventResult,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type Api, type Model } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { CmuxHerdrHostController, detectCmuxEnvironment } from "./cmux.ts";
import { HerdrSessionController } from "./herdr.ts";
import { runHerdrSubagent, type HerdrTerminalResult } from "./herdr-runner.ts";
import { CompletionReporter } from "./completion-reporter.ts";
import { writeHerdrFeedbackResponse, writeHerdrStopControl } from "./herdr-controls.ts";
import { FEEDBACK_MESSAGE_TYPE, SUBAGENT_MESSAGE_TYPE, SUBAGENT_TOOL_NAMES } from "./constants.ts";
import { detailsForControl, detailsForRecord } from "./details.ts";
import {
  deriveName,
  elapsedFor,
  extractEventAssistantText,
  extractText,
  getLastAssistantMessage,
  singleLine,
  splitCommand,
} from "./format.ts";
import { createSubagentLaunchConfig, type SubagentLaunchConfig } from "./launch-config.ts";
import { formatPathForDisplay, resolveSubagentCwd } from "./paths.ts";
import { SubagentStore } from "./record-store.ts";
import { ReloadSafeTimer } from "./reload-safe-timer.ts";
import {
  buildSubagentSystemPrompt,
  createSubagentResourceLoader,
  formatToolPromptGuidelines,
} from "./resource-loader.ts";
import { loadSubagentRoles, parseStartArgs } from "./roles.ts";
import {
  AskMainSessionParams,
  ReplySubagentParams,
  StartSubagentParams,
  StopSubagentParams,
} from "./schemas.ts";
import {
  formatControlExpanded,
  formatControlSummary,
  formatReplySubagentCall,
  formatStartSubagentCall,
  formatStartSubagentExpanded,
  formatStartSubagentSummary,
  formatStopSubagentCall,
} from "./tool-rendering.ts";
import {
  formatRecordDetails,
  formatRoleDetails,
  formatRoleDiagnostics,
  formatRoleList,
  formatSubagentList,
} from "./views.ts";
import type {
  FeedbackRequest,
  FeedbackRequestDetails,
  ParsedStartArgs,
  SessionThinkingLevel,
  StartSubagentDetails,
  StatusMessageOptions,
  SubagentControlDetails,
  SubagentRecord,
  SubagentRole,
} from "./types.ts";
import {
  SubagentStatusWidget,
  isActiveStatus,
  isFinishedStatus,
  isWorkingStatus,
} from "./status-widget.ts";

const MIN_WIDGET_UPDATE_MS = 1_000;
const MAX_WIDGET_UPDATE_MS = 4_000;
const HERDR_GRACEFUL_STOP_TIMEOUT_MS = 5_000;
const WIDGET_TIMER_KEY = Symbol.for("pi-agent-toolkit/subagents-widget-interval");

function randomWidgetUpdateDelayMs(): number {
  return (
    MIN_WIDGET_UPDATE_MS +
    Math.floor(Math.random() * (MAX_WIDGET_UPDATE_MS - MIN_WIDGET_UPDATE_MS + 1))
  );
}

function updateRecordContextUsage(record: SubagentRecord): void {
  if (record.session) {
    record.contextUsage = record.session.getContextUsage();
  }
}

function messageFromUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function disposeSubagentSession(record: SubagentRecord): void {
  record.unsubscribe?.();
  record.unsubscribe = undefined;
  record.session?.dispose();
  record.session = undefined;
}

export function resolveSubagentTools(
  activeTools: readonly string[],
  roleTools?: readonly string[],
): string[] {
  const activeSubagentTools = new Set(
    activeTools.filter((toolName) => SUBAGENT_TOOL_NAMES.has(toolName)),
  );
  const requestedTools = roleTools ?? [...activeSubagentTools];
  return [
    ...new Set([
      ...requestedTools.filter((toolName) => activeSubagentTools.has(toolName)),
      "ask_main_session",
    ]),
  ];
}

export function shouldCloseIdleHerdrRuntime(
  records: Iterable<Pick<SubagentRecord, "backend" | "status">>,
): boolean {
  return ![...records].some(
    (record) => record.backend === "herdr" && !isFinishedStatus(record.status),
  );
}

export default function (pi: ExtensionAPI) {
  const roleRegistry = loadSubagentRoles();
  const roles = roleRegistry.roles;
  const roleDiagnostics = roleRegistry.diagnostics;
  const limits = roleRegistry.limits;
  const openInHerdr = roleRegistry.openInHerdr;
  const rolesByName = new Map(roles.map((role) => [role.name.toLowerCase(), role]));
  const store = new SubagentStore(rolesByName);

  let latestCtx: ExtensionContext | undefined;
  let latestInputStreamingBehavior: InputEvent["streamingBehavior"];
  let herdrController: HerdrSessionController | undefined;
  let cmuxHostController: CmuxHerdrHostController | undefined;
  let herdrCleanupPromise: Promise<void> | undefined;
  let attachCommandAnnounced = false;
  let startSubagentCalledThisTurn = false;
  let nonSubagentToolCalledThisTurn = false;

  const widgetTimer = new ReloadSafeTimer(WIDGET_TIMER_KEY);
  const reporter = new CompletionReporter({
    getRecord: (id) => store.get(id),
    allRecords: () => store.values(),
    post: (content, options) => postStatusMessage(content, options),
    getStreamingBehavior: () => latestInputStreamingBehavior,
  });

  function detachHerdrRuntime(): {
    controller: HerdrSessionController | undefined;
    host: CmuxHerdrHostController | undefined;
  } {
    const runtime = {
      controller: herdrController,
      host: cmuxHostController,
    };
    herdrController = undefined;
    cmuxHostController = undefined;
    attachCommandAnnounced = false;
    return runtime;
  }

  function addExternalDiagnostic(record: SubagentRecord, message: string): void {
    record.externalDiagnostics ??= [];
    if (record.externalDiagnostics.length < 20) {
      record.externalDiagnostics.push(message.slice(0, 1_024));
    }
  }

  function beginParentSession(ctx: ExtensionContext): void {
    if (!store.beginParentSession(ctx.sessionManager.getSessionId())) {
      return;
    }
    reporter.reset();
    const previousHerdr = detachHerdrRuntime();
    try {
      previousHerdr.host?.closeHost();
    } catch (error) {
      postStatusMessage(
        `Could not close the previous Herdr host: ${messageFromUnknownError(error)}`,
      );
    }
    if (previousHerdr.controller) {
      const trackedCleanup = previousHerdr.controller
        .stopAndDelete()
        .catch((error: unknown) => {
          postStatusMessage(
            `Could not stop the previous owned Herdr session: ${messageFromUnknownError(error)}`,
          );
        })
        .finally(() => {
          if (herdrCleanupPromise === trackedCleanup) {
            herdrCleanupPromise = undefined;
          }
        });
      herdrCleanupPromise = trackedCleanup;
    }
  }

  function cleanupHerdrRuntimeIfIdle(record?: SubagentRecord): Promise<void> | undefined {
    if (
      herdrCleanupPromise ||
      (!herdrController && !cmuxHostController) ||
      !shouldCloseIdleHerdrRuntime(store.values())
    ) {
      return herdrCleanupPromise;
    }

    const ownedHerdr = detachHerdrRuntime();

    try {
      ownedHerdr.host?.closeHost();
    } catch (error) {
      const message = `Could not close the idle Herdr host: ${messageFromUnknownError(error)}`;
      if (record) {
        addExternalDiagnostic(record, message);
      }
      postStatusMessage(message);
    }

    const cleanup = ownedHerdr.controller?.stopAndDelete() ?? Promise.resolve();
    const trackedCleanup = cleanup
      .catch((error: unknown) => {
        const message = `Could not stop the idle owned Herdr session: ${messageFromUnknownError(error)}`;
        if (record) {
          addExternalDiagnostic(record, message);
        }
        postStatusMessage(message);
      })
      .finally(() => {
        if (herdrCleanupPromise === trackedCleanup) {
          herdrCleanupPromise = undefined;
        }
      });
    herdrCleanupPromise = trackedCleanup;
    return trackedCleanup;
  }

  function markActivity(record: SubagentRecord, activity: string): void {
    record.activity = singleLine(activity);
    record.lastActivityAt = Date.now();
    updateRecordContextUsage(record);
    store.scheduleActivityPersist(record);
  }

  function availableRoleNames(): string[] {
    return roles.map((role) => role.name);
  }

  function scheduleStatusWidgetUpdate(): void {
    widgetTimer.schedule(() => {
      reapIdleSubagents();
      updateStatusWidget();
    }, randomWidgetUpdateDelayMs());
  }

  function reapIdleSubagents(now = Date.now()): void {
    if (limits.idleTimeoutMs <= 0) {
      return;
    }
    const minutes = Math.max(1, Math.round(limits.idleTimeoutMs / 60_000));
    for (const record of store.values()) {
      // Only reap actively working sub-agents. Ones waiting for feedback are
      // intentionally idle until the user answers and must not be stopped.
      if (isWorkingStatus(record.status) && now - record.lastActivityAt >= limits.idleTimeoutMs) {
        void stopSubagentRecord(
          record,
          `Stopped automatically after ${minutes}m without activity.`,
        );
      }
    }
  }

  function concurrencyLimitMessage(): string | undefined {
    const activeCount = store.active().length;
    if (activeCount < limits.maxConcurrent) {
      return undefined;
    }
    return `Sub-agent concurrency limit reached (${activeCount}/${limits.maxConcurrent} active). Stop one with stop_subagent or raise subagents.maxConcurrent in settings.json.`;
  }

  function updateStatusWidget(ctx = latestCtx): void {
    if (!ctx?.hasUI) {
      return;
    }

    const visibleRecords = store.visibleInWidget();
    const active = visibleRecords.filter((record) => isActiveStatus(record.status));
    const waiting = active.filter((record) => record.status === "waiting for feedback");

    if (visibleRecords.length === 0) {
      ctx.ui.setWidget("subagents", undefined);
      ctx.ui.setStatus("subagents", undefined);
      widgetTimer.clear();
      return;
    }

    const statusLabel = waiting.length > 0 ? `SA:${active.length} wait` : `SA:${active.length}`;
    ctx.ui.setStatus(
      "subagents",
      waiting.length > 0
        ? ctx.ui.theme.fg("warning", statusLabel)
        : ctx.ui.theme.fg("accent", statusLabel),
    );
    ctx.ui.setWidget(
      "subagents",
      (_tui, theme) =>
        new SubagentStatusWidget(() => store.sorted(), theme, {
          elapsedFor,
          formatPathForDisplay,
        }),
      {
        placement: "belowEditor",
      },
    );

    scheduleStatusWidgetUpdate();
  }

  function postStatusMessage(content: string, options?: StatusMessageOptions): void {
    const { display = true, ...deliveryOptions } = options ?? {};
    pi.sendMessage(
      {
        customType: SUBAGENT_MESSAGE_TYPE,
        content,
        display,
      },
      options ? deliveryOptions : { triggerTurn: false },
    );
  }

  function postFeedbackRequest(record: SubagentRecord, request: FeedbackRequest): void {
    const parts = [
      `Sub-agent ${record.name} (${record.id}) needs feedback.`,
      `Question: ${request.question}`,
    ];
    if (request.context) {
      parts.push(`Context: ${request.context}`);
    }
    parts.push(`Reply with: /subagent reply ${record.id} <feedback>`);

    pi.sendMessage(
      {
        customType: FEEDBACK_MESSAGE_TYPE,
        content: parts.join("\n\n"),
        display: true,
        details: {
          subagentId: record.id,
          requestId: request.id,
          question: request.question,
        },
      },
      { triggerTurn: false },
    );
  }

  function createAskMainSessionTool(
    record: SubagentRecord,
  ): ToolDefinition<typeof AskMainSessionParams, FeedbackRequestDetails> {
    return {
      name: "ask_main_session",
      label: "Ask Main Session",
      description:
        "Ask the main Pi session for feedback when the sub-agent is blocked or needs user input. The tool waits until the main session replies.",
      promptSnippet:
        "Ask the main Pi session for feedback when blocked or when user input is required. Use this instead of guessing.",
      promptGuidelines: [
        "Call ask_main_session when a decision, credential, missing requirement, or user preference blocks progress.",
        "Ask one concrete question at a time and include only the context needed for the parent to answer.",
        "Wait for the returned feedback before continuing.",
      ],
      parameters: AskMainSessionParams,
      execute(_toolCallId, params, signal) {
        const question = params.question.trim();
        const context = params.context?.trim();
        const requestId = `${record.id}-feedback-${++record.feedbackSerial}`;

        return new Promise((resolve) => {
          let settled = false;
          const settle = (status: FeedbackRequestDetails["status"], text: string) => {
            if (settled) {
              return;
            }
            settled = true;
            signal?.removeEventListener("abort", abortHandler);
            if (record.pendingFeedback?.id === requestId) {
              record.pendingFeedback = undefined;
            }
            if (record.status !== "stopped" && record.status !== "failed") {
              record.status = status === "answered" ? "running" : record.status;
            }
            markActivity(
              record,
              status === "answered" ? "Received feedback from main session." : text,
            );
            store.persistNow(record);
            updateStatusWidget();
            resolve({
              content: [{ type: "text", text }],
              details: {
                requestId,
                subagentId: record.id,
                status,
              },
            });
          };

          const abortHandler = () => {
            settle(
              "cancelled",
              "The feedback request was cancelled because the sub-agent stopped.",
            );
          };

          record.status = "waiting for feedback";
          markActivity(record, `Waiting for feedback: ${question}`);
          record.pendingFeedback = {
            id: requestId,
            question,
            context,
            requestedAt: Date.now(),
            resolve: (feedback: string) => settle("answered", feedback),
            cancel: (reason: string) => settle("cancelled", reason),
          };
          store.persistNow(record);

          if (signal?.aborted) {
            abortHandler();
            return;
          }

          signal?.addEventListener("abort", abortHandler, { once: true });
          postFeedbackRequest(record, record.pendingFeedback);
          updateStatusWidget();
        });
      },
    };
  }

  function updateFromEvent(record: SubagentRecord, event: AgentSessionEvent): void {
    switch (event.type) {
      case "message_start":
      case "message_update": {
        const streamed = extractEventAssistantText(event.message);
        if (streamed) {
          markActivity(record, streamed);
        }
        break;
      }
      case "message_end": {
        const text = extractEventAssistantText(event.message);
        if (text) {
          markActivity(record, text);
        }
        break;
      }
      case "tool_execution_start": {
        record.toolCalls.set(event.toolCallId, {
          name: event.toolName,
          startedAt: Date.now(),
          status: "running",
        });
        markActivity(record, `Running tool: ${event.toolName}`);
        break;
      }
      case "tool_execution_update": {
        markActivity(record, `Tool update: ${event.toolName}`);
        break;
      }
      case "tool_execution_end": {
        const tool = record.toolCalls.get(event.toolCallId);
        if (tool) {
          tool.status = event.isError ? "failed" : "done";
        }
        markActivity(record, `${event.toolName} ${event.isError ? "failed" : "finished"}`);
        break;
      }
      case "turn_end": {
        updateRecordContextUsage(record);
        break;
      }
      case "compaction_end": {
        markActivity(record, event.aborted ? "Compaction aborted." : "Compaction finished.");
        break;
      }
      default:
        updateRecordContextUsage(record);
    }

    updateStatusWidget();
  }

  function getSubagentTools(record: SubagentRecord): string[] {
    return resolveSubagentTools(pi.getActiveTools(), record.role?.tools);
  }

  function getSubagentToolPromptGuidelines(toolNames: string[]): string {
    return formatToolPromptGuidelines(pi.getAllTools(), toolNames);
  }

  function resolveSubagentLaunchConfig(
    ctx: ExtensionContext,
    record: SubagentRecord,
  ): SubagentLaunchConfig {
    const tools = getSubagentTools(record);
    const toolPromptGuidelines = getSubagentToolPromptGuidelines(tools);
    return createSubagentLaunchConfig({
      record,
      model: resolveSubagentModel(ctx, record.role),
      thinkingLevel: record.role?.thinking ?? (pi.getThinkingLevel() as SessionThinkingLevel),
      tools,
      systemPrompt: buildSubagentSystemPrompt(ctx, record, toolPromptGuidelines),
      openInHerdr,
    });
  }

  function resolveSubagentModel(ctx: ExtensionContext, role?: SubagentRole): Model<Api> {
    if (!role?.model) {
      if (!ctx.model) {
        throw new Error("No active model selected.");
      }
      return ctx.model;
    }

    const model = ctx.modelRegistry.find(role.model.provider, role.model.modelId);
    if (!model) {
      throw new Error(
        `Role "${role.name}" requires model ${role.model.label}, but it is not configured.`,
      );
    }
    return model;
  }

  function createSubagentRecord(parsed: ParsedStartArgs, ctx: ExtensionContext): SubagentRecord {
    const cwd = parsed.cwd ?? ctx.cwd;
    const record: SubagentRecord = {
      id: store.nextId(),
      parentSessionId: ctx.sessionManager.getSessionId(),
      name: parsed.name,
      task: parsed.task,
      instructions: parsed.instructions,
      cwd,
      role: parsed.role,
      status: "starting",
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      activity: "Queued.",
      feedbackSerial: 0,
      toolCalls: new Map(),
      notifyOnCompletion: parsed.notifyOnCompletion ?? true,
      reportCompletionToMain: parsed.reportCompletionToMain ?? false,
      completionGroupId: parsed.completionGroupId,
    };
    store.add(record);
    updateStatusWidget(ctx);

    if (parsed.notifyOnStart ?? true) {
      postStatusMessage(
        [
          `Started sub-agent ${record.name} (${record.id}).`,
          record.role ? `Role: ${record.role.name}` : "",
          `Cwd: ${formatPathForDisplay(record.cwd)}`,
          `Task: ${record.task}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }
    const completion = runSubagent(record, ctx);
    record.completion = completion;
    void completion;
    return record;
  }

  async function runSubagent(record: SubagentRecord, ctx: ExtensionContext): Promise<void> {
    let launch: SubagentLaunchConfig;
    try {
      launch = resolveSubagentLaunchConfig(ctx, record);
      record.launchToken = launch.launchToken;
    } catch (error) {
      finishExternalSubagent(record, {
        kind: "terminal",
        status: "failed",
        error: messageFromUnknownError(error),
      });
      return;
    }

    if (!launch.openInHerdr) {
      await runInProcessSubagent(record, ctx, launch);
      return;
    }

    if (herdrCleanupPromise) {
      await herdrCleanupPromise;
    }
    if (isFinishedStatus(record.status)) {
      return;
    }
    record.backend = "herdr";
    record.externalLaunchAbort = new AbortController();
    await Promise.resolve();
    herdrController ??= new HerdrSessionController({
      parentSessionId: launch.parentSessionId,
    });
    const cmuxEnvironment = detectCmuxEnvironment();
    if (cmuxEnvironment) {
      cmuxHostController ??= new CmuxHerdrHostController(cmuxEnvironment);
    }
    const terminal = await runHerdrSubagent({
      launch,
      controller: herdrController,
      beforeDispatchSignal: record.externalLaunchAbort.signal,
      async onServerReady(sessionName) {
        if (cmuxHostController) {
          await cmuxHostController.launchHost(sessionName);
        } else if (!attachCommandAnnounced) {
          attachCommandAnnounced = true;
          postStatusMessage(
            `Interactive sub-agents are running in Herdr. Attach with:\n\n${herdrController?.attachCommand()}`,
          );
        }
      },
      onPrepared(paths, child) {
        record.runDirectory = paths.runDirectory;
        record.childSessionPath = paths.session;
        record.herdrSessionName = herdrController?.sessionName;
        record.herdrWorkspaceId = child.workspaceId;
        record.herdrTabId = child.tabId;
        record.herdrPaneId = child.paneId;
        record.dispatchState = "pending";
        markActivity(record, "Created interactive Herdr child tab.");
        store.persistNow(record);
        updateStatusWidget();
      },
      onDispatch() {
        record.dispatchState = "dispatched";
        markActivity(record, "Launching interactive Pi child in Herdr.");
        store.persistNow(record);
        updateStatusWidget();
      },
      onActivity(activity) {
        if (activity.contextUsage) {
          record.contextUsage = activity.contextUsage;
        }
        if (activity.event === "session_start" || record.status === "starting") {
          record.status = "running";
          markActivity(record, "Interactive Pi child started in Herdr.");
        } else if (activity.phase === "waiting") {
          markActivity(record, "Interactive child is waiting for input.");
        } else if (activity.message) {
          markActivity(record, activity.message);
        } else {
          markActivity(record, `Interactive child: ${activity.event}.`);
        }
        updateStatusWidget();
      },
      onFeedbackRequest(request, paths) {
        if (record.pendingFeedback?.id === request.requestId) {
          return;
        }
        record.status = "waiting for feedback";
        markActivity(record, `Waiting for feedback: ${request.question}`);
        record.pendingFeedback = {
          id: request.requestId,
          question: request.question,
          context: request.context,
          requestedAt: request.requestedAt,
          resolve(feedback) {
            record.coordinationSequence = writeHerdrFeedbackResponse(
              {
                recordId: record.id,
                launchToken: launch.launchToken,
                runDirectory: paths.runDirectory,
                sequence: record.coordinationSequence ?? 0,
              },
              request.requestId,
              feedback,
            );
            record.pendingFeedback = undefined;
            record.status = "running";
            markActivity(record, "Received feedback from main session.");
            store.persistNow(record);
            updateStatusWidget();
          },
          cancel(reason) {
            record.pendingFeedback = undefined;
            markActivity(record, reason);
            store.persistNow(record);
            updateStatusWidget();
          },
        };
        store.persistNow(record);
        postFeedbackRequest(record, record.pendingFeedback);
        updateStatusWidget();
      },
      onDiagnostic(message) {
        addExternalDiagnostic(record, message);
      },
    });

    record.externalLaunchAbort = undefined;
    if (terminal.kind === "fallback") {
      postStatusMessage(
        `Could not open an interactive Herdr child for ${record.name} (${record.id}); using the in-process runner.\n\n${terminal.reason}`,
      );
      record.backend = undefined;
      clearExternalRecordState(record);
      await cleanupHerdrRuntimeIfIdle(record);
      await runInProcessSubagent(record, ctx, launch);
      return;
    }

    finishExternalSubagent(record, terminal);
  }

  async function runInProcessSubagent(
    record: SubagentRecord,
    ctx: ExtensionContext,
    launch: SubagentLaunchConfig,
  ): Promise<void> {
    try {
      record.backend = "in-process";
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(launch.model);
      if (!auth.ok) {
        throw new Error(
          auth.error || `No credentials available for ${launch.model.provider}/${launch.model.id}.`,
        );
      }

      markActivity(
        record,
        record.role
          ? `Creating ${record.role.name} background Pi session.`
          : "Creating background Pi session.",
      );
      const { session } = await createAgentSession({
        cwd: launch.cwd,
        sessionManager: SessionManager.inMemory(launch.cwd),
        model: launch.model,
        thinkingLevel: launch.thinkingLevel,
        tools: launch.tools,
        customTools: [createAskMainSessionTool(record) as unknown as ToolDefinition],
        resourceLoader: createSubagentResourceLoader(ctx, record, "", launch.systemPrompt),
      });

      record.session = session;
      record.unsubscribe = session.subscribe((event) => updateFromEvent(record, event));

      record.status = "running";
      markActivity(record, "Started fresh background task.");
      store.persistNow(record);
      updateStatusWidget();

      await session.prompt(launch.task, { source: "extension" });

      if (isFinishedStatus(record.status)) {
        return;
      }

      const response = getLastAssistantMessage(session);
      if (!response) {
        throw new Error("Sub-agent finished without an assistant response.");
      }
      if (response.stopReason === "aborted") {
        record.status = "stopped";
        record.finishedAt = Date.now();
        markActivity(record, "Stopped.");
        return;
      }
      if (response.stopReason === "error") {
        throw new Error(response.errorMessage || "Sub-agent request failed.");
      }

      record.result = extractText(response.content) || "(No text response)";
      record.status = "completed";
      record.finishedAt = Date.now();
      markActivity(record, "Completed.");
      if (!reporter.queue(record) && record.notifyOnCompletion) {
        postStatusMessage(`Sub-agent ${record.name} (${record.id}) completed.\n\n${record.result}`);
      }
    } catch (error) {
      if (isFinishedStatus(record.status)) {
        return;
      }
      record.error = messageFromUnknownError(error);
      record.status = "failed";
      record.finishedAt = Date.now();
      markActivity(record, "Failed.");
      if (!reporter.queue(record) && record.notifyOnCompletion) {
        postStatusMessage(`Sub-agent ${record.name} (${record.id}) failed.\n\n${record.error}`);
      }
    } finally {
      record.pendingFeedback?.cancel("The sub-agent is no longer running.");
      updateRecordContextUsage(record);
      store.persistNow(record);
      disposeSubagentSession(record);
      updateStatusWidget();
    }
  }

  function clearExternalRecordState(record: SubagentRecord): void {
    record.runDirectory = undefined;
    record.childSessionPath = undefined;
    record.herdrSessionName = undefined;
    record.herdrWorkspaceId = undefined;
    record.herdrTabId = undefined;
    record.herdrPaneId = undefined;
    record.dispatchState = undefined;
  }

  function finishExternalSubagent(record: SubagentRecord, terminal: HerdrTerminalResult): void {
    if (terminal.kind !== "terminal") {
      return;
    }
    record.contextUsage = terminal.contextUsage ?? record.contextUsage;
    if (isFinishedStatus(record.status)) {
      clearExternalRecordState(record);
      store.persistNow(record);
      updateStatusWidget();
      void cleanupHerdrRuntimeIfIdle(record);
      return;
    }
    record.status = terminal.status;
    record.terminalState = terminal.status;
    record.result = terminal.result;
    record.error = terminal.error;
    record.finishedAt = Date.now();
    record.pendingFeedback?.cancel("The sub-agent is no longer running.");
    clearExternalRecordState(record);
    markActivity(
      record,
      terminal.status === "completed"
        ? "Completed."
        : terminal.status === "failed"
          ? "Failed."
          : terminal.status === "stopped"
            ? "Stopped."
            : "Interrupted because the Herdr child tab closed.",
    );
    store.persistNow(record);
    updateStatusWidget();

    if (terminal.status === "completed") {
      if (!reporter.queue(record) && record.notifyOnCompletion) {
        postStatusMessage(`Sub-agent ${record.name} (${record.id}) completed.\n\n${record.result}`);
      }
    } else if (terminal.status === "failed") {
      if (!reporter.queue(record) && record.notifyOnCompletion) {
        postStatusMessage(`Sub-agent ${record.name} (${record.id}) failed.\n\n${record.error}`);
      }
    } else {
      reporter.flush();
    }
    void cleanupHerdrRuntimeIfIdle(record);
  }

  async function startSubagent(args: string, ctx: ExtensionCommandContext): Promise<void> {
    beginParentSession(ctx);
    const parsed = parseStartArgs(args, rolesByName);
    if (!parsed) {
      ctx.ui.notify("Usage: /subagent start <task> or /subagent start <role> <task>", "warning");
      return;
    }

    const cwdResult = resolveSubagentCwd(parsed.cwd, ctx.cwd);
    if (!cwdResult.cwd) {
      ctx.ui.notify(cwdResult.error ?? "Invalid sub-agent cwd.", "warning");
      return;
    }

    const limitMessage = concurrencyLimitMessage();
    if (limitMessage) {
      ctx.ui.notify(limitMessage, "warning");
      return;
    }

    createSubagentRecord({ ...parsed, cwd: cwdResult.cwd }, ctx);
  }

  function startSubagentFromTool(
    params: {
      role?: string;
      task: string;
      instructions?: string;
      name?: string;
      cwd?: string;
    },
    ctx: ExtensionContext,
  ): StartSubagentDetails {
    beginParentSession(ctx);
    const task = params.task.trim();
    if (!task) {
      return {
        status: "error",
        error: "task is required.",
        availableRoles: availableRoleNames(),
      };
    }

    const roleName = params.role?.trim();
    const role = roleName ? rolesByName.get(roleName.toLowerCase()) : undefined;
    if (roleName && !role) {
      return {
        status: "error",
        error: `Unknown sub-agent role "${roleName}".`,
        availableRoles: availableRoleNames(),
      };
    }

    const cwdResult = resolveSubagentCwd(params.cwd, ctx.cwd);
    if (!cwdResult.cwd) {
      return {
        status: "error",
        error: cwdResult.error ?? "Invalid sub-agent cwd.",
        availableRoles: availableRoleNames(),
      };
    }

    const limitMessage = concurrencyLimitMessage();
    if (limitMessage) {
      return {
        status: "error",
        error: limitMessage,
        availableRoles: availableRoleNames(),
      };
    }

    const displayName = params.name?.trim() || role?.name || deriveName(task);
    const record = createSubagentRecord(
      {
        name: displayName,
        task,
        instructions: params.instructions?.trim() || undefined,
        role,
        cwd: cwdResult.cwd,
        notifyOnStart: false,
        notifyOnCompletion: false,
        reportCompletionToMain: true,
        completionGroupId: reporter.assignGroup(),
      },
      ctx,
    );
    return detailsForRecord(record);
  }

  async function stopSubagentRecord(
    record: SubagentRecord,
    reason?: string,
  ): Promise<SubagentControlDetails> {
    if (isFinishedStatus(record.status)) {
      const message = `Sub-agent ${record.name} (${record.id}) is already ${record.status}.`;
      return detailsForControl("stop", "noop", record, message);
    }

    const stopReason = reason?.trim() || "Stopped by main session.";
    if (record.backend === "herdr") {
      return stopHerdrSubagentRecord(record, stopReason);
    }

    record.status = "stopped";
    record.finishedAt = Date.now();
    record.pendingFeedback?.cancel(stopReason);
    markActivity(record, stopReason);
    store.persistNow(record);
    updateStatusWidget();

    try {
      await record.session?.abort();
    } catch (error) {
      record.error = messageFromUnknownError(error);
    } finally {
      disposeSubagentSession(record);
    }
    reporter.flush();

    return detailsForControl(
      "stop",
      "stopped",
      record,
      `Stopped sub-agent ${record.name} (${record.id}).`,
    );
  }

  async function stopHerdrSubagentRecord(
    record: SubagentRecord,
    stopReason: string,
  ): Promise<SubagentControlDetails> {
    markActivity(record, `Stopping interactive child: ${stopReason}`);
    store.persistNow(record);
    updateStatusWidget();

    let stopControlFailed = false;
    if (record.dispatchState !== "dispatched") {
      record.externalLaunchAbort?.abort();
    } else if (record.runDirectory && record.launchToken) {
      try {
        record.coordinationSequence = writeHerdrStopControl(
          {
            recordId: record.id,
            launchToken: record.launchToken,
            runDirectory: record.runDirectory,
            sequence: record.coordinationSequence ?? 0,
          },
          stopReason,
        );
      } catch (error) {
        stopControlFailed = true;
        record.externalDiagnostics ??= [];
        record.externalDiagnostics.push(
          `Could not send child stop control: ${messageFromUnknownError(error)}`,
        );
      }
    }

    const stoppedGracefully = stopControlFailed
      ? false
      : await Promise.race([
          record.completion?.then(
            () => true,
            () => false,
          ) ?? Promise.resolve(true),
          delay(HERDR_GRACEFUL_STOP_TIMEOUT_MS).then(() => false),
        ]);
    if (!stoppedGracefully && herdrController) {
      record.status = "stopped";
      record.terminalState = "stopped";
      record.finishedAt = Date.now();
      record.pendingFeedback?.cancel(stopReason);
      markActivity(record, `${stopReason} Forced Herdr tab closure after timeout.`);
      store.persistNow(record);
      updateStatusWidget();
      try {
        await herdrController.closeChild(record.id);
      } catch (error) {
        record.error = messageFromUnknownError(error);
        store.persistNow(record);
      }
      await Promise.race([
        record.completion?.catch(() => undefined) ?? Promise.resolve(),
        delay(500),
      ]);
    }
    reporter.flush();

    return detailsForControl(
      "stop",
      "stopped",
      record,
      `Stopped sub-agent ${record.name} (${record.id}).`,
    );
  }

  function replySubagentRecord(record: SubagentRecord, feedback: string): SubagentControlDetails {
    const trimmedFeedback = feedback.trim();
    if (!trimmedFeedback) {
      return detailsForControl("reply", "error", record, undefined, "feedback is required.");
    }
    if (!record.pendingFeedback) {
      return detailsForControl(
        "reply",
        "error",
        record,
        undefined,
        `Sub-agent ${record.id} is not waiting for feedback.`,
      );
    }

    try {
      record.pendingFeedback.resolve(trimmedFeedback);
    } catch (error) {
      return detailsForControl("reply", "error", record, undefined, messageFromUnknownError(error));
    }
    return detailsForControl(
      "reply",
      "replied",
      record,
      `Sent feedback to sub-agent ${record.name} (${record.id}).`,
    );
  }

  async function stopSubagent(id: string, ctx: ExtensionCommandContext): Promise<void> {
    const found = store.resolveSingle(
      id,
      store.active(),
      "No active sub-agents to stop.",
      "Multiple active sub-agents; provide an id",
    );
    if (!found.record) {
      ctx.ui.notify(found.error ?? "Sub-agent not found.", "warning");
      return;
    }

    const details = await stopSubagentRecord(found.record);
    if (details.status === "noop") {
      ctx.ui.notify(details.message ?? "Sub-agent is already finished.", "info");
      return;
    }
    if (details.status === "error") {
      ctx.ui.notify(details.error ?? "Could not stop sub-agent.", "warning");
      return;
    }
    postStatusMessage(
      details.message ?? `Stopped sub-agent ${found.record.name} (${found.record.id}).`,
    );
  }

  function replyToSubagent(args: string, ctx: ExtensionCommandContext): void {
    const { command: id, rest: feedback } = splitCommand(args);
    if (!id || !feedback) {
      ctx.ui.notify("Usage: /subagent reply <id> <feedback>", "warning");
      return;
    }

    const found = store.find(id);
    if (!found.record) {
      ctx.ui.notify(found.error ?? "Sub-agent not found.", "warning");
      return;
    }

    const details = replySubagentRecord(found.record, feedback);
    if (details.status === "error") {
      ctx.ui.notify(details.error ?? "Could not reply to sub-agent.", "warning");
      return;
    }

    postStatusMessage(
      details.message ?? `Sent feedback to sub-agent ${found.record.name} (${found.record.id}).`,
    );
  }

  async function stopSubagentFromTool(params: {
    id?: string;
    reason?: string;
  }): Promise<SubagentControlDetails> {
    const found = store.resolveSingle(
      params.id,
      store.active(),
      "No active sub-agents to stop.",
      "Multiple active sub-agents; provide an id",
    );
    if (!found.record) {
      return detailsForControl(
        "stop",
        "error",
        undefined,
        undefined,
        found.error ?? "Sub-agent not found.",
      );
    }

    return stopSubagentRecord(found.record, params.reason);
  }

  function replySubagentFromTool(params: {
    id?: string;
    feedback: string;
  }): SubagentControlDetails {
    const found = store.resolveSingle(
      params.id,
      store.waitingFeedback(),
      "No sub-agent is waiting for feedback.",
      "Multiple sub-agents are waiting for feedback; provide an id",
    );
    if (!found.record) {
      return detailsForControl(
        "reply",
        "error",
        undefined,
        undefined,
        found.error ?? "Sub-agent not found.",
      );
    }

    return replySubagentRecord(found.record, params.feedback);
  }

  function showStatusView(args: string, ctx: ExtensionCommandContext): void {
    beginParentSession(ctx);
    updateStatusWidget(ctx);
    const id = args.trim();
    if (!id) {
      const active = store.active();
      const prefix =
        active.length > 0
          ? "Sub-agent status is visible below the editor while background work is active."
          : "No sub-agents are currently active.";
      postStatusMessage(`${prefix}\n\n${formatSubagentList(store.sorted(), ctx.ui.theme)}`);
      return;
    }

    const found = store.find(id);
    if (found.record) {
      postStatusMessage(formatRecordDetails(found.record));
      return;
    }

    const role = rolesByName.get(id.toLowerCase());
    if (role) {
      postStatusMessage(formatRoleDetails(role, ctx.ui.theme));
      return;
    }

    ctx.ui.notify(found.error ?? "Sub-agent or role not found.", "warning");
  }

  function enforceStartSubagentToolIsolation(
    event: ToolCallEvent,
  ): ToolCallEventResult | undefined {
    if (event.toolName === "start_subagent") {
      if (nonSubagentToolCalledThisTurn) {
        return {
          block: true,
          reason:
            "Blocked because another tool was already called in this assistant turn. Launch sub-agents in their own turn so the main session returns control immediately.",
        };
      }
      startSubagentCalledThisTurn = true;
      return undefined;
    }

    nonSubagentToolCalledThisTurn = true;
    if (!startSubagentCalledThisTurn) {
      return undefined;
    }

    return {
      block: true,
      reason:
        "Blocked because start_subagent was already called in this assistant turn. Launch sub-agents in their own turn so the main session returns control immediately.",
    };
  }

  pi.registerCommand("subagent", {
    description:
      "Manage simple background sub-agents. Use `/subagent start <task>`, `/subagent start <role> <task>`, `/subagent agents`, `/subagent list`, `/subagent view [id]`, `/subagent stop <id>`, or `/subagent reply <id> <feedback>`.",
    handler: async (args, ctx) => {
      latestCtx = ctx;
      beginParentSession(ctx);
      const { command, rest } = splitCommand(args);
      switch (command) {
        case "start":
          await startSubagent(rest, ctx);
          return;
        case "list":
          updateStatusWidget(ctx);
          postStatusMessage(formatSubagentList(store.sorted(), ctx.ui.theme));
          return;
        case "agents":
          postStatusMessage(
            [formatRoleList(roles, ctx.ui.theme), formatRoleDiagnostics(roleDiagnostics)]
              .filter(Boolean)
              .join("\n\n"),
          );
          return;
        case "view":
          showStatusView(rest, ctx);
          return;
        case "stop":
          await stopSubagent(rest, ctx);
          return;
        case "reply":
          replyToSubagent(rest, ctx);
          return;
        case "help":
          postStatusMessage(
            [
              "Sub-agent commands:",
              "- /subagent start <task>",
              "- /subagent start <name>: <task>",
              "- /subagent start <role> <task>",
              "- /subagent agents",
              "- /subagent list",
              "- /subagent view [id|role]",
              "- /subagent stop <id>",
              "- /subagent reply <id> <feedback>",
            ].join("\n"),
          );
          return;
        default:
          showStatusView("", ctx);
      }
    },
  });

  pi.registerTool({
    name: "start_subagent",
    label: "Start Subagent",
    description:
      "Start an in-process background Pi sub-agent for delegated work. " +
      "Create a task-specific specialization with instructions, or use an optional configured role preset. " +
      "The tool returns after launch so the main session stays interruptible while the sub-agent runs.",
    promptSnippet: `Launch a task-specialized background sub-agent and return control immediately. Optional role presets: ${availableRoleNames().join(", ")}.`,
    promptGuidelines: [
      "Use start_subagent when a clearly bounded task should be delegated.",
      "Choose the number and specialization of sub-agents from the task instead of defaulting every launch to the same preset role.",
      "For task-specific specialization, omit role and provide focused instructions describing the sub-agent's perspective, scope, and expected output.",
      "Use a configured role only when its reusable prompt and tool policy directly match the task; use `/subagent agents` to inspect available roles.",
      "When using start_subagent, only launch the sub-agent or sub-agents in that turn. Do not call source-reading or analysis tools in the same turn.",
      "After launch, stop and let the user regain control instead of continuing analysis in the main session.",
      "Tool-started sub-agents report completion back into the main session; when a completion report arrives, relay or synthesize it for the user without redoing the sub-agent's investigation.",
      "Do not duplicate the sub-agent's investigation in the main session.",
      "Do not expose implementation parameters or tool details to the user; users can start explicit background jobs with `/subagent start <role> <task>`.",
      "Sub-agents start with fresh conversation context, so give the sub-agent a concrete, self-contained task with enough context to finish without guessing.",
      "Sub-agents stay scoped to their launch cwd. If the task names a relative path, verify it exists in the current cwd before launching; if a different repo/folder is explicit or already verified, pass cwd.",
      "Do not use cwd to send a sub-agent roaming around the filesystem. Ask the user when the correct working directory is unclear.",
      "If the user wants to stop, cancel, or kill a sub-agent, use stop_subagent instead of asking them to type a slash command.",
      "If the user answers a sub-agent feedback request, use reply_subagent instead of asking them to type a slash command.",
      "Users can still manually inspect and control sub-agents with `/subagent view <id>`, `/subagent stop <id>`, and `/subagent reply <id> <feedback>`.",
    ],
    parameters: StartSubagentParams,
    renderShell: "self",
    renderCall(args, theme) {
      return new Text(theme.fg("accent", formatStartSubagentCall(args)), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as StartSubagentDetails | undefined;
      const firstContent = result.content[0];
      const contentText = firstContent?.type === "text" ? firstContent.text : "";

      if (!details) {
        return new Text(contentText || "(no output)", 0, 0);
      }

      if (expanded) {
        return new Text(formatStartSubagentExpanded(details, contentText), 0, 0);
      }

      const color =
        details.status === "completed"
          ? "success"
          : details.status === "failed" || details.status === "error"
            ? "error"
            : details.status === "waiting for feedback"
              ? "warning"
              : "accent";
      const hint = details.command ? ` | expand or run ${details.command}` : "";
      return new Text(
        `${theme.fg(color, formatStartSubagentSummary(details))}${theme.fg("dim", hint)}`,
        0,
        0,
      );
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (signal?.aborted) {
        throw new Error("Sub-agent start was cancelled.");
      }

      const details = startSubagentFromTool(params, ctx);
      let text = `Started sub-agent ${details.name} (${details.subagentId}) in ${details.cwd}. It is running in the background and will report back here when finished. Inspect it with ${details.command} or stop it with stop_subagent.`;
      if (details.status === "completed" && details.result) {
        text = `Sub-agent ${details.name} (${details.subagentId}) completed in ${details.cwd}.\n\n${details.result}`;
      } else if (details.status === "waiting for feedback") {
        text = `Sub-agent ${details.name} (${details.subagentId}) needs feedback in ${details.cwd}. Use reply_subagent to answer it or stop_subagent to stop it. The user can also manually inspect it with ${details.command}.`;
      } else if (details.status === "failed") {
        text = `Sub-agent ${details.name} (${details.subagentId}) failed in ${details.cwd}.\n\n${details.error ?? details.activity ?? "Unknown error"}`;
      } else if (details.status === "error") {
        text = `Error: ${details.error}`;
      }

      return {
        content: [{ type: "text", text }],
        details,
        terminate: details.status !== "error",
      };
    },
  });

  pi.registerTool({
    name: "stop_subagent",
    label: "Stop Subagent",
    description:
      "Stop a running or waiting sub-agent on behalf of the user. " +
      "Use this when the user says to stop, cancel, kill, abort, or dismiss a sub-agent.",
    promptSnippet: "Stop or cancel an active sub-agent.",
    promptGuidelines: [
      "Use stop_subagent when the user asks to stop, cancel, kill, abort, dismiss, or end a sub-agent.",
      "If exactly one sub-agent is active or waiting for feedback, omit id when the user says 'it' or 'the subagent'.",
      "If multiple sub-agents are active, use the id from the feedback message, widget, or prior tool result.",
      "Do not ask the user to type `/subagent stop <id>` unless tool use is unavailable; the manual command remains available for users who prefer it.",
    ],
    parameters: StopSubagentParams,
    renderCall(args, theme) {
      return new Text(theme.fg("warning", formatStopSubagentCall(args)), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as SubagentControlDetails | undefined;
      const firstContent = result.content[0];
      const contentText = firstContent?.type === "text" ? firstContent.text : "";
      if (!details) {
        return new Text(contentText || "(no output)", 0, 0);
      }
      if (expanded) {
        return new Text(formatControlExpanded(details, contentText), 0, 0);
      }
      const color =
        details.status === "stopped" ? "success" : details.status === "noop" ? "warning" : "error";
      return new Text(theme.fg(color, formatControlSummary(details)), 0, 0);
    },
    async execute(_toolCallId, params) {
      const details = await stopSubagentFromTool(params);
      const text =
        details.message ??
        (details.error ? `Error: ${details.error}` : formatControlSummary(details));
      return {
        content: [{ type: "text", text }],
        details,
      };
    },
  });

  pi.registerTool({
    name: "reply_subagent",
    label: "Reply Subagent",
    description:
      "Answer a sub-agent feedback request on behalf of the user. " +
      "Use this when the user gives an instruction or answer for a waiting sub-agent.",
    promptSnippet: "Reply to a waiting sub-agent feedback request.",
    promptGuidelines: [
      "Use reply_subagent when the user answers a sub-agent feedback request or tells you what to tell the sub-agent.",
      "If exactly one sub-agent is waiting for feedback, omit id when the user's intent is clear.",
      "If multiple sub-agents are waiting, use the id from the feedback message or widget.",
      "Send the user's actual instruction as feedback; do not summarize away important constraints.",
      "Do not ask the user to type `/subagent reply <id> <feedback>` unless tool use is unavailable; the manual command remains available for users who prefer it.",
    ],
    parameters: ReplySubagentParams,
    renderCall(args, theme) {
      return new Text(theme.fg("accent", formatReplySubagentCall(args)), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as SubagentControlDetails | undefined;
      const firstContent = result.content[0];
      const contentText = firstContent?.type === "text" ? firstContent.text : "";
      if (!details) {
        return new Text(contentText || "(no output)", 0, 0);
      }
      if (expanded) {
        return new Text(formatControlExpanded(details, contentText), 0, 0);
      }
      const color = details.status === "replied" ? "success" : "error";
      return new Text(theme.fg(color, formatControlSummary(details)), 0, 0);
    },
    async execute(_toolCallId, params) {
      const details = replySubagentFromTool(params);
      const text =
        details.message ??
        (details.error ? `Error: ${details.error}` : formatControlSummary(details));
      return {
        content: [{ type: "text", text }],
        details,
      };
    },
  });

  pi.on("tool_call", async (event) => enforceStartSubagentToolIsolation(event));

  pi.on("input", async (event: InputEvent) => {
    latestInputStreamingBehavior = event.streamingBehavior;
    return { action: "continue" };
  });

  pi.on("turn_start", async () => {
    startSubagentCalledThisTurn = false;
    nonSubagentToolCalledThisTurn = false;
  });

  pi.on("turn_end", async () => {
    startSubagentCalledThisTurn = false;
    nonSubagentToolCalledThisTurn = false;
    latestInputStreamingBehavior = undefined;
  });

  pi.on("agent_end", async () => {
    startSubagentCalledThisTurn = false;
    nonSubagentToolCalledThisTurn = false;
    latestInputStreamingBehavior = undefined;
  });

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    beginParentSession(ctx);
    updateStatusWidget(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    latestCtx = ctx;
    if (ctx.hasUI) {
      ctx.ui.setWidget("subagents", undefined);
      ctx.ui.setStatus("subagents", undefined);
    }
    widgetTimer.clear();
    reporter.reset();
    const activeRecords = [...store.values()].filter((record) => !isFinishedStatus(record.status));
    await Promise.all(
      activeRecords.map(async (record) => {
        if (record.backend === "herdr") {
          await stopHerdrSubagentRecord(record, "The main Pi session shut down.");
        } else {
          try {
            await record.session?.abort();
          } catch (error) {
            record.error = messageFromUnknownError(error);
          }
          disposeSubagentSession(record);
        }
        record.status = "interrupted";
        record.terminalState = "interrupted";
        record.finishedAt = Date.now();
        record.pendingFeedback?.cancel("The Pi session shut down before feedback arrived.");
        markActivity(record, "Interrupted because the main session shut down.");
        store.persistNow(record);
      }),
    );
    const ownedHerdr = detachHerdrRuntime();
    try {
      await ownedHerdr.controller?.stopAndDelete();
    } catch (error) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Could not stop the owned Herdr session: ${messageFromUnknownError(error)}`,
          "error",
        );
      }
    }
    try {
      ownedHerdr.host?.closeHost();
    } catch (error) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Could not close the Herdr host surface: ${messageFromUnknownError(error)}`,
          "error",
        );
      }
    }
    if (herdrCleanupPromise) {
      await herdrCleanupPromise;
    }
    store.flushPending();
  });
}
