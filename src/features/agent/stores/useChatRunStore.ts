/**
 * 写作会话运行 Store：只持 UI 状态和 action 出口。
 *
 * Agent 运行、ask、entry 持久化、上下文压缩等编排放在 chatRun 子模块。
 */

import { create } from "zustand";
import { createChatSession, deleteChatSession, setChatDraft, switchChatSession } from "@features/agent/chat/api";
import type { AskToolAnswer } from "@features/agent/lib/types";
import type { AgentMode } from "@features/agent/lib/modeRules";
import type { ManualTurnContextSelection } from "@features/agent/lib/manualTurnContext";
import {
  buildInitialState,
  DEFAULT_CHAT_BOOK_ID,
  ensureSessionState,
  formatAgentError,
  selectIsAgentRunActive,
  type ChatRunStoreState,
} from "./chat-run/helpers";
import { applyBootstrap } from "./chat-run/bootstrapState";
import { createChatRuntimeController } from "./chat-run/runtimeController";
import type { RunInterruptReason } from "./chat-run/runtimeTypes";

type ChatRunStoreActions = {
  closeHistory: () => void;
  coachMessage: () => Promise<void>;
  compactSession: (reason?: "manual") => Promise<void>;
  createNewSession: () => Promise<void>;
  addManualContextFile: (path: string) => void;
  clearManualContextSelection: () => void;
  deleteSession: (sessionId: string) => Promise<void>;
  followUpMessage: (selection?: ManualTurnContextSelection) => Promise<void>;
  hardStopCurrentRun: (reason?: RunInterruptReason) => Promise<void>;
  initialize: (bookId?: string | null) => Promise<void>;
  openHistory: () => void;
  reset: () => void;
  sendMessage: (selection?: ManualTurnContextSelection) => Promise<void>;
  setActiveMode: (modeId: AgentMode) => void;
  setManualContextSelection: (selection: ManualTurnContextSelection) => void;
  setInput: (value: string) => void;
  stopMessage: () => void;
  submitAskAnswer: (answer: AskToolAnswer) => void;
  switchSession: (sessionId: string) => Promise<void>;
};

export type ChatRunStore = ChatRunStoreState & ChatRunStoreActions;
export { selectIsAgentRunActive };

export const useChatRunStore = create<ChatRunStore>((set, get) => {
  const runtime = createChatRuntimeController({ get, set });

  return {
    ...buildInitialState(),
    closeHistory: () => set({ isHistoryOpen: false }),
    coachMessage: () => runtime.coachMessage(),
    compactSession: (reason = "manual") => runtime.compactSession(reason),
    addManualContextFile: (path) => {
      set((state) => {
        if (state.manualContextSelection.filePaths.includes(path)) {
          return {};
        }
        return {
          manualContextSelection: {
            ...state.manualContextSelection,
            filePaths: [...state.manualContextSelection.filePaths, path],
          },
        };
      });
    },
    clearManualContextSelection: () => {
      set({ manualContextSelection: { filePaths: [], skillIds: [] } });
    },
    createNewSession: async () => {
      if (selectIsAgentRunActive(get())) return;
      try {
        const bootstrap = await createChatSession(get().currentBookId ?? DEFAULT_CHAT_BOOK_ID);
        set((state) => ({ ...applyBootstrap(state, bootstrap), isHistoryOpen: false }));
      } catch (error) {
        set({ errorMessage: formatAgentError(error, "创建新对话失败。") });
      }
    },
    deleteSession: async (sessionId) => {
      if (selectIsAgentRunActive(get())) return;
      try {
        const bootstrap = await deleteChatSession(get().currentBookId ?? DEFAULT_CHAT_BOOK_ID, sessionId);
        set((state) => ({ ...applyBootstrap(state, bootstrap) }));
      } catch (error) {
        set({ errorMessage: formatAgentError(error, "删除历史会话失败。") });
      }
    },
    followUpMessage: async (selection) => {
      void selection;
      await runtime.followUpMessage();
    },
    hardStopCurrentRun: (reason = "manual_stop") => runtime.hardStopCurrentRun(reason),
    initialize: (bookId = DEFAULT_CHAT_BOOK_ID) => runtime.initialize(bookId ?? DEFAULT_CHAT_BOOK_ID),
    openHistory: () => set({ isHistoryOpen: true }),
    reset: () => {
      void runtime.hardStopCurrentRun("reset");
      set(buildInitialState());
    },
    sendMessage: (selection) => runtime.sendMessage({ selection }),
    setActiveMode: (modeId) => {
      if (!selectIsAgentRunActive(get())) set({ activeModeId: modeId });
    },
    setManualContextSelection: (selection) => {
      set({
        manualContextSelection: {
          filePaths: Array.from(new Set(selection.filePaths)),
          skillIds: Array.from(new Set(selection.skillIds)),
        },
      });
    },
    setInput: (value) => setInputDraft({ get, set }, value),
    stopMessage: () => {
      void runtime.hardStopCurrentRun("manual_stop");
    },
    submitAskAnswer: (answer) => runtime.submitAsk(answer),
    switchSession: async (sessionId) => {
      if (selectIsAgentRunActive(get()) || sessionId === get().activeSessionId) {
        set({ isHistoryOpen: false });
        return;
      }
      try {
        const bootstrap = await switchChatSession(get().currentBookId ?? DEFAULT_CHAT_BOOK_ID, sessionId);
        set((state) => ({ ...applyBootstrap(state, bootstrap), isHistoryOpen: false }));
      } catch (error) {
        set({ errorMessage: formatAgentError(error, "切换历史会话失败。") });
      }
    },
  };
});

function setInputDraft(access: Pick<Parameters<typeof createChatRuntimeController>[0], "get" | "set">, value: string) {
  const sessionId = access.get().activeSessionId;
  access.set((state) => {
    if (!sessionId) return { input: value };
    return {
      ...ensureSessionState(
        state,
        sessionId,
        state.messagesBySession[sessionId] ?? [],
        value,
        state.run.status,
      ),
    };
  });

  if (!sessionId) return;
  void setChatDraft(sessionId, value).catch(() => {
    access.set({ errorMessage: "草稿保存失败。" });
  });
}
