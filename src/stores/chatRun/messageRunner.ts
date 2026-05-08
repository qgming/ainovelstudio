import { appendChatEntry, setChatDraft } from "../../lib/chat/api";
import type { ChatEntry } from "../../lib/chat/types";
import {
  buildSessionPatch,
  mergePart,
} from "../../lib/chat/sessionRuntime";
import type { AgentMessage, AgentPart, AgentRunStatus, AgentUsage } from "../../lib/agent/types";
import { useAgentSettingsStore } from "../agentSettingsStore";
import { shouldCompactUsage } from "../../lib/agent/contextCompaction";
import {
  replaceMessageEntry,
  queuePatchFromEvent,
} from "./entriesRuntime";
import {
  DEFAULT_CHAT_BOOK_ID,
  ensureAgentSettingsReady,
  ensureSessionState,
} from "./helpers";
import { createRunWritingSession } from "./messageSessionFactory";
import { handleTerminalError, type TerminalRunState } from "./messageTerminalHandlers";
import { createAssistantPersistor } from "./assistantPersistor";
import {
  buildActiveRunPatch,
  buildPendingSessionPatch,
  buildStreamPatch,
  buildUsagePatch,
} from "./messageRunPatches";
import {
  appendRunConversation,
  buildRunConversation,
  createMessageRunSeed,
  type RunContext,
} from "./messageRunSeed";
import { continueAutopilotRun } from "./autopilot";
import type {
  ActiveWritingSessionSlot,
  ChatRunStoreAccess,
  SendMessageRequest,
} from "./runtimeTypes";

type MessageRunnerParams = ChatRunStoreAccess & {
  compactSession: (reason?: "manual" | "threshold") => Promise<void>;
  ensureActiveSession: () => Promise<string>;
  request: SendMessageRequest;
  sessionSlot: ActiveWritingSessionSlot;
};

export async function runAgentMessage(params: MessageRunnerParams) {
  const runner = new MessageRunner(params);
  await runner.execute();
}

class MessageRunner {
  private readonly abortController = new AbortController();
  private readonly assistantMessage: AgentMessage;
  private conversationEntries: ChatEntry[];
  private conversationHistory: AgentMessage[];
  private readonly context: RunContext;
  private readonly messageMeta: ReturnType<typeof createMessageRunSeed>["messageMeta"];
  private readonly persistor: ReturnType<typeof createAssistantPersistor>;
  private readonly userMessage: AgentMessage;
  private latestEntries: ChatEntry[];
  private latestMessages: AgentMessage[];
  private latestUsage: AgentUsage | null = null;
  private providerConfig = useAgentSettingsStore.getState().config;
  private readonly initialSessionId: string | null;
  private sessionId: string | null;

  constructor(private readonly params: MessageRunnerParams) {
    const seed = createMessageRunSeed(params);
    this.context = seed.context;
    this.messageMeta = seed.messageMeta;
    this.userMessage = seed.userMessage;
    this.assistantMessage = seed.assistantMessage;
    this.persistor = createAssistantPersistor({
      ...params,
      assistantMessageId: this.assistantMessage.id,
      currentBookId: () => this.currentBookId(),
      getMessages: () => this.latestMessages,
      getSessionId: () => this.sessionId,
      resolveStatus: () => this.resolveActiveRunStatus(),
    });
    this.initialSessionId = seed.sessionId;
    this.sessionId = seed.sessionId;
    this.conversationEntries = seed.conversationEntries;
    this.conversationHistory = seed.conversationHistory;
    this.latestEntries = seed.latestEntries;
    this.latestMessages = seed.latestMessages;
  }

  async execute() {
    if (!this.context.nextInput) return;
    this.applyOptimisticRun();
    if (this.sessionId) void setChatDraft(this.sessionId, "");

    try {
      await this.prepareSession();
      await this.prepareRuntime();
      await this.streamResponse();
      await this.finishCompletedRun();
      await this.continueAutopilotIfNeeded();
    } catch (error) {
      await this.handleError(error);
    }
  }

  private applyOptimisticRun() {
    const optimisticSessionId = this.sessionId;
    this.params.set((state) => {
      if (!optimisticSessionId) {
        return buildPendingSessionPatch(this.runPatchContext());
      }
      return buildActiveRunPatch(state, optimisticSessionId, this.runPatchContext());
    });
  }
  private async prepareSession() {
    this.sessionId = await this.params.ensureActiveSession();
    if (!this.sessionId) throw new Error("创建会话失败。");
    if (!this.isCurrentRun()) return;

    const conversation = this.sessionId === this.initialSessionId
      ? appendRunConversation(this.conversationEntries, this.conversationHistory, this.userMessage, this.assistantMessage)
      : buildRunConversation(this.params, this.sessionId, this.userMessage, this.assistantMessage);
    this.conversationEntries = conversation.conversationEntries;
    this.conversationHistory = conversation.conversationHistory;
    this.latestMessages = conversation.latestMessages;
    this.latestEntries = conversation.latestEntries;
    this.params.set((state) => buildActiveRunPatch(state, this.sessionId as string, this.runPatchContext()));
    void setChatDraft(this.sessionId, "");

    await this.persistor.persistSummary(appendChatEntry(
      this.currentBookId(),
      this.sessionId,
      { id: this.userMessage.id, entryType: "message", payload: { message: this.userMessage } },
      buildSessionPatch(this.latestMessages, "running"),
    ));
    await this.persistor.persistSummary(appendChatEntry(
      this.currentBookId(),
      this.sessionId,
      { id: this.assistantMessage.id, entryType: "message", payload: { message: this.assistantMessage } },
    ));
  }

  private async prepareRuntime() {
    await ensureAgentSettingsReady();
    if (!this.isCurrentRun()) return;
    this.providerConfig = useAgentSettingsStore.getState().config;
  }

  private async streamResponse() {
    if (!this.sessionId || !this.isCurrentRun()) return;
    const writingSession = await createRunWritingSession({
      ...this.params,
      abortController: this.abortController,
      activeModeId: this.context.activeModeId,
      assistantMessageId: this.assistantMessage.id,
      attachUsage: (usage) => this.attachUsage(usage),
      autopilotGoal: this.context.autopilotGoal,
      autopilotIteration: this.context.autopilotIteration,
      conversationEntries: this.conversationEntries,
      conversationHistory: this.conversationHistory,
      getLatestMessages: () => this.latestMessages,
      isCurrentRun: () => this.isCurrentRun(),
      nextInput: this.context.nextInput,
      providerConfig: this.providerConfig,
      request: this.params.request,
      runRequestId: this.context.runRequestId,
      sessionId: this.sessionId,
      setPendingAsk: () => undefined,
    });
    this.params.sessionSlot.set(writingSession, writingSession.subscribe((event) => {
      const patch = queuePatchFromEvent(event);
      if (patch) this.params.set(patch);
    }));

    for await (const part of writingSession.prompt(this.context.nextInput)) {
      if (!this.isCurrentRun()) return;
      this.mergePart(part as AgentPart);
    }
  }
  private mergePart(part: AgentPart) {
    const sessionId = this.sessionId as string;
    this.params.set((state) => {
      if (state.activeRunRequestId !== this.context.runRequestId) return state;
      const messages = [...(state.messagesBySession[sessionId] ?? [])];
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role !== "assistant") return state;
      messages[messages.length - 1] = { ...lastMessage, parts: mergePart(lastMessage.parts, part) };
      this.latestMessages = messages;
      this.latestEntries = replaceMessageEntry(this.latestEntries, messages[messages.length - 1]);
      this.persistor.schedule();
      return buildStreamPatch(state, sessionId, part, this.runPatchContext());
    });
  }

  private attachUsage(usage: AgentUsage) {
    if (!this.isCurrentRun() || !this.sessionId) return;
    this.latestUsage = usage;
    this.params.set((state) => {
      const result = buildUsagePatch(state, this.sessionId as string, usage, this.runPatchContext());
      this.latestEntries = result.context.latestEntries;
      this.latestMessages = result.context.latestMessages;
      return result.patch;
    });
  }

  private async finishCompletedRun() {
    this.params.sessionSlot.clear();
    this.persistor.clearTimer();
    await this.persistor.wait();
    if (!this.isCurrentRun() || !this.sessionId) return;
    const completedSessionId = this.sessionId;
    this.params.set((state) => ({
      abortController: null,
      activeRunRequestId: state.activeRunRequestId === this.context.runRequestId ? null : state.activeRunRequestId,
      inflightToolRequestIds: [],
      pendingAsk: null,
      queuedFollowUpMessages: [],
      queuedSteeringMessages: [],
      ...ensureSessionState(state, completedSessionId, this.latestMessages, "", "completed"),
    }));
    await this.persistor.flush("completed");
    if (this.latestUsage && shouldCompactUsage(this.latestUsage)) await this.params.compactSession("threshold");
  }

  private async continueAutopilotIfNeeded() {
    await continueAutopilotRun({
      activeModeId: this.context.activeModeId,
      activeSessionId: this.params.get().activeSessionId,
      autopilotGoal: this.context.autopilotGoal,
      iteration: this.context.autopilotIteration,
      latestMessages: this.latestMessages,
      runNext: (promptOverride, autopilotIteration) => runAgentMessage({
        ...this.params,
        request: {
          options: {
            autopilotGoal: this.context.autopilotGoal as string,
            autopilotIteration,
            modeId: "autopilot",
          },
          promptOverride,
        },
      }),
      sessionId: this.sessionId,
      storeModeId: this.params.get().activeModeId,
    });
  }

  private async handleError(error: unknown) {
    this.params.sessionSlot.clear();
    this.persistor.clearTimer();
    await this.persistor.wait();
    const terminalState: TerminalRunState = {
      latestEntries: this.latestEntries,
      latestMessages: this.latestMessages,
      sessionId: this.sessionId,
    };
    await handleTerminalError(error, {
      ...this.params,
      abortController: this.abortController,
      assistantMessage: this.assistantMessage,
      flushAssistant: (status) => this.persistor.flush(status),
      messageMeta: this.messageMeta,
      persistSummary: (promise) => this.persistor.persistSummary(promise),
      providerConfig: this.providerConfig,
      runRequestId: this.context.runRequestId,
      state: terminalState,
    });
    this.latestEntries = terminalState.latestEntries;
    this.latestMessages = terminalState.latestMessages;
    this.sessionId = terminalState.sessionId;
  }

  private resolveActiveRunStatus(): AgentRunStatus {
    const state = this.params.get();
    return state.pendingAsk || state.run.status === "awaiting_user" ? "awaiting_user" : "running";
  }

  private currentBookId() {
    return this.params.get().currentBookId ?? DEFAULT_CHAT_BOOK_ID;
  }

  private runPatchContext() {
    return {
      abortController: this.abortController,
      assistantMessageId: this.assistantMessage.id,
      autopilotGoal: this.context.autopilotGoal,
      latestEntries: this.latestEntries,
      latestMessages: this.latestMessages,
      runRequestId: this.context.runRequestId,
    };
  }

  private isCurrentRun() {
    const state = this.params.get();
    return state.activeRunRequestId === this.context.runRequestId && !this.abortController.signal.aborted;
  }
}
