import { updateChatEntry } from "../../lib/chat/api";
import { buildSessionPatch } from "../../lib/chat/sessionRuntime";
import type { AgentMessage, AgentRunStatus } from "../../lib/agent/types";
import type { ChatSessionSummary } from "../../lib/chat/types";
import { applyPersistedSummary, formatAgentError } from "./helpers";
import type { ChatRunStoreAccess } from "./runtimeTypes";

type AssistantPersistorParams = ChatRunStoreAccess & {
  assistantMessageId: string;
  currentBookId: () => string;
  getMessages: () => AgentMessage[];
  getSessionId: () => string | null;
  resolveStatus: () => AgentRunStatus;
};

export function createAssistantPersistor(params: AssistantPersistorParams) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain = Promise.resolve();

  async function persistSummary(promise: Promise<ChatSessionSummary>) {
    try {
      applyPersistedSummary(params.set, await promise);
    } catch (error) {
      params.set({ errorMessage: formatAgentError(error, "历史会话保存失败。") });
    }
  }

  async function flush(status: AgentRunStatus) {
    const sessionId = params.getSessionId();
    const messages = params.getMessages();
    const assistant = messages[messages.length - 1];
    if (!sessionId || !assistant || assistant.id !== params.assistantMessageId) return;
    await persistSummary(updateChatEntry(
      params.currentBookId(),
      sessionId,
      params.assistantMessageId,
      { message: assistant },
      buildSessionPatch(messages, status),
    ));
  }

  return {
    clearTimer: () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    },
    flush,
    persistSummary,
    schedule: () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        chain = chain.then(() => flush(params.resolveStatus()));
      }, 350);
    },
    wait: () => chain,
  };
}
