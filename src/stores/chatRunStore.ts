/**
 * 聊天运行 Store（chatRunStore）：管理写作模式下与主 agent 的会话、运行态、历史。
 *
 * 历史名称为 agentStore；为消歧义（避免与 subAgentStore / agentSettingsStore 混淆）改名。
 * 老路径 `stores/agentStore.ts` 仍保留 re-export 兼容旧 import。
 *
 * 边界约束：
 *   - 本 store 只持状态与 actions；toolset 装配走 lib/agent/toolsets/factory。
 *   - 通用辅助函数（applyBootstrap / ensureSessionState / formatAgentError 等）放在 helpers.ts。
 */

import { create } from "zustand";
import {
  appendChatMessage,
  createChatSession,
  deleteChatMessage,
  deleteChatSession,
  initializeChatStorage,
  setChatDraft,
  switchChatSession,
  updateChatMessage,
} from "../lib/chat/api";
import { readWorkspaceTextFile, readWorkspaceTree, cancelToolRequests } from "../lib/bookWorkspace/api";
import type { ChatSessionSummary } from "../lib/chat/types";
import {
  buildAssistantPlaceholderMessage,
  buildInitialRun,
  buildMessageMeta,
  buildRun,
  buildSessionPatch,
  buildSystemMessage,
  buildUserMessage,
  deriveSessionTitle,
  isPlaceholderOnly,
  mergePart,
} from "../lib/chat/sessionRuntime";
import { useAgentSettingsStore } from "./agentSettingsStore";
import { resolveManualTurnContext, type ManualTurnContextSelection } from "../lib/agent/manualTurnContext";
import { loadProjectContext } from "../lib/agent/projectContext";
import { formatProviderError } from "../lib/agent/errorFormatting";
import { derivePlanningState } from "../lib/agent/planning";
import { runAgentTurn } from "../lib/agent/session";
import { buildBookWorkspaceTools } from "../lib/agent/toolsets/factory";
import type {
  AgentRunStatus,
  AgentPart,
  AgentUsage,
  AskToolAnswer,
  AskUserRequest,
} from "../lib/agent/types";
import { useBookWorkspaceStore } from "./bookWorkspaceStore";
import { getEnabledSkills, useSkillsStore } from "./skillsStore";
import { getEnabledAgents, useSubAgentStore } from "./subAgentStore";
import {
  applyBootstrap,
  applyPersistedSummary,
  buildInitialState,
  buildRunRequestId,
  DEFAULT_CHAT_BOOK_ID,
  ensureAgentSettingsReady,
  ensureMainAgentMarkdown,
  ensureSessionState,
  formatAgentError,
  resolveAbortedAssistantState,
  selectIsAgentRunActive,
  trackInflightToolRequest,
  type ChatRunStoreState,
  type PendingAskState,
} from "./chatRun/helpers";

type RunInterruptReason = "manual_stop" | "app_close" | "restart" | "reset" | "coach";

type ChatRunStoreActions = {
  closeHistory: () => void;
  coachMessage: () => Promise<void>;
  createNewSession: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  hardStopCurrentRun: (reason?: RunInterruptReason) => Promise<void>;
  initialize: (bookId?: string | null) => Promise<void>;
  openHistory: () => void;
  reset: () => void;
  sendMessage: (selection?: ManualTurnContextSelection) => Promise<void>;
  setInput: (value: string) => void;
  stopMessage: () => void;
  submitAskAnswer: (answer: AskToolAnswer) => void;
  switchSession: (sessionId: string) => Promise<void>;
};

export type ChatRunStore = ChatRunStoreState & ChatRunStoreActions;

// 兼容旧名导出：新代码请使用 ChatRunStore。
export type AgentStore = ChatRunStore;
export { selectIsAgentRunActive };

const COACH_PROMPT =
  "你刚才中断或偏离了目标。先用一句话说明当前进展，然后严格回到原始任务继续执行；如果之前的方案无效，立刻换一种方案，不要重复已失败的步骤。";

async function cancelInflightToolRequests(requestIds: string[]) {
  await cancelToolRequests(requestIds);
}

export const useChatRunStore = create<ChatRunStore>((set, get) => {
  /** 确保存在一个活动会话；若尚未 hydrated 会先 initialize。 */
  async function ensureActiveSession() {
    const bookId = get().currentBookId ?? DEFAULT_CHAT_BOOK_ID;

    if (get().activeSessionId) {
      return get().activeSessionId;
    }

    if (!get().isHydrated && get().status !== "loading") {
      await get().initialize(bookId);
      if (get().activeSessionId) {
        return get().activeSessionId;
      }
    }

    const bootstrap = await createChatSession(bookId);
    set((state) => ({
      ...state,
      ...applyBootstrap(state, bootstrap),
      isHistoryOpen: false,
    }));
    return bootstrap.activeSessionId;
  }

  /**
   * 实际执行一次发送：组参 → 调用 runAgentTurn → 流式合并 part → 写库。
   * 这是一个状态机（abort/error/usage 等多分支），保持单函数完整性更便于审视。
   */
  async function sendMessageInternal(
    promptOverride: string | null,
    selection?: ManualTurnContextSelection,
  ) {
    const nextInput = promptOverride ?? get().input.trim();
    if (!nextInput) return;

    const abortController = new AbortController();
    const runRequestId = buildRunRequestId();
    const optimisticSessionId = get().activeSessionId;
    let pendingAsk: PendingAskState | null = null;
    const conversationHistory = optimisticSessionId
      ? (get().messagesBySession[optimisticSessionId] ?? [])
      : [];
    const workspaceState = useBookWorkspaceStore.getState();
    const messageMeta = buildMessageMeta(workspaceState.rootPath, workspaceState.activeFilePath);
    const userMessage = buildUserMessage(nextInput, messageMeta);
    const assistantMessage = buildAssistantPlaceholderMessage(messageMeta);
    let sessionId: string | null = optimisticSessionId;
    let latestMessages = [...conversationHistory, userMessage, assistantMessage];
    let persistTimer: ReturnType<typeof setTimeout> | null = null;
    let persistChain = Promise.resolve();

    const isCurrentRun = () => {
      const state = get();
      return state.activeRunRequestId === runRequestId && !abortController.signal.aborted;
    };

    const persistSummary = async (promise: Promise<ChatSessionSummary>) => {
      try {
        applyPersistedSummary(set, await promise);
      } catch (error) {
        set({ errorMessage: formatAgentError(error, "历史会话保存失败。") });
      }
    };

    const resolveActiveRunStatus = (): AgentRunStatus => {
      const state = get();
      if (state.pendingAsk || state.run.status === "awaiting_user") {
        return "awaiting_user";
      }
      return "running";
    };

    const flushAssistant = async (status: AgentRunStatus) => {
      if (!sessionId) return;
      const assistant = latestMessages[latestMessages.length - 1];
      if (!assistant || assistant.id !== assistantMessage.id) return;

      await persistSummary(
        updateChatMessage(
          get().currentBookId ?? DEFAULT_CHAT_BOOK_ID,
          sessionId,
          assistantMessage.id,
          assistant.parts,
          assistant.meta,
          buildSessionPatch(latestMessages, status),
        ),
      );
    };

    const scheduleAssistantPersist = () => {
      if (persistTimer) return;
      persistTimer = setTimeout(() => {
        persistTimer = null;
        persistChain = persistChain.then(() => flushAssistant(resolveActiveRunStatus()));
      }, 350);
    };

    const attachUsageToAssistant = (usage: AgentUsage) => {
      if (!isCurrentRun() || !sessionId) return;

      const currentSessionId = sessionId;
      set((state) => {
        if (state.activeRunRequestId !== runRequestId) return state;
        const messages = [...(state.messagesBySession[currentSessionId] ?? [])];
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage || lastMessage.id !== assistantMessage.id) return state;

        messages[messages.length - 1] = {
          ...lastMessage,
          meta: {
            ...(lastMessage.meta ?? {}),
            usage,
          },
        };
        latestMessages = messages;
        const nextStatus = state.pendingAsk || state.run.status === "awaiting_user"
          ? "awaiting_user"
          : "running";
        return ensureSessionState(state, currentSessionId, messages, "", nextStatus);
      });
    };

    // 1. 立即更新 UI：先把 user + 占位 assistant 推上去。
    set((state) => {
      if (!optimisticSessionId) {
        return {
          abortController,
          activeRunRequestId: runRequestId,
          inflightToolRequestIds: [],
          errorMessage: null,
          input: "",
          planningState: derivePlanningState(latestMessages),
          run: buildRun(
            "pending-session",
            deriveSessionTitle(latestMessages),
            "running",
            latestMessages,
          ),
        };
      }
      return {
        abortController,
        activeRunRequestId: runRequestId,
        inflightToolRequestIds: [],
        errorMessage: null,
        ...ensureSessionState(state, optimisticSessionId, latestMessages, "", "running"),
      };
    });

    if (optimisticSessionId) {
      void setChatDraft(optimisticSessionId, "");
    }

    let providerConfig = useAgentSettingsStore.getState().config;

    try {
      // 2. 确保有活动 session 并把消息持久化。
      sessionId = await ensureActiveSession();
      if (!sessionId) throw new Error("创建会话失败。");
      if (!isCurrentRun()) return;

      const persistedConversationHistory =
        sessionId === optimisticSessionId
          ? conversationHistory
          : (get().messagesBySession[sessionId] ?? []);
      latestMessages = [...persistedConversationHistory, userMessage, assistantMessage];
      const currentSessionId = sessionId;
      set((state) => ({
        abortController,
        activeRunRequestId: runRequestId,
        inflightToolRequestIds: [],
        errorMessage: null,
        ...ensureSessionState(state, currentSessionId, latestMessages, "", "running"),
      }));
      void setChatDraft(currentSessionId, "");

      const currentBookId = get().currentBookId ?? DEFAULT_CHAT_BOOK_ID;
      await persistSummary(
        appendChatMessage(
          currentBookId,
          sessionId,
          userMessage,
          buildSessionPatch(latestMessages, "running"),
        ),
      );
      await persistSummary(appendChatMessage(currentBookId, sessionId, assistantMessage));

      // 3. 读取本轮所需的 provider / 工具 / agent 配置。
      await ensureAgentSettingsReady();
      if (!isCurrentRun()) return;

      providerConfig = useAgentSettingsStore.getState().config;
      const enabledSkills = getEnabledSkills(useSkillsStore.getState());
      const enabledAgents = getEnabledAgents(useSubAgentStore.getState());
      const enabledToolsMap = useAgentSettingsStore.getState().enabledTools;
      const defaultAgentMarkdown = await ensureMainAgentMarkdown();
      if (!isCurrentRun()) return;

      const enabledToolIds = Object.entries(enabledToolsMap)
        .filter(([, value]) => value)
        .map(([toolId]) => toolId);
      const manualContext = selection
        ? await resolveManualTurnContext({
            activeFilePath: workspaceState.activeFilePath,
            draftContent: workspaceState.draftContent,
            enabledAgents,
            enabledSkills,
            readFile: readWorkspaceTextFile,
            selection,
            workspaceRootPath: workspaceState.rootPath,
          })
        : null;
      const projectContext = await loadProjectContext({
            readFile: readWorkspaceTextFile,
            readTree: readWorkspaceTree,
            workspaceRootPath: workspaceState.rootPath,
          });
      const handleAskUser = ({
        request,
        toolCallId,
      }: {
        request: AskUserRequest;
        toolCallId: string;
      }) =>
        new Promise<AskToolAnswer>((resolve, reject) => {
          if (!sessionId || !isCurrentRun()) {
            reject(new Error("当前会话已失效，无法等待用户回答。"));
            return;
          }

          pendingAsk = {
            messageId: assistantMessage.id,
            request,
            resolve: (answer) => {
              pendingAsk = null;
              resolve(answer);
            },
            reject: (error) => {
              pendingAsk = null;
              reject(error);
            },
            toolCallId,
          };

          set((state) => {
            if (state.activeRunRequestId !== runRequestId || !sessionId) {
              pendingAsk?.reject(new Error("当前会话已失效，无法等待用户回答。"));
              return state;
            }
            return {
              pendingAsk,
              ...ensureSessionState(
                state,
                sessionId,
                state.messagesBySession[sessionId] ?? latestMessages,
                "",
                "awaiting_user",
              ),
            };
          });
        });
      if (!isCurrentRun()) return;

      const planningState = derivePlanningState(persistedConversationHistory);
      // 写作模式默认 toolset：global + workspace + localResource，统一通过工厂装配。
      const workspaceTools = buildBookWorkspaceTools({
        rootPath: workspaceState.rootPath,
        includeAsk: true,
      });

      // 4. 调用 LLM 流式接口，逐 part 合并到 assistant 消息。
      const stream = runAgentTurn({
        abortSignal: abortController.signal,
        activeFilePath: workspaceState.activeFilePath,
        debugLabel: `chat-session:${sessionId}`,
        workspaceRootPath: workspaceState.rootPath,
        conversationHistory: persistedConversationHistory,
        defaultAgentMarkdown,
        enabledAgents,
        enabledSkills,
        enabledToolIds,
        mode: "book",
        manualContext,
        onAskUser: handleAskUser,
        onUsage: attachUsageToAssistant,
        planningState,
        projectContext,
        prompt: nextInput,
        providerConfig,
        workspaceTools,
        onToolRequestStateChange: ({ requestId, status }) => {
          if (!isCurrentRun() && status === "start") return;
          trackInflightToolRequest(set, requestId, status === "start" ? "start" : "finish");
        },
      });

      for await (const part of stream) {
        if (!isCurrentRun()) return;

        const activeSessionId = sessionId;
        set((state) => {
          if (state.activeRunRequestId !== runRequestId) return state;
          const messages = [...(state.messagesBySession[activeSessionId] ?? [])];
          const lastMessage = messages[messages.length - 1];
          if (lastMessage?.role !== "assistant") return state;

          messages[messages.length - 1] = {
            ...lastMessage,
            parts: mergePart(lastMessage.parts, part as AgentPart),
          };
          latestMessages = messages;
          scheduleAssistantPersist();
          return {
            pendingAsk: part.type === "ask-user" && part.status === "completed"
              ? null
              : state.pendingAsk,
            ...ensureSessionState(
              state,
              activeSessionId,
              messages,
              "",
              part.type === "ask-user" && part.status === "awaiting_user"
                ? "awaiting_user"
                : "running",
            ),
          };
        });
      }

      // 5. 流式结束后落库 + 切回 idle 态。
      if (persistTimer) {
        window.clearTimeout(persistTimer);
        persistTimer = null;
      }
      await persistChain;
      if (!isCurrentRun()) return;

      const completedSessionId = sessionId;
      set((state) => ({
        abortController: null,
        activeRunRequestId:
          state.activeRunRequestId === runRequestId ? null : state.activeRunRequestId,
        inflightToolRequestIds: [],
        pendingAsk: null,
        ...ensureSessionState(state, completedSessionId, latestMessages, "", "completed"),
      }));
      await flushAssistant("completed");
    } catch (error) {
      // 6. abort / 失败的两条路径分别处理。
      if (persistTimer) {
        window.clearTimeout(persistTimer);
        persistTimer = null;
      }
      await persistChain;

      if (abortController.signal.aborted) {
        const interruptedPendingAsk = get().pendingAsk;
        if (interruptedPendingAsk) {
          interruptedPendingAsk.reject(new Error("等待用户输入的交互已中断，请重新发起。"));
        }
        const abortedState = resolveAbortedAssistantState(latestMessages, assistantMessage.id);
        latestMessages = abortedState.messages;
        if (get().activeRunRequestId === runRequestId) {
          set((state) => {
            if (!sessionId) {
              return {
                abortController: null,
                activeRunRequestId: null,
                inflightToolRequestIds: [],
                pendingAsk: null,
                planningState: derivePlanningState(latestMessages),
                run: buildInitialRun(),
              };
            }
            return {
              abortController: null,
              activeRunRequestId: null,
              inflightToolRequestIds: [],
              pendingAsk: null,
              ...ensureSessionState(state, sessionId, latestMessages, "", "idle"),
            };
          });
        }
        if (sessionId && abortedState.removePlaceholder && abortedState.assistant) {
          await persistSummary(
            deleteChatMessage(
              get().currentBookId ?? DEFAULT_CHAT_BOOK_ID,
              sessionId,
              abortedState.assistant.id,
              buildSessionPatch(latestMessages, "idle"),
            ),
          );
          return;
        }
        await flushAssistant("idle");
        return;
      }

      if (get().activeRunRequestId !== runRequestId) return;

      const systemMessage = buildSystemMessage(
        formatProviderError(error, "Agent 执行失败，请稍后重试。", {
          baseURL: providerConfig.baseURL,
          model: providerConfig.model,
        }),
        messageMeta,
      );
      latestMessages = [...latestMessages, systemMessage];
      set((state) => {
        if (!sessionId) {
          return {
            abortController: null,
            activeRunRequestId: null,
            inflightToolRequestIds: [],
            pendingAsk: null,
            errorMessage: formatAgentError(error, "Agent 执行失败，请稍后重试。"),
            planningState: derivePlanningState(latestMessages),
            run: buildRun(
              "failed-run",
              deriveSessionTitle(latestMessages),
              "failed",
              latestMessages,
            ),
          };
        }
        return {
          abortController: null,
          activeRunRequestId: null,
          inflightToolRequestIds: [],
          pendingAsk: null,
          ...ensureSessionState(state, sessionId, latestMessages, "", "failed"),
        };
      });
      if (sessionId) {
        await persistSummary(
          appendChatMessage(
            get().currentBookId ?? DEFAULT_CHAT_BOOK_ID,
            sessionId,
            systemMessage,
            buildSessionPatch(latestMessages, "failed"),
          ),
        );
      }
    }
  }

  return {
    ...buildInitialState(),
    closeHistory: () => set({ isHistoryOpen: false }),
    createNewSession: async () => {
      const bookId = get().currentBookId ?? DEFAULT_CHAT_BOOK_ID;
      if (selectIsAgentRunActive(get())) return;
      try {
        const bootstrap = await createChatSession(bookId);
        set((state) => ({
          ...state,
          ...applyBootstrap(state, bootstrap),
          isHistoryOpen: false,
        }));
      } catch (error) {
        set({ errorMessage: formatAgentError(error, "创建新对话失败。") });
      }
    },
    deleteSession: async (sessionId) => {
      if (selectIsAgentRunActive(get())) return;
      try {
        const bookId = get().currentBookId ?? DEFAULT_CHAT_BOOK_ID;
        const bootstrap = await deleteChatSession(bookId, sessionId);
        set((state) => ({ ...state, ...applyBootstrap(state, bootstrap) }));
      } catch (error) {
        set({ errorMessage: formatAgentError(error, "删除历史会话失败。") });
      }
    },
    initialize: async (bookId = DEFAULT_CHAT_BOOK_ID) => {
      const normalizedBookId = bookId ?? DEFAULT_CHAT_BOOK_ID;
      const state = get();
      if (
        state.status === "loading" ||
        (state.isHydrated && state.currentBookId === normalizedBookId)
      ) {
        return;
      }

      if (selectIsAgentRunActive(state)) {
        await get().hardStopCurrentRun("restart");
      }

      set({
        ...buildInitialState(),
        currentBookId: normalizedBookId,
        errorMessage: null,
        status: "loading",
      });
      try {
        const bootstrap = await initializeChatStorage(normalizedBookId);
        set((state) => ({ ...state, ...applyBootstrap(state, bootstrap) }));
      } catch (error) {
        set({
          currentBookId: normalizedBookId,
          errorMessage: formatAgentError(error, "历史会话初始化失败。"),
          isHydrated: true,
          status: "error",
        });
      }
    },
    openHistory: () => set({ isHistoryOpen: true }),
    hardStopCurrentRun: async (_reason = "manual_stop") => {
      const state = get();
      const abortController = state.abortController;
      const requestIds = [...state.inflightToolRequestIds];
      const sessionId = state.activeSessionId;
      const pendingAsk = state.pendingAsk;
      const messages = sessionId ? (state.messagesBySession[sessionId] ?? []) : [];
      const assistant = messages[messages.length - 1];
      const shouldRemovePlaceholder = Boolean(
        sessionId && assistant?.role === "assistant" && isPlaceholderOnly(assistant),
      );
      const nextMessages = shouldRemovePlaceholder ? messages.slice(0, -1) : messages;

      if (!abortController && requestIds.length === 0 && !pendingAsk) return;

      pendingAsk?.reject(new Error("等待用户输入的交互已中断，请重新发起。"));
      abortController?.abort();
      set((current) => {
        if (!sessionId) {
          return {
            abortController: null,
            activeRunRequestId: null,
            inflightToolRequestIds: [],
            pendingAsk: null,
          };
        }
        return {
          abortController: null,
          activeRunRequestId: null,
          inflightToolRequestIds: [],
          pendingAsk: null,
          ...ensureSessionState(current, sessionId, nextMessages, "", "idle"),
        };
      });

      await cancelInflightToolRequests(requestIds);
    },
    reset: () => {
      void get().hardStopCurrentRun("reset");
      set(buildInitialState());
    },
    sendMessage: async (selection) => {
      if (selectIsAgentRunActive(get())) return;
      await sendMessageInternal(null, selection);
    },
    coachMessage: async () => {
      if (selectIsAgentRunActive(get())) {
        await get().hardStopCurrentRun("coach");
      }
      await sendMessageInternal(COACH_PROMPT);
    },
    setInput: (value) => {
      const sessionId = get().activeSessionId;
      set((state) => {
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

      if (sessionId) {
        void setChatDraft(sessionId, value).catch(() => {
          set({ errorMessage: "草稿保存失败。" });
        });
      }
    },
    submitAskAnswer: (answer) => {
      const pendingAsk = get().pendingAsk;
      const sessionId = get().activeSessionId;
      if (!pendingAsk || !sessionId) {
        return;
      }

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
    },
    stopMessage: () => {
      void get().hardStopCurrentRun("manual_stop");
    },
    switchSession: async (sessionId) => {
      if (selectIsAgentRunActive(get()) || sessionId === get().activeSessionId) {
        set({ isHistoryOpen: false });
        return;
      }
      try {
        const bookId = get().currentBookId ?? DEFAULT_CHAT_BOOK_ID;
        const bootstrap = await switchChatSession(bookId, sessionId);
        set((state) => ({
          ...state,
          ...applyBootstrap(state, bootstrap),
          isHistoryOpen: false,
        }));
      } catch (error) {
        set({ errorMessage: formatAgentError(error, "切换历史会话失败。") });
      }
    },
  };
});

// 兼容旧名导出。
export const useAgentStore = useChatRunStore;
