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
  sortSessionSummaries,
} from "../lib/chat/sessionRuntime";
import {
  getStoredAgentConfig,
  getStoredDefaultAgentMarkdown,
  getStoredEnabledTools,
  useAgentSettingsStore,
} from "./agentSettingsStore";
import { runAgentTurn } from "../lib/agent/session";
import { createWorkspaceToolset } from "../lib/agent/tools";
import type { AgentMessage, AgentRun, AgentRunStatus, AgentPart } from "../lib/agent/types";
import { useBookWorkspaceStore } from "./bookWorkspaceStore";
import { getEnabledSkills, useSkillsStore } from "./skillsStore";
import { getEnabledAgents, useSubAgentStore } from "./subAgentStore";

type AgentStoreStatus = "idle" | "loading" | "ready" | "error";

type AgentStoreState = {
  abortController: AbortController | null;
  activeSessionId: string | null;
  contextTags: string[];
  draftsBySession: Record<string, string>;
  errorMessage: string | null;
  input: string;
  isHistoryOpen: boolean;
  isHydrated: boolean;
  messagesBySession: Record<string, AgentMessage[]>;
  run: AgentRun;
  sessions: ChatSessionSummary[];
  status: AgentStoreStatus;
};

type AgentStoreActions = {
  closeHistory: () => void;
  createNewSession: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  initialize: () => Promise<void>;
  openHistory: () => void;
  reset: () => void;
  sendMessage: () => Promise<void>;
  setInput: (value: string) => void;
  stopMessage: () => void;
  switchSession: (sessionId: string) => Promise<void>;
};

export type AgentStore = AgentStoreState & AgentStoreActions;

function buildInitialState(): AgentStoreState {
  return {
    abortController: null,
    activeSessionId: null,
    contextTags: ["工具: 文件工作区"],
    draftsBySession: {},
    errorMessage: null,
    input: "",
    isHistoryOpen: false,
    isHydrated: false,
    messagesBySession: {},
    run: buildInitialRun(),
    sessions: [],
    status: "idle",
  };
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
  const validIds = new Set(bootstrap.sessions.map((session) => session.id));
  const nextMessagesBySession = Object.fromEntries(
    Object.entries(state.messagesBySession).filter(([sessionId]) => validIds.has(sessionId)),
  ) as Record<string, AgentMessage[]>;
  const nextDraftsBySession = Object.fromEntries(
    Object.entries(state.draftsBySession).filter(([sessionId]) => validIds.has(sessionId)),
  ) as Record<string, string>;

  if (bootstrap.activeSessionId) {
    nextMessagesBySession[bootstrap.activeSessionId] = bootstrap.activeSessionMessages;
    nextDraftsBySession[bootstrap.activeSessionId] = bootstrap.activeSessionDraft;
  }

  const activeSummary = bootstrap.activeSessionId
    ? bootstrap.sessions.find((session) => session.id === bootstrap.activeSessionId) ?? null
    : null;
  const activeMessages = bootstrap.activeSessionId ? nextMessagesBySession[bootstrap.activeSessionId] ?? [] : [];

  return {
    activeSessionId: bootstrap.activeSessionId,
    draftsBySession: nextDraftsBySession,
    errorMessage: null,
    input: bootstrap.activeSessionId ? nextDraftsBySession[bootstrap.activeSessionId] ?? "" : "",
    isHydrated: true,
    messagesBySession: nextMessagesBySession,
    run: activeSummary
      ? buildRun(activeSummary.id, activeSummary.title, activeSummary.status, activeMessages)
      : buildInitialRun(),
    sessions: bootstrap.sessions,
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
    run: buildRun(sessionId, deriveSessionTitle(messages), status, messages),
  };
}

type AgentStoreSetter = (
  partial: Partial<AgentStore> | ((state: AgentStore) => Partial<AgentStore>),
  replace?: false,
) => void;

function applyPersistedSummary(set: AgentStoreSetter, summary: ChatSessionSummary) {
  set((state) => {
    const sessions = upsertSessionSummary(state.sessions, summary);
    if (state.activeSessionId !== summary.id) {
      return { sessions };
    }

    return {
      run: buildRun(summary.id, summary.title, summary.status, state.messagesBySession[summary.id] ?? []),
      sessions,
    };
  });
}

async function ensureMainAgentMarkdown() {
  const settings = useAgentSettingsStore.getState();
  if (settings.defaultAgentMarkdown.trim()) {
    return settings.defaultAgentMarkdown;
  }

  await settings.initialize();
  return useAgentSettingsStore.getState().defaultAgentMarkdown || getStoredDefaultAgentMarkdown();
}

export const useAgentStore = create<AgentStore>((set, get) => {
  async function ensureActiveSession() {
    if (get().activeSessionId) {
      return get().activeSessionId;
    }

    if (!get().isHydrated && get().status !== "loading") {
      await get().initialize();
      if (get().activeSessionId) {
        return get().activeSessionId;
      }
    }

    const bootstrap = await createChatSession();
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
      if (get().run.status === "running") {
        return;
      }

      try {
        const bootstrap = await createChatSession();
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
      if (get().run.status === "running") {
        return;
      }

      try {
        const bootstrap = await deleteChatSession(sessionId);
        set((state) => ({ ...state, ...applyBootstrap(state, bootstrap) }));
      } catch (error) {
        set({ errorMessage: formatAgentError(error, "删除历史会话失败。") });
      }
    },
    initialize: async () => {
      if (get().status === "loading" || get().isHydrated) {
        return;
      }

      set({ errorMessage: null, status: "loading" });
      try {
        const bootstrap = await initializeChatStorage();
        set((state) => ({ ...state, ...applyBootstrap(state, bootstrap) }));
      } catch (error) {
        set({
          errorMessage: formatAgentError(error, "历史会话初始化失败。"),
          isHydrated: true,
          status: "error",
        });
      }
    },
    openHistory: () => set({ isHistoryOpen: true }),
    reset: () => {
      get().abortController?.abort();
      set(buildInitialState());
    },
    sendMessage: async () => {
      if (get().run.status === "running") {
        return;
      }

      const nextInput = get().input.trim();
      if (!nextInput) {
        return;
      }

      const sessionId = await ensureActiveSession();
      if (!sessionId) {
        return;
      }

      const abortController = new AbortController();
      const conversationHistory = get().messagesBySession[sessionId] ?? [];
      const workspaceState = useBookWorkspaceStore.getState();
      const providerConfig = useAgentSettingsStore.getState().config ?? getStoredAgentConfig();
      const enabledSkills = getEnabledSkills(useSkillsStore.getState());
      const enabledAgents = getEnabledAgents(useSubAgentStore.getState());
      const enabledToolsMap = useAgentSettingsStore.getState().enabledTools ?? getStoredEnabledTools();
      const defaultAgentMarkdown = await ensureMainAgentMarkdown();
      const enabledToolIds = Object.entries(enabledToolsMap)
        .filter(([, value]) => value)
        .map(([toolId]) => toolId);
      const messageMeta = buildMessageMeta(workspaceState.rootPath, workspaceState.activeFilePath);
      const userMessage = buildUserMessage(nextInput, messageMeta);
      const assistantMessage = buildAssistantPlaceholderMessage(messageMeta);
      let latestMessages = [...conversationHistory, userMessage, assistantMessage];
      let persistTimer: ReturnType<typeof setTimeout> | null = null;
      let persistChain = Promise.resolve();

      const workspaceTools = workspaceState.rootPath
        ? createWorkspaceToolset({
            onWorkspaceMutated: async () => {
              await useBookWorkspaceStore.getState().refreshWorkspaceAfterExternalChange();
            },
            rootPath: workspaceState.rootPath,
          })
        : {};

      const persistSummary = async (promise: Promise<ChatSessionSummary>) => {
        try {
          applyPersistedSummary(set, await promise);
        } catch (error) {
          set({ errorMessage: formatAgentError(error, "历史会话保存失败。") });
        }
      };

      const flushAssistant = async (status: AgentRunStatus) => {
        const assistant = latestMessages[latestMessages.length - 1];
        if (!assistant || assistant.id !== assistantMessage.id) {
          return;
        }

        await persistSummary(
          updateChatMessage(sessionId, assistantMessage.id, assistant.parts, assistant.meta, buildSessionPatch(latestMessages, status)),
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

      set((state) => ({
        abortController,
        ...ensureSessionState(state, sessionId, latestMessages, "", "running"),
      }));
      void setChatDraft(sessionId, "");

      await persistSummary(appendChatMessage(sessionId, userMessage, buildSessionPatch(latestMessages, "running")));
      await persistSummary(appendChatMessage(sessionId, assistantMessage));

      try {
        const stream = runAgentTurn({
          abortSignal: abortController.signal,
          activeFilePath: workspaceState.activeFilePath,
          workspaceRootPath: workspaceState.rootPath,
          conversationHistory,
          defaultAgentMarkdown,
          enabledAgents,
          enabledSkills,
          enabledToolIds,
          prompt: nextInput,
          providerConfig,
          workspaceTools,
        });

        for await (const part of stream) {
          set((state) => {
            const messages = [...(state.messagesBySession[sessionId] ?? [])];
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
            return ensureSessionState(state, sessionId, messages, "", "running");
          });
        }

        if (persistTimer) {
          window.clearTimeout(persistTimer);
          persistTimer = null;
        }
        await persistChain;
        set((state) => ({ abortController: null, ...ensureSessionState(state, sessionId, latestMessages, "", "completed") }));
        await flushAssistant("completed");
      } catch (error) {
        if (persistTimer) {
          window.clearTimeout(persistTimer);
          persistTimer = null;
        }
        await persistChain;

        if (abortController.signal.aborted) {
          const assistant = latestMessages[latestMessages.length - 1];
          if (assistant && isPlaceholderOnly(assistant)) {
            latestMessages = latestMessages.filter((message) => message.id !== assistant.id);
            set((state) => ({ abortController: null, ...ensureSessionState(state, sessionId, latestMessages, "", "idle") }));
            await persistSummary(deleteChatMessage(sessionId, assistant.id, buildSessionPatch(latestMessages, "idle")));
            return;
          }

          set((state) => ({ abortController: null, ...ensureSessionState(state, sessionId, latestMessages, "", "idle") }));
          await flushAssistant("idle");
          return;
        }

        const systemMessage = buildSystemMessage(
          error instanceof Error ? error.message : "Agent 执行失败，请稍后重试。",
          messageMeta,
        );
        latestMessages = [...latestMessages, systemMessage];
        set((state) => ({ abortController: null, ...ensureSessionState(state, sessionId, latestMessages, "", "failed") }));
        await persistSummary(appendChatMessage(sessionId, systemMessage, buildSessionPatch(latestMessages, "failed")));
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
      get().abortController?.abort();
    },
    switchSession: async (sessionId) => {
      if (get().run.status === "running" || sessionId === get().activeSessionId) {
        set({ isHistoryOpen: false });
        return;
      }

      try {
        const bootstrap = await switchChatSession(sessionId);
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




