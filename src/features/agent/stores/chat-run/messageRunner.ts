import { appendChatEntry, setChatDraft } from "@features/agent/chat/api";
import type { ChatEntry } from "@features/agent/chat/types";
import {
  buildSessionPatch,
  mergePart,
} from "@features/agent/chat/sessionRuntime";
import type { AgentMessage, AgentPart, AgentRunStatus, AgentUsage } from "@features/agent/lib/types";
import { useAgentSettingsStore } from "@features/settings/stores/useAgentSettingsStore";
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
import type {
  ActiveWritingSessionSlot,
  ChatRunStoreAccess,
  SendMessageRequest,
} from "./runtimeTypes";

type MessageRunnerParams = ChatRunStoreAccess & {
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
  private providerConfig = useAgentSettingsStore.getState().config;
  private readonly initialSessionId: string | null;
  private pendingStreamParts: AgentPart[] = [];
  private streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null;

  constructor(private readonly params: MessageRunnerParams) {
    const seed = createMessageRunSeed(params);
    this.context = seed.context;
    this.messageMeta = seed.messageMeta;
    this.userMessage = seed.userMessage;
    this.assistantMessage = seed.assistantMessage;
    this.persistor = createAssistantPersistor({
      ...params,
      getActiveAssistantMessageId: () => this.assistantMessage.id,
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
      this.queueStreamPart(part as AgentPart);
    }
    this.flushStreamParts();
  }

  private queueStreamPart(part: AgentPart) {
    this.pendingStreamParts.push(part);
    if (part.type !== "text-delta") {
      this.flushStreamParts();
      return;
    }
    if (this.streamFlushTimer) return;
    this.streamFlushTimer = setTimeout(() => {
      this.streamFlushTimer = null;
      this.flushStreamParts();
    }, 50);
  }

  private flushStreamParts() {
    if (this.streamFlushTimer) {
      clearTimeout(this.streamFlushTimer);
      this.streamFlushTimer = null;
    }
    const parts = this.compactPendingStreamParts();
    if (parts.length === 0) return;
    this.mergeParts(parts);
  }

  private compactPendingStreamParts() {
    const compacted: AgentPart[] = [];
    for (const part of this.pendingStreamParts) {
      const previous = compacted[compacted.length - 1];
      if (part.type === "text-delta" && previous?.type === "text-delta") {
        compacted[compacted.length - 1] = { type: "text-delta", delta: previous.delta + part.delta };
        continue;
      }
      compacted.push(part);
    }
    this.pendingStreamParts = [];
    return compacted;
  }

  private mergeParts(parts: AgentPart[]) {
    const sessionId = this.sessionId as string;
    this.params.set((state) => {
      if (state.activeRunRequestId !== this.context.runRequestId) return state;
      const messages = [...(state.messagesBySession[sessionId] ?? [])];
      const lastMessage = messages[messages.length - 1];
      if (lastMessage?.role !== "assistant") return state;

      // 一次 run 只有一条 assistant 消息（seed 占位消息），该 run 全部 turn 的 text/
      // reasoning/tool-call/tool-result 都合并进这条消息。part 自带的 messageId 是 adapter
      // 每个 turn 生成的临时 id，与 seed 消息 id 不同，故全部经 fallback 落到唯一的最后一条
      // assistant 消息；tool-result 靠 toolCallId（而非 messageId）与同消息内的 tool-call 配对
      //（mergeToolResultPart），跨 turn 也能正确收口。保留 messageId 路由作为防御性逻辑，
      // 为将来若再引入多消息渲染留扩展点。
      const lastAssistantIndex = messages.length - 1;
      const indexById = new Map<string, number>();
      messages.forEach((message, index) => {
        if (message.role === "assistant") indexById.set(message.id, index);
      });

      const touchedIndexes = new Set<number>();
      for (const part of parts) {
        const messageId = (part as { messageId?: string }).messageId;
        const targetIndex =
          messageId !== undefined && indexById.has(messageId)
            ? (indexById.get(messageId) as number)
            : lastAssistantIndex;
        const target = messages[targetIndex];
        if (target?.role !== "assistant") continue;
        messages[targetIndex] = { ...target, parts: mergePart(target.parts, part) };
        touchedIndexes.add(targetIndex);
      }

      const lastPart = parts[parts.length - 1] as AgentPart;
      this.latestMessages = messages;
      // 仅对被改动的消息回写条目，避免无谓替换。
      let entries = this.latestEntries;
      for (const index of touchedIndexes) {
        entries = replaceMessageEntry(entries, messages[index]);
      }
      this.latestEntries = entries;
      this.persistor.schedule();
      return buildStreamPatch(state, sessionId, lastPart, this.runPatchContext());
    });
  }

  private attachUsage(usage: AgentUsage) {
    if (!this.isCurrentRun() || !this.sessionId) return;
    this.params.set((state) => {
      const result = buildUsagePatch(state, this.sessionId as string, usage, this.runPatchContext());
      this.latestEntries = result.context.latestEntries;
      this.latestMessages = result.context.latestMessages;
      return result.patch;
    });
  }

  private async finishCompletedRun() {
    this.flushStreamParts();
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
  }

  private async handleError(error: unknown) {
    this.flushStreamParts();
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
