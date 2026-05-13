import { appendChatEntry, deleteChatEntry } from "@features/agent/chat/api";
import { derivePlanningState } from "@features/agent/lib/planning";
import {
  buildInitialRun,
  buildMessageMeta,
  buildRun,
  buildSessionPatch,
  buildSystemMessage,
  deriveSessionTitle,
} from "@features/agent/chat/sessionRuntime";
import { formatProviderError } from "@features/agent/lib/errorFormatting";
import type { AgentMessage, AgentRunStatus } from "@features/agent/lib/types";
import type { ChatEntry, ChatSessionSummary } from "@features/agent/chat/types";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import {
  DEFAULT_CHAT_BOOK_ID,
  ensureSessionState,
  formatAgentError,
  resolveAbortedAssistantState,
} from "./helpers";
import { appendMessageEntry, removeEntry, replaceMessageEntry } from "./entriesRuntime";
import { rejectPendingAsk } from "./askController";
import { isRunInterruptReason, type ChatRunStoreAccess } from "./runtimeTypes";

export type TerminalRunState = {
  latestEntries: ChatEntry[];
  latestMessages: AgentMessage[];
  sessionId: string | null;
};

type TerminalHandlerParams = ChatRunStoreAccess & {
  abortController: AbortController;
  assistantMessage: AgentMessage;
  flushAssistant: (status: AgentRunStatus) => Promise<void>;
  messageMeta: ReturnType<typeof buildMessageMeta>;
  persistSummary: (promise: Promise<ChatSessionSummary>) => Promise<void>;
  providerConfig: AgentProviderConfig;
  runRequestId: string;
  state: TerminalRunState;
};

export async function handleTerminalError(error: unknown, params: TerminalHandlerParams) {
  if (isExplicitRunInterrupt(params.abortController.signal)) {
    await handleAbort(params);
    return;
  }
  await handleFailure(error, params);
}

function isExplicitRunInterrupt(signal: AbortSignal) {
  return signal.aborted && isRunInterruptReason(signal.reason);
}

function currentBookId(params: TerminalHandlerParams) {
  return params.get().currentBookId ?? DEFAULT_CHAT_BOOK_ID;
}

async function handleAbort(params: TerminalHandlerParams) {
  rejectPendingAsk(params.get().pendingAsk);
  const abortedState = resolveAbortedAssistantState(
    params.state.latestMessages,
    params.assistantMessage.id,
  );
  params.state.latestMessages = abortedState.messages;
  params.state.latestEntries = abortedState.removePlaceholder
    ? removeEntry(params.state.latestEntries, params.assistantMessage.id)
    : replaceMessageEntry(params.state.latestEntries, abortedState.assistant ?? params.assistantMessage);
  applyAbortState(params);
  if (!params.state.sessionId) return;
  if (abortedState.removePlaceholder && abortedState.assistant) {
    await params.persistSummary(deleteChatEntry(
      currentBookId(params),
      params.state.sessionId,
      abortedState.assistant.id,
      buildSessionPatch(params.state.latestMessages, "idle"),
    ));
    return;
  }
  await params.flushAssistant("idle");
}

function applyAbortState(params: TerminalHandlerParams) {
  if (params.get().activeRunRequestId !== params.runRequestId) return;
  params.set((state) => {
    const base = resetRunPatch();
    if (!params.state.sessionId) {
      return { ...base, planningState: derivePlanningState(params.state.latestMessages), run: buildInitialRun() };
    }
    return {
      ...base,
      entriesBySession: {
        ...state.entriesBySession,
        [params.state.sessionId]: params.state.latestEntries,
      },
      ...ensureSessionState(
        state,
        params.state.sessionId,
        params.state.latestMessages,
        "",
        "idle",
      ),
    };
  });
}

async function handleFailure(error: unknown, params: TerminalHandlerParams) {
  if (params.get().activeRunRequestId !== params.runRequestId) return;
  const systemMessage = buildSystemMessage(
    formatProviderError(error, "Agent 执行失败，请稍后重试。", {
      baseURL: params.providerConfig.baseURL,
      model: params.providerConfig.model,
    }),
    params.messageMeta,
  );
  params.state.latestMessages = [...params.state.latestMessages, systemMessage];
  params.state.latestEntries = appendMessageEntry(params.state.latestEntries, systemMessage);
  applyFailureState(error, params);
  if (!params.state.sessionId) return;
  await params.persistSummary(appendChatEntry(
    currentBookId(params),
    params.state.sessionId,
    { id: systemMessage.id, entryType: "message", payload: { message: systemMessage } },
    buildSessionPatch(params.state.latestMessages, "failed"),
  ));
}

function applyFailureState(error: unknown, params: TerminalHandlerParams) {
  params.set((state) => {
    const base = {
      ...resetRunPatch(),
      errorMessage: formatAgentError(error, "Agent 执行失败，请稍后重试。"),
    };
    if (!params.state.sessionId) {
      return {
        ...base,
        planningState: derivePlanningState(params.state.latestMessages),
        run: buildRun(
          "failed-run",
          deriveSessionTitle(params.state.latestMessages),
          "failed",
          params.state.latestMessages,
        ),
      };
    }
    return {
      ...base,
      entriesBySession: {
        ...state.entriesBySession,
        [params.state.sessionId]: params.state.latestEntries,
      },
      ...ensureSessionState(
        state,
        params.state.sessionId,
        params.state.latestMessages,
        "",
        "failed",
      ),
    };
  });
}

function resetRunPatch() {
  return {
    abortController: null,
    activeRunRequestId: null,
    inflightToolRequestIds: [],
    pendingAsk: null,
    queuedFollowUpMessages: [],
    queuedSteeringMessages: [],
  };
}
