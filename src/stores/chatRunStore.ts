/**
 * 聊天运行 Store（chatRunStore）：管理写作模式下与主 agent 的会话、运行态、历史。
 *
 * chatRunStore 管理写作模式下与主 agent 的会话、运行态、历史。
 *
 * 边界约束：
 *   - 本 store 只持状态与 actions；toolset 装配走 lib/agent/toolsets/factory。
 *   - 通用辅助函数（applyBootstrap / ensureSessionState / formatAgentError 等）放在 helpers.ts。
 */

import { create } from "zustand";
import {
  appendChatEntry,
  deleteChatEntry,
  createChatSession,
  deleteChatSession,
  initializeChatStorage,
  setChatDraft,
  switchChatSession,
  updateChatEntry,
} from "../lib/chat/api";
import { readWorkspaceTextFile, readWorkspaceTree, cancelToolRequests } from "../lib/bookWorkspace/api";
import type { ChatEntry, ChatSessionSummary } from "../lib/chat/types";
import { getCompactionCount } from "../lib/chat/entries";
import {
  buildAssistantPlaceholderMessage,
  buildInitialRun,
  buildMessageMeta,
  buildRun,
  buildSessionPatch,
  buildSystemMessage,
  buildUserMessage,
  deriveSessionTitle,
  extractMessageText,
  isPlaceholderOnly,
  mergePart,
} from "../lib/chat/sessionRuntime";
import { useAgentSettingsStore } from "./agentSettingsStore";
import { resolveManualTurnContext, type ManualTurnContextSelection } from "../lib/agent/manualTurnContext";
import { loadProjectContext } from "../lib/agent/projectContext";
import { formatProviderError } from "../lib/agent/errorFormatting";
import { derivePlanningState } from "../lib/agent/planning";
import type { AgentMode } from "../lib/agent/modeRules";
import { createWritingAgentSession, type WritingAgentSession } from "../lib/agent/session";
import { buildBookWorkspaceTools } from "../lib/agent/toolsets/factory";
import type {
  AgentMessage,
  AgentRunStatus,
  AgentPart,
  AgentUsage,
  AskToolAnswer,
  AskUserRequest,
} from "../lib/agent/types";
import { useBookWorkspaceStore } from "./bookWorkspaceStore";
import { getEnabledSkills, useSkillsStore } from "./skillsStore";
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
import { shouldCompactUsage } from "../lib/agent/compaction";
import { compactChatEntries } from "./chatRun/compactionController";
import { queuePatchFromEvent } from "./chatRun/eventReducer";
import {
  appendMessageEntry,
  removeEntry,
  replaceMessageEntry,
} from "./chatRun/persistenceAdapter";

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
  followUpMessage: (selection?: ManualTurnContextSelection) => Promise<void>;
  compactSession: (reason?: "manual") => Promise<void>;
  setActiveMode: (modeId: AgentMode) => void;
  setInput: (value: string) => void;
  stopMessage: () => void;
  submitAskAnswer: (answer: AskToolAnswer) => void;
  switchSession: (sessionId: string) => Promise<void>;
};

export type ChatRunStore = ChatRunStoreState & ChatRunStoreActions;
export { selectIsAgentRunActive };

const COACH_PROMPT =
  "你刚才这个节奏明显慢了。原来的剧情、人设、风格都保留，别把问题扩大。现在先说清楚卡点，然后接着断点继续干。网文这东西最怕拖，读者不会等你慢慢找状态，给我把冲突和爽点往前推。";
const AUTOPILOT_COMPLETION_MARK = "目标已完成";

type SendMessageOptions = {
  autopilotGoal?: string;
  autopilotIteration?: number;
  modeId?: AgentMode;
};

async function cancelInflightToolRequests(requestIds: string[]) {
  await cancelToolRequests(requestIds);
}

function buildAutopilotContinuePrompt(goal: string, iteration: number) {
  return [
    "自动检查：请根据当前对话、计划和工作区状态检查总目标是否已经完成。",
    `总目标：${goal}`,
    `当前自动轮次：${iteration}`,
    "",
    "如果目标已经完成，核对关键成果后在最终回复中写出「目标已完成」。",
    "如果目标还没有完成，直接继续执行最重要的下一步，并写回或验证必要文件。",
  ].join("\n");
}

function getLastAssistantText(messages: AgentMessage[]) {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  return assistant ? extractMessageText(assistant) : "";
}

function isAutopilotGoalCompleted(messages: AgentMessage[]) {
  return getLastAssistantText(messages).includes(AUTOPILOT_COMPLETION_MARK);
}


export const useChatRunStore = create<ChatRunStore>((set, get) => {
  let activeWritingSession: WritingAgentSession | null = null;
  let unsubscribeWritingSession: (() => void) | null = null;

  function clearActiveWritingSession() {
    unsubscribeWritingSession?.();
    unsubscribeWritingSession = null;
    activeWritingSession = null;
  }

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

  async function steerActiveRun() {
    const text = get().input.trim();
    const sessionId = get().activeSessionId;
    if (!text || !sessionId || !activeWritingSession) return false;

    await activeWritingSession.steer(text);
    set((state) => ({
      ...ensureSessionState(
        state,
        sessionId,
        state.messagesBySession[sessionId] ?? [],
        "",
        state.run.status === "awaiting_user" ? "awaiting_user" : "running",
      ),
    }));
    void setChatDraft(sessionId, "").catch(() => {
      set({ errorMessage: "草稿保存失败。" });
    });
    return true;
  }

  async function followUpActiveRun() {
    const text = get().input.trim();
    const sessionId = get().activeSessionId;
    if (!text || !sessionId || !activeWritingSession) return false;

    await activeWritingSession.followUp(text);
    set((state) => ({
      ...ensureSessionState(
        state,
        sessionId,
        state.messagesBySession[sessionId] ?? [],
        "",
        state.run.status === "awaiting_user" ? "awaiting_user" : "running",
      ),
    }));
    void setChatDraft(sessionId, "").catch(() => set({ errorMessage: "草稿保存失败。" }));
    return true;
  }

  async function compactCurrentSession(reason: "manual" | "threshold" = "manual") {
    const sessionId = get().activeSessionId;
    if (!sessionId || selectIsAgentRunActive(get())) return;
    const entries = get().entriesBySession[sessionId] ?? [];
    set({ isCompacting: true, errorMessage: null });
    try {
      const providerConfig = useAgentSettingsStore.getState().config;
      const result = await compactChatEntries({
        bookId: get().currentBookId,
        entries,
        messages: get().messagesBySession[sessionId] ?? [],
        providerConfig,
        sessionId,
      });
      if (!result) {
        set({ isCompacting: false });
        return;
      }
      applyPersistedSummary(set, result.summary);
      set((state) => ({
        compactionCount: getCompactionCount(result.entries),
        entriesBySession: { ...state.entriesBySession, [sessionId]: result.entries },
        isCompacting: false,
        latestCompactionAt: result.latestCompactionAt,
        latestCompactionTokensBefore: result.latestCompactionTokensBefore,
      }));
    } catch (error) {
      set({
        errorMessage: formatAgentError(error, reason === "manual" ? "压缩上下文失败。" : "自动压缩上下文失败。"),
        isCompacting: false,
      });
    }
  }

  /**
   * 实际执行一次发送：组参 → 创建 WritingAgentSession → 消费事件/part → 写库。
   * 这是一个状态机（abort/error/usage 等多分支），保持单函数完整性更便于审视。
   */
  async function sendMessageInternal(
    promptOverride: string | null,
    selection?: ManualTurnContextSelection,
    options: SendMessageOptions = {},
  ) {
    const nextInput = promptOverride ?? get().input.trim();
    if (!nextInput) return;

    const activeModeId = options.modeId ?? get().activeModeId;
    const autopilotGoal = activeModeId === "autopilot"
      ? options.autopilotGoal ?? nextInput
      : null;
    const autopilotIteration = options.autopilotIteration ?? 1;
    const abortController = new AbortController();
    const runRequestId = buildRunRequestId();
    const optimisticSessionId = get().activeSessionId;
    let pendingAsk: PendingAskState | null = null;
    const conversationEntries = optimisticSessionId
      ? (get().entriesBySession[optimisticSessionId] ?? [])
      : [];
    const conversationHistory = optimisticSessionId
      ? (get().messagesBySession[optimisticSessionId] ?? [])
      : [];
    const workspaceState = useBookWorkspaceStore.getState();
    const messageMeta = buildMessageMeta(workspaceState.rootPath, workspaceState.activeFilePath);
    const userMessage = buildUserMessage(nextInput, messageMeta);
    const assistantMessage = buildAssistantPlaceholderMessage(messageMeta);
    let sessionId: string | null = optimisticSessionId;
    let latestMessages = [...conversationHistory, userMessage, assistantMessage];
    let latestEntries: ChatEntry[] = [...conversationEntries];
    let latestUsage: AgentUsage | null = null;
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
        updateChatEntry(
          get().currentBookId ?? DEFAULT_CHAT_BOOK_ID,
          sessionId,
          assistantMessage.id,
          { message: assistant },
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
      latestUsage = usage;

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
	            finishReason: usage.finishReason,
	            usage,
	          },
        };
        latestMessages = messages;
        latestEntries = replaceMessageEntry(latestEntries, messages[messages.length - 1]);
        const nextStatus = state.pendingAsk || state.run.status === "awaiting_user"
          ? "awaiting_user"
          : "running";
        return {
          entriesBySession: { ...state.entriesBySession, [currentSessionId]: latestEntries },
          ...ensureSessionState(state, currentSessionId, messages, "", nextStatus),
        };
      });
    };

    latestEntries = appendMessageEntry(appendMessageEntry(latestEntries, userMessage), assistantMessage);

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
	        autopilotGoalsBySession: optimisticSessionId && autopilotGoal
	          ? {
	              ...state.autopilotGoalsBySession,
	              [optimisticSessionId]: autopilotGoal,
	            }
	          : state.autopilotGoalsBySession,
	        inflightToolRequestIds: [],
	        errorMessage: null,
	        entriesBySession: {
	          ...state.entriesBySession,
	          [optimisticSessionId]: latestEntries,
	        },
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
      const persistedConversationEntries =
        sessionId === optimisticSessionId
          ? conversationEntries
          : (get().entriesBySession[sessionId] ?? []);
      latestMessages = [...persistedConversationHistory, userMessage, assistantMessage];
      latestEntries = appendMessageEntry(
        appendMessageEntry([...persistedConversationEntries], userMessage),
        assistantMessage,
      );
      const currentSessionId = sessionId;
	      set((state) => ({
	        abortController,
	        activeRunRequestId: runRequestId,
	        autopilotGoalsBySession: autopilotGoal
	          ? {
	              ...state.autopilotGoalsBySession,
	              [currentSessionId]: autopilotGoal,
	            }
	          : state.autopilotGoalsBySession,
	        inflightToolRequestIds: [],
	        errorMessage: null,
	        entriesBySession: {
	          ...state.entriesBySession,
	          [currentSessionId]: latestEntries,
	        },
	        ...ensureSessionState(state, currentSessionId, latestMessages, "", "running"),
	      }));
      void setChatDraft(currentSessionId, "");

      const currentBookId = get().currentBookId ?? DEFAULT_CHAT_BOOK_ID;
      await persistSummary(
        appendChatEntry(
          currentBookId,
          sessionId,
          { id: userMessage.id, entryType: "message", payload: { message: userMessage } },
          buildSessionPatch(latestMessages, "running"),
        ),
      );
      await persistSummary(
        appendChatEntry(
          currentBookId,
          sessionId,
          { id: assistantMessage.id, entryType: "message", payload: { message: assistantMessage } },
        ),
      );

      // 3. 读取本轮所需的 provider / 工具 / agent 配置。
      await ensureAgentSettingsReady();
      if (!isCurrentRun()) return;

      providerConfig = useAgentSettingsStore.getState().config;
      const enabledSkills = getEnabledSkills(useSkillsStore.getState());
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
      const modeContext = activeModeId === "autopilot"
        ? {
            goal: autopilotGoal ?? nextInput,
            iteration: autopilotIteration,
          }
        : undefined;
      // 写作模式默认 toolset：global + workspace + localResource，统一通过工厂装配。
      const workspaceTools = buildBookWorkspaceTools({
        rootPath: workspaceState.rootPath,
        includeAsk: true,
      });

	      // 4. 调用 LLM 流式接口，逐 part 合并到 assistant 消息。
	      clearActiveWritingSession();
	      const writingSession = createWritingAgentSession({
	        abortController,
	        activeFilePath: workspaceState.activeFilePath,
	        debugLabel: `chat-session:${sessionId}`,
	        workspaceRootPath: workspaceState.rootPath,
        conversationEntries: persistedConversationEntries,
        conversationHistory: persistedConversationHistory,
        defaultAgentMarkdown,
        enabledSkills,
        enabledToolIds,
        mode: activeModeId,
        modeContext,
        manualContext,
        onAskUser: handleAskUser,
	        onUsage: attachUsageToAssistant,
	        planningState,
	        projectContext,
	        providerConfig,
        workspaceTools,
	        onToolRequestStateChange: ({ requestId, status }) => {
	          if (!isCurrentRun() && status === "start") return;
	          trackInflightToolRequest(set, requestId, status === "start" ? "start" : "finish");
	        },
	      });
	      activeWritingSession = writingSession;
	      unsubscribeWritingSession = writingSession.subscribe((event) => {
	        const patch = queuePatchFromEvent(event);
	        if (patch) set(patch);
	      });
	      const stream = writingSession.prompt(nextInput);

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
          latestEntries = replaceMessageEntry(latestEntries, messages[messages.length - 1]);
          scheduleAssistantPersist();
          return {
            pendingAsk: part.type === "ask-user" && part.status === "completed"
              ? null
              : state.pendingAsk,
            entriesBySession: { ...state.entriesBySession, [activeSessionId]: latestEntries },
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
	      clearActiveWritingSession();
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
	        queuedFollowUpMessages: [],
	        queuedSteeringMessages: [],
	        ...ensureSessionState(state, completedSessionId, latestMessages, "", "completed"),
      }));
      await flushAssistant("completed");
      if (latestUsage && shouldCompactUsage(latestUsage)) {
        await compactCurrentSession("threshold");
      }
      if (
        activeModeId === "autopilot"
        && autopilotGoal
        && get().activeModeId === "autopilot"
        && get().activeSessionId === completedSessionId
        && !isAutopilotGoalCompleted(latestMessages)
      ) {
        await sendMessageInternal(
          buildAutopilotContinuePrompt(autopilotGoal, autopilotIteration + 1),
          undefined,
          {
            autopilotGoal,
            autopilotIteration: autopilotIteration + 1,
            modeId: "autopilot",
          },
        );
      }
	    } catch (error) {
	      // 6. abort / 失败的两条路径分别处理。
	      clearActiveWritingSession();
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
        latestEntries = abortedState.removePlaceholder
          ? removeEntry(latestEntries, assistantMessage.id)
          : replaceMessageEntry(latestEntries, abortedState.assistant ?? assistantMessage);
        if (get().activeRunRequestId === runRequestId) {
          set((state) => {
            if (!sessionId) {
              return {
                abortController: null,
                activeRunRequestId: null,
	                inflightToolRequestIds: [],
	                pendingAsk: null,
	                queuedFollowUpMessages: [],
	                queuedSteeringMessages: [],
	                planningState: derivePlanningState(latestMessages),
	                run: buildInitialRun(),
              };
            }
            return {
              abortController: null,
              activeRunRequestId: null,
	              inflightToolRequestIds: [],
	              pendingAsk: null,
	              queuedFollowUpMessages: [],
	              queuedSteeringMessages: [],
	              entriesBySession: {
	                ...state.entriesBySession,
	                [sessionId]: latestEntries,
	              },
	              ...ensureSessionState(state, sessionId, latestMessages, "", "idle"),
            };
          });
        }
        if (sessionId && abortedState.removePlaceholder && abortedState.assistant) {
          await persistSummary(
            deleteChatEntry(
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
      latestEntries = appendMessageEntry(latestEntries, systemMessage);
      set((state) => {
        if (!sessionId) {
          return {
            abortController: null,
            activeRunRequestId: null,
	            inflightToolRequestIds: [],
	            pendingAsk: null,
	            queuedFollowUpMessages: [],
	            queuedSteeringMessages: [],
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
	          queuedFollowUpMessages: [],
	          queuedSteeringMessages: [],
	          entriesBySession: {
	            ...state.entriesBySession,
	            [sessionId]: latestEntries,
	          },
	          ...ensureSessionState(state, sessionId, latestMessages, "", "failed"),
        };
      });
      if (sessionId) {
        await persistSummary(
          appendChatEntry(
            get().currentBookId ?? DEFAULT_CHAT_BOOK_ID,
            sessionId,
            { id: systemMessage.id, entryType: "message", payload: { message: systemMessage } },
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
      const nextEntries = shouldRemovePlaceholder
        ? removeEntry(state.entriesBySession[sessionId ?? ""] ?? [], assistant?.id ?? "")
        : state.entriesBySession[sessionId ?? ""] ?? [];

      if (!abortController && requestIds.length === 0 && !pendingAsk) return;

	      pendingAsk?.reject(new Error("等待用户输入的交互已中断，请重新发起。"));
	      activeWritingSession?.abort(_reason);
	      clearActiveWritingSession();
	      abortController?.abort();
	      set((current) => {
        if (!sessionId) {
          return {
            abortController: null,
            activeRunRequestId: null,
	            inflightToolRequestIds: [],
	            pendingAsk: null,
	            queuedFollowUpMessages: [],
	            queuedSteeringMessages: [],
	          };
        }
        return {
          abortController: null,
          activeRunRequestId: null,
	          inflightToolRequestIds: [],
	          pendingAsk: null,
	          queuedFollowUpMessages: [],
	          queuedSteeringMessages: [],
	          entriesBySession: {
	            ...current.entriesBySession,
	            [sessionId]: nextEntries,
	          },
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
	      if (selectIsAgentRunActive(get())) {
	        await steerActiveRun();
	        return;
	      }
	      await sendMessageInternal(null, selection);
	    },
    followUpMessage: async () => {
      if (selectIsAgentRunActive(get())) {
        await followUpActiveRun();
      }
    },
    compactSession: async (reason = "manual") => {
      await compactCurrentSession(reason);
    },
    coachMessage: async () => {
      if (selectIsAgentRunActive(get())) {
        activeWritingSession?.steer(COACH_PROMPT);
        return;
      }
      await sendMessageInternal(COACH_PROMPT, undefined, { modeId: "book" });
    },
    setActiveMode: (modeId) => {
      if (selectIsAgentRunActive(get())) return;
      set({ activeModeId: modeId });
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
