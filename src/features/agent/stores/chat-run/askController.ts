import type { AskToolAnswer, AskUserRequest, AgentMessage } from "@features/agent/lib/types";
import { ensureSessionState, type PendingAskState } from "./helpers";
import type { ChatRunStoreAccess } from "./runtimeTypes";

const ASK_INTERRUPTED_MESSAGE = "等待用户输入的交互已中断，请重新发起。";

export type AskHandlerParams = ChatRunStoreAccess & {
  assistantMessageId: string;
  getLatestMessages: () => AgentMessage[];
  getSessionId: () => string | null;
  isCurrentRun: () => boolean;
  runRequestId: string;
  setPendingAsk: (pendingAsk: PendingAskState | null) => void;
};

export function createAskHandler(params: AskHandlerParams) {
  return ({ request, toolCallId }: { request: AskUserRequest; toolCallId: string }) =>
    new Promise<AskToolAnswer>((resolve, reject) => {
      const sessionId = params.getSessionId();
      if (!sessionId || !params.isCurrentRun()) {
        reject(new Error("当前会话已失效，无法等待用户回答。"));
        return;
      }

      const pendingAsk = buildPendingAsk(params, request, toolCallId, resolve, reject);
      params.setPendingAsk(pendingAsk);
      params.set((state) => {
        const activeSessionId = params.getSessionId();
        if (state.activeRunRequestId !== params.runRequestId || !activeSessionId) {
          pendingAsk.reject(new Error("当前会话已失效，无法等待用户回答。"));
          return state;
        }
        return {
          pendingAsk,
          ...ensureSessionState(
            state,
            activeSessionId,
            state.messagesBySession[activeSessionId] ?? params.getLatestMessages(),
            "",
            "awaiting_user",
          ),
        };
      });
    });
}

export function rejectPendingAsk(pendingAsk: PendingAskState | null) {
  pendingAsk?.reject(new Error(ASK_INTERRUPTED_MESSAGE));
}

export function submitAskAnswer({ get, set }: ChatRunStoreAccess, answer: AskToolAnswer) {
  const pendingAsk = get().pendingAsk;
  const sessionId = get().activeSessionId;
  if (!pendingAsk || !sessionId) return;

  set((state) => ({
    pendingAsk: null,
    ...ensureSessionState(
      state,
      sessionId,
      state.messagesBySession[sessionId] ?? [],
      "",
      "running",
    ),
  }));
  pendingAsk.resolve(answer);
}

function buildPendingAsk(
  params: AskHandlerParams,
  request: AskUserRequest,
  toolCallId: string,
  resolve: (answer: AskToolAnswer) => void,
  reject: (error?: unknown) => void,
): PendingAskState {
  return {
    messageId: params.assistantMessageId,
    request,
    resolve: (answer) => {
      params.setPendingAsk(null);
      resolve(answer);
    },
    reject: (error) => {
      params.setPendingAsk(null);
      reject(error);
    },
    toolCallId,
  };
}
