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
import { readWorkspaceTextFile, cancelToolRequests } from "../lib/bookWorkspace/api";
import type { ChatBootstrap, ChatSessionSummary } from "../lib/chat/types";
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
  normalizeRecoveredMessages,
  normalizeRecoveredStatus,
  sortSessionSummaries,
} from "../lib/chat/sessionRuntime";
import {
  getStoredDefaultAgentMarkdown,
  useAgentSettingsStore,
} from "./agentSettingsStore";
import { resolveManualTurnContext, type ManualTurnContextSelection } from "../lib/agent/manualTurnContext";
import { formatProviderError } from "../lib/agent/errorFormatting";
import { derivePlanningState, type PlanningState } from "../lib/agent/planning";
import { runAgentTurn } from "../lib/agent/session";
import { createLocalResourceToolset, createWorkspaceToolset } from "../lib/agent/tools";
import type { AgentMessage, AgentRun, AgentRunStatus, AgentPart, AgentUsage } from "../lib/agent/types";
import { useBookWorkspaceStore } from "./bookWorkspaceStore";
import { getEnabledSkills, useSkillsStore } from "./skillsStore";
import { getEnabledAgents, useSubAgentStore } from "./subAgentStore";

type AgentStoreStatus = "idle" | "loading" | "ready" | "error";

type RunInterruptReason = "manual_stop" | "app_close" | "restart" | "reset";
const DEFAULT_CHAT_BOOK_ID = "__global__";

type AgentStoreState = {
  abortController: AbortController | null;
  activeRunRequestId: string | null;
  activeSessionId: string | null;
  contextTags: string[];
  currentBookId: string | null;
  draftsBySession: Record<string, string>;
  errorMessage: string | null;
  input: string;
  inflightToolRequestIds: string[];
  isHistoryOpen: boolean;
  isHydrated: boolean;
  messagesBySession: Record<string, AgentMessage[]>;
  planningState: PlanningState;
  run: AgentRun;
  sessions: ChatSessionSummary[];
  status: AgentStoreStatus;
};

type AgentStoreActions = {
  closeHistory: () => void;
  createNewSession: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  hardStopCurrentRun: (reason?: RunInterruptReason) => Promise<void>;
  initialize: (bookId?: string | null) => Promise<void>;
  openHistory: () => void;
  reset: () => void;
  sendMessage: (selection?: ManualTurnContextSelection) => Promise<void>;
  setInput: (value: string) => void;
  stopMessage: () => void;
  switchSession: (sessionId: string) => Promise<void>;
};

export type AgentStore = AgentStoreState & AgentStoreActions;

type RunActivityState = Pick<
  AgentStoreState,
  "abortController" | "activeRunRequestId" | "inflightToolRequestIds" | "run"
>;

export function selectIsAgentRunActive(state: RunActivityState) {
  return (
    state.activeRunRequestId !== null ||
    state.abortController !== null ||
    state.inflightToolRequestIds.length > 0 ||
    state.run.status === "running"
  );
}

function buildInitialState(): AgentStoreState {
  return {
    abortController: null,
    activeRunRequestId: null,
    activeSessionId: null,
    contextTags: ["工具: 文件工作区"],
    currentBookId: null,
    draftsBySession: {},
    errorMessage: null,
    input: "",
    inflightToolRequestIds: [],
    isHistoryOpen: false,
    isHydrated: false,
    messagesBySession: {},
    planningState: { items: [], roundsSinceUpdate: 0 },
    run: buildInitialRun(),
    sessions: [],
    status: "idle",
  };
}

function getPersistedSummaryStatus(state: AgentStoreState, summary: ChatSessionSummary): AgentRunStatus {
  if (state.activeSessionId === summary.id && selectIsAgentRunActive(state)) {
    return "running";
  }

  return normalizeRecoveredStatus(summary.status);
}

function formatAgentError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallbackMessage;
}

function upsertSessionSummary(sessions: ChatSessionSummary[], summary: ChatSessionSummary) {
  const filtered = sessions.filter((candidate) => candidate.id !== summary.id);
  return sortSessionSummaries([...filtered, summary]);
}

function applyBootstrap(state: AgentStoreState, bootstrap: ChatBootstrap): Partial<AgentStoreState> {
  const normalizedSessions = bootstrap.sessions.map((session) => ({
    ...session,
    status: normalizeRecoveredStatus(session.status),
  }));
  const validIds = new Set(normalizedSessions.map((session) => session.id));
  const nextMessagesBySession = Object.fromEntries(
    Object.entries(state.messagesBySession).filter(([sessionId]) => validIds.has(sessionId)),
  ) as Record<string, AgentMessage[]>;
  const nextDraftsBySession = Object.fromEntries(
    Object.entries(state.draftsBySession).filter(([sessionId]) => validIds.has(sessionId)),
  ) as Record<string, string>;

  if (bootstrap.activeSessionId) {
    nextMessagesBySession[bootstrap.activeSessionId] = normalizeRecoveredMessages(bootstrap.activeSessionMessages);
    nextDraftsBySession[bootstrap.activeSessionId] = bootstrap.activeSessionDraft;
  }

  const activeSummary = bootstrap.activeSessionId
    ? normalizedSessions.find((session) => session.id === bootstrap.activeSessionId) ?? null
    : null;
  const activeMessages = bootstrap.activeSessionId ? nextMessagesBySession[bootstrap.activeSessionId] ?? [] : [];
  const planningState = derivePlanningState(activeMessages);

  return {
    activeSessionId: bootstrap.activeSessionId,
    currentBookId: bootstrap.bookId ?? state.currentBookId,
    draftsBySession: nextDraftsBySession,
    errorMessage: null,
    input: bootstrap.activeSessionId ? nextDraftsBySession[bootstrap.activeSessionId] ?? "" : "",
    inflightToolRequestIds: [],
    isHydrated: true,
    messagesBySession: nextMessagesBySession,
    planningState,
    run: activeSummary
      ? buildRun(activeSummary.id, activeSummary.title, activeSummary.status, activeMessages)
      : buildInitialRun(),
    sessions: normalizedSessions,
    status: "ready",
  };
}

function ensureSessionState(
  state: AgentStoreState,
  sessionId: string,
  messages: AgentMessage[],
  input: string,
  status: AgentRunStatus,
): Partial<AgentStoreState> {
  const messagesBySession = { ...state.messagesBySession, [sessionId]: messages };
  const draftsBySession = { ...state.draftsBySession, [sessionId]: input };

  if (state.activeSessionId !== sessionId) {
    return { draftsBySession, messagesBySession };
  }

  return {
    draftsBySession,
    input,
    messagesBySession,
    planningState: derivePlanningState(messages),
    run: buildRun(sessionId, deriveSessionTitle(messages), status, messages),
  };
}

type AgentStoreSetter = (
  partial: Partial<AgentStore> | ((state: AgentStore) => Partial<AgentStore>),
  replace?: false,
) => void;

function applyPersistedSummary(set: AgentStoreSetter, summary: ChatSessionSummary) {
  set((state) => {
    const normalizedSummary = {
      ...summary,
      status: getPersistedSummaryStatus(state, summary),
    };
    const sessions = upsertSessionSummary(state.sessions, normalizedSummary);
    if (state.activeSessionId !== normalizedSummary.id) {
      return { sessions };
    }

    return {
      run: buildRun(
        normalizedSummary.id,
        normalizedSummary.title,
        normalizedSummary.status,
        state.messagesBySession[normalizedSummary.id] ?? [],
      ),
      sessions,
    };
  });
}

function trackInflightToolRequest(
  set: AgentStoreSetter,
  requestId: string,
  action: "start" | "finish",
) {
  set((state) => {
    const nextIds = action === "start"
      ? Array.from(new Set([...state.inflightToolRequestIds, requestId]))
      : state.inflightToolRequestIds.filter((id) => id !== requestId);
    return { inflightToolRequestIds: nextIds };
  });
}

function resolveAbortedAssistantState(latestMessages: AgentMessage[], assistantMessageId: string) {
  const assistant = latestMessages[latestMessages.length - 1];
  if (assistant && assistant.id === assistantMessageId && isPlaceholderOnly(assistant)) {
    return {
      assistant,
      messages: latestMessages.filter((message) => message.id !== assistant.id),
      removePlaceholder: true,
    };
  }

  return {
    assistant: null,
    messages: latestMessages,
    removePlaceholder: false,
  };
}

function buildRunRequestId() {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function cancelInflightToolRequests(requestIds: string[]) {
  await cancelToolRequests(requestIds);
}

async function ensureMainAgentMarkdown() {
  const settings = useAgentSettingsStore.getState();
  if (settings.defaultAgentMarkdown.trim()) {
    return settings.defaultAgentMarkdown;
  }

  await settings.initialize();
  return useAgentSettingsStore.getState().defaultAgentMarkdown || getStoredDefaultAgentMarkdown();
}

async function ensureAgentSettingsReady() {
  await useAgentSettingsStore.getState().initialize();
  return useAgentSettingsStore.getState();
}

export const useAgentStore = create<AgentStore>((set, get) => {
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

  return {
    ...buildInitialState(),
    closeHistory: () => set({ isHistoryOpen: false }),
    createNewSession: async () => {
      const bookId = get().currentBookId ?? DEFAULT_CHAT_BOOK_ID;

      if (selectIsAgentRunActive(get())) {
        return;
      }

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
      if (selectIsAgentRunActive(get())) {
        return;
      }

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
      const messages = sessionId ? state.messagesBySession[sessionId] ?? [] : [];
      const assistant = messages[messages.length - 1];
      const shouldRemovePlaceholder = Boolean(
        sessionId && assistant?.role === "assistant" && isPlaceholderOnly(assistant),
      );
      const nextMessages = shouldRemovePlaceholder ? messages.slice(0, -1) : messages;

      if (!abortController && requestIds.length === 0) {
        return;
      }

      abortController?.abort();
      set((current) => {
        if (!sessionId) {
          return {
            abortController: null,
            activeRunRequestId: null,
            inflightToolRequestIds: [],
          };
        }

        return {
          abortController: null,
          activeRunRequestId: null,
          inflightToolRequestIds: [],
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
        return;
      }

      const nextInput = get().input.trim();
      if (!nextInput) {
        return;
      }

      const abortController = new AbortController();
      const runRequestId = buildRunRequestId();
      const optimisticSessionId = get().activeSessionId;
      const conversationHistory = optimisticSessionId ? get().messagesBySession[optimisticSessionId] ?? [] : [];
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

      const flushAssistant = async (status: AgentRunStatus) => {
        if (!sessionId) {
          return;
        }
        const assistant = latestMessages[latestMessages.length - 1];
        if (!assistant || assistant.id !== assistantMessage.id) {
          return;
        }

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
        if (persistTimer) {
          return;
        }

        persistTimer = setTimeout(() => {
          persistTimer = null;
          persistChain = persistChain.then(() => flushAssistant("running"));
        }, 350);
      };

      const attachUsageToAssistant = (usage: AgentUsage) => {
        if (!isCurrentRun() || !sessionId) {
          return;
        }

        const currentSessionId = sessionId;
        set((state) => {
          if (state.activeRunRequestId !== runRequestId) {
            return state;
          }
          const messages = [...(state.messagesBySession[currentSessionId] ?? [])];
          const lastMessage = messages[messages.length - 1];
          if (!lastMessage || lastMessage.id !== assistantMessage.id) {
            return state;
          }

          messages[messages.length - 1] = {
            ...lastMessage,
            meta: {
              ...(lastMessage.meta ?? {}),
              usage,
            },
          };
          latestMessages = messages;
          return ensureSessionState(state, currentSessionId, messages, "", "running");
        });
      };

      set((state) => {
        if (!optimisticSessionId) {
          return {
            abortController,
            activeRunRequestId: runRequestId,
            inflightToolRequestIds: [],
            errorMessage: null,
            input: "",
            planningState: derivePlanningState(latestMessages),
            run: buildRun("pending-session", deriveSessionTitle(latestMessages), "running", latestMessages),
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
        sessionId = await ensureActiveSession();
        if (!sessionId) {
          throw new Error("创建会话失败。");
        }
        if (!isCurrentRun()) {
          return;
        }

        const persistedConversationHistory = sessionId === optimisticSessionId
          ? conversationHistory
          : get().messagesBySession[sessionId] ?? [];
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
          appendChatMessage(currentBookId, sessionId, userMessage, buildSessionPatch(latestMessages, "running")),
        );
        await persistSummary(appendChatMessage(currentBookId, sessionId, assistantMessage));

        await ensureAgentSettingsReady();
        if (!isCurrentRun()) {
          return;
        }

        providerConfig = useAgentSettingsStore.getState().config;
        const enabledSkills = getEnabledSkills(useSkillsStore.getState());
        const enabledAgents = getEnabledAgents(useSubAgentStore.getState());
        const enabledToolsMap = useAgentSettingsStore.getState().enabledTools;
        const defaultAgentMarkdown = await ensureMainAgentMarkdown();
        if (!isCurrentRun()) {
          return;
        }

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
        if (!isCurrentRun()) {
          return;
        }

        const planningState = derivePlanningState(persistedConversationHistory);
        const workspaceTools = workspaceState.rootPath
          ? createWorkspaceToolset({
              onWorkspaceMutated: async () => {
                await useBookWorkspaceStore.getState().refreshWorkspaceAfterExternalChange();
              },
              rootPath: workspaceState.rootPath,
            })
          : {};
        const localResourceTools = createLocalResourceToolset({
          refreshAgents: async () => {
            await useSubAgentStore.getState().refresh();
          },
          refreshSkills: async () => {
            await useSkillsStore.getState().refresh();
          },
        });

        const stream = runAgentTurn({
          abortSignal: abortController.signal,
          activeFilePath: workspaceState.activeFilePath,
          workspaceRootPath: workspaceState.rootPath,
          conversationHistory: persistedConversationHistory,
          defaultAgentMarkdown,
          enabledAgents,
          enabledSkills,
          enabledToolIds,
          manualContext,
          onUsage: attachUsageToAssistant,
          planningState,
          prompt: nextInput,
          providerConfig,
          workspaceTools: { ...workspaceTools, ...localResourceTools },
          onToolRequestStateChange: ({ requestId, status }) => {
            if (!isCurrentRun() && status === "start") {
              return;
            }
            trackInflightToolRequest(set, requestId, status === "start" ? "start" : "finish");
          },
        });

        for await (const part of stream) {
          if (!isCurrentRun()) {
            return;
          }

          const activeSessionId = sessionId;
          set((state) => {
            if (state.activeRunRequestId !== runRequestId) {
              return state;
            }
            const messages = [...(state.messagesBySession[activeSessionId] ?? [])];
            const lastMessage = messages[messages.length - 1];
            if (lastMessage?.role !== "assistant") {
              return state;
            }

            messages[messages.length - 1] = {
              ...lastMessage,
              parts: mergePart(lastMessage.parts, part as AgentPart),
            };
            latestMessages = messages;
            scheduleAssistantPersist();
            return ensureSessionState(state, activeSessionId, messages, "", "running");
          });
        }

        if (persistTimer) {
          window.clearTimeout(persistTimer);
          persistTimer = null;
        }
        await persistChain;
        if (!isCurrentRun()) {
          return;
        }
        const completedSessionId = sessionId;
        set((state) => ({
          abortController: null,
          activeRunRequestId: state.activeRunRequestId === runRequestId ? null : state.activeRunRequestId,
          inflightToolRequestIds: [],
          ...ensureSessionState(state, completedSessionId, latestMessages, "", "completed"),
        }));
        await flushAssistant("completed");
      } catch (error) {
        if (persistTimer) {
          window.clearTimeout(persistTimer);
          persistTimer = null;
        }
        await persistChain;

        if (abortController.signal.aborted) {
          const abortedState = resolveAbortedAssistantState(latestMessages, assistantMessage.id);
          latestMessages = abortedState.messages;
          if (get().activeRunRequestId === runRequestId) {
            set((state) => {
              if (!sessionId) {
                return {
                  abortController: null,
                  activeRunRequestId: null,
                  inflightToolRequestIds: [],
                  planningState: derivePlanningState(latestMessages),
                  run: buildInitialRun(),
                };
              }

              return {
                abortController: null,
                activeRunRequestId: null,
                inflightToolRequestIds: [],
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

        if (get().activeRunRequestId !== runRequestId) {
          return;
        }

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
              errorMessage: formatAgentError(error, "Agent 执行失败，请稍后重试。"),
              planningState: derivePlanningState(latestMessages),
              run: buildRun("failed-run", deriveSessionTitle(latestMessages), "failed", latestMessages),
            };
          }

          return {
            abortController: null,
            activeRunRequestId: null,
            inflightToolRequestIds: [],
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
    },
    setInput: (value) => {
      const sessionId = get().activeSessionId;
      set((state) => {
        if (!sessionId) {
          return { input: value };
        }

        return {
          ...ensureSessionState(state, sessionId, state.messagesBySession[sessionId] ?? [], value, state.run.status),
        };
      });

      if (sessionId) {
        void setChatDraft(sessionId, value).catch(() => {
          set({ errorMessage: "草稿保存失败。" });
        });
      }
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
