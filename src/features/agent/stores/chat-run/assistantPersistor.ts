import { updateChatEntry } from "@features/agent/chat/api";
import { buildSessionPatch } from "@features/agent/chat/sessionRuntime";
import type { AgentMessage, AgentRunStatus } from "@features/agent/lib/types";
import type { ChatSessionSummary } from "@features/agent/chat/types";
import { applyPersistedSummary, formatAgentError } from "./helpers";
import type { ChatRunStoreAccess } from "./runtimeTypes";

const RUNNING_PERSIST_DELAY_MS = 2000;

type AssistantPersistorParams = ChatRunStoreAccess & {
  // CP-F：goal 内循环后一次 run 可能产生多条 assistant 消息（每轮一条）。
  // 用回调返回「当前活动 assistant 消息 id」，而非固定绑死首条，否则续轮新消息不会落盘。
  getActiveAssistantMessageId: () => string;
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
    const activeId = params.getActiveAssistantMessageId();
    if (!sessionId || !assistant || assistant.id !== activeId) return;
    await persistSummary(updateChatEntry(
      params.currentBookId(),
      sessionId,
      activeId,
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
      }, RUNNING_PERSIST_DELAY_MS);
    },
    wait: () => chain,
  };
}
