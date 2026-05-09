import { cancelToolRequests } from "@features/books/api/bookWorkspaceApi";
import { createChatSession, initializeChatStorage, setChatDraft } from "@features/agent/chat/api";
import { getCompactionCount } from "@features/agent/chat/entries";
import { isPlaceholderOnly } from "@features/agent/chat/sessionRuntime";
import { useAgentSettingsStore } from "@features/settings/stores/useAgentSettingsStore";
import {
  applyPersistedSummary,
  buildInitialState,
  DEFAULT_CHAT_BOOK_ID,
  ensureSessionState,
  formatAgentError,
  selectIsAgentRunActive,
} from "./helpers";
import { applyBootstrap } from "./bootstrapState";
import { compactChatEntries, removeEntry } from "./entriesRuntime";
import { COACH_PROMPT } from "./autopilot";
import { submitAskAnswer, rejectPendingAsk } from "./askController";
import { runAgentMessage } from "./messageRunner";
import {
  createWritingSessionSlot,
  type ChatRunStoreAccess,
  type RunInterruptReason,
  type SendMessageRequest,
} from "./runtimeTypes";
import type { AskToolAnswer } from "@features/agent/lib/types";

export function createChatRuntimeController(access: ChatRunStoreAccess) {
  const sessionSlot = createWritingSessionSlot();

  async function ensureActiveSession() {
    const bookId = access.get().currentBookId ?? DEFAULT_CHAT_BOOK_ID;
    if (access.get().activeSessionId) return access.get().activeSessionId as string;
    await initializeIfNeeded(bookId);
    if (access.get().activeSessionId) return access.get().activeSessionId as string;

    const bootstrap = await createChatSession(bookId);
    access.set((state) => ({ ...applyBootstrap(state, bootstrap), isHistoryOpen: false }));
    if (!bootstrap.activeSessionId) throw new Error("创建会话失败。");
    return bootstrap.activeSessionId;
  }

  async function initialize(bookId = DEFAULT_CHAT_BOOK_ID) {
    const normalizedBookId = bookId ?? DEFAULT_CHAT_BOOK_ID;
    const state = access.get();
    if (state.status === "loading" || (state.isHydrated && state.currentBookId === normalizedBookId)) return;
    if (selectIsAgentRunActive(state)) await hardStopCurrentRun("restart");

    access.set({ ...buildInitialState(), currentBookId: normalizedBookId, status: "loading" });
    try {
      const bootstrap = await initializeChatStorage(normalizedBookId);
      access.set((state) => ({ ...applyBootstrap(state, bootstrap) }));
    } catch (error) {
      access.set({
        currentBookId: normalizedBookId,
        errorMessage: formatAgentError(error, "历史会话初始化失败。"),
        isHydrated: true,
        status: "error",
      });
    }
  }

  async function sendMessage(request: SendMessageRequest = {}) {
    if (selectIsAgentRunActive(access.get())) {
      await steerActiveRun();
      return;
    }
    await runAgentMessage({ ...access, compactSession, ensureActiveSession, request, sessionSlot });
  }

  async function followUpMessage() {
    if (selectIsAgentRunActive(access.get())) await followUpActiveRun();
  }

  async function coachMessage() {
    if (selectIsAgentRunActive(access.get())) {
      await sessionSlot.current()?.steer(COACH_PROMPT);
      return;
    }
    await sendMessage({ options: { modeId: "book" }, promptOverride: COACH_PROMPT });
  }

  async function compactSession(reason: "manual" | "threshold" = "manual") {
    const sessionId = access.get().activeSessionId;
    if (!sessionId || selectIsAgentRunActive(access.get())) return;
    const entries = access.get().entriesBySession[sessionId] ?? [];
    access.set({ isCompacting: true, errorMessage: null });
    try {
      const result = await compactChatEntries({
        bookId: access.get().currentBookId,
        entries,
        messages: access.get().messagesBySession[sessionId] ?? [],
        providerConfig: useAgentSettingsStore.getState().config,
        sessionId,
      });
      if (!result) {
        access.set({ isCompacting: false });
        return;
      }
      applyPersistedSummary(access.set, result.summary);
      access.set((state) => ({
        compactionCount: getCompactionCount(result.entries),
        entriesBySession: { ...state.entriesBySession, [sessionId]: result.entries },
        isCompacting: false,
        latestCompactionAt: result.latestCompactionAt,
        latestCompactionTokensBefore: result.latestCompactionTokensBefore,
      }));
    } catch (error) {
      access.set({
        errorMessage: formatAgentError(error, reason === "manual" ? "压缩上下文失败。" : "自动压缩上下文失败。"),
        isCompacting: false,
      });
    }
  }

  async function hardStopCurrentRun(reason: RunInterruptReason = "manual_stop") {
    const state = access.get();
    const requestIds = [...state.inflightToolRequestIds];
    const abortController = state.abortController;
    if (!abortController && requestIds.length === 0 && !state.pendingAsk) return;

    rejectPendingAsk(state.pendingAsk);
    sessionSlot.abort(reason);
    sessionSlot.clear();
    abortController?.abort();
    applyStoppedState();
    await cancelToolRequests(requestIds);
  }

  function submitAsk(answer: AskToolAnswer) {
    submitAskAnswer(access, answer);
  }

  return { coachMessage, compactSession, hardStopCurrentRun, initialize, sendMessage, followUpMessage, submitAsk };

  async function initializeIfNeeded(bookId: string) {
    const state = access.get();
    if (state.isHydrated || state.status === "loading") return;
    await initialize(bookId);
  }

  async function steerActiveRun() {
    const text = access.get().input.trim();
    const session = sessionSlot.current();
    const sessionId = access.get().activeSessionId;
    if (!text || !session || !sessionId) return;
    await session.steer(text);
    clearDraft(sessionId);
  }

  async function followUpActiveRun() {
    const text = access.get().input.trim();
    const session = sessionSlot.current();
    const sessionId = access.get().activeSessionId;
    if (!text || !session || !sessionId) return;
    await session.followUp(text);
    clearDraft(sessionId);
  }

  function clearDraft(sessionId: string) {
    access.set((state) => ({
      ...ensureSessionState(
        state,
        sessionId,
        state.messagesBySession[sessionId] ?? [],
        "",
        state.run.status === "awaiting_user" ? "awaiting_user" : "running",
      ),
    }));
    void setChatDraft(sessionId, "").catch(() => access.set({ errorMessage: "草稿保存失败。" }));
  }

  function applyStoppedState() {
    const state = access.get();
    const sessionId = state.activeSessionId;
    const messages = sessionId ? state.messagesBySession[sessionId] ?? [] : [];
    const assistant = messages[messages.length - 1];
    const removePlaceholder = Boolean(sessionId && assistant?.role === "assistant" && isPlaceholderOnly(assistant));
    const nextMessages = removePlaceholder ? messages.slice(0, -1) : messages;
    const nextEntries = removePlaceholder
      ? removeEntry(state.entriesBySession[sessionId ?? ""] ?? [], assistant?.id ?? "")
      : state.entriesBySession[sessionId ?? ""] ?? [];

    access.set((current) => {
      const base = {
        abortController: null,
        activeRunRequestId: null,
        inflightToolRequestIds: [],
        pendingAsk: null,
        queuedFollowUpMessages: [],
        queuedSteeringMessages: [],
      };
      if (!sessionId) return base;
      return {
        ...base,
        entriesBySession: { ...current.entriesBySession, [sessionId]: nextEntries },
        ...ensureSessionState(current, sessionId, nextMessages, "", "idle"),
      };
    });
  }
}
