/**
 * chatRunStore（原 agentStore）的辅助纯函数与 setter 适配器。
 *
 * 这些 helper 之前内联在 stores/agentStore.ts 顶部，与 store 实现混在一起。
 * 抽出后 store 主体只关心状态机与 actions 编排。
 */

import type {
  AgentMessage,
  AgentRun,
  AgentRunStatus,
} from "../../lib/agent/types";
import { derivePlanningState, type PlanningState } from "../../lib/agent/planning";
import {
  buildInitialRun,
  buildRun,
  deriveSessionTitle,
  isPlaceholderOnly,
  normalizeRecoveredMessages,
  normalizeRecoveredStatus,
  sortSessionSummaries,
} from "../../lib/chat/sessionRuntime";
import type { ChatBootstrap, ChatSessionSummary } from "../../lib/chat/types";
import {
  getStoredDefaultAgentMarkdown,
  useAgentSettingsStore,
} from "../agentSettingsStore";

/** 用于推断当前是否仍有"运行中"语义。store 主体使用同名 selector。 */
export type RunActivityState = {
  abortController: AbortController | null;
  activeRunRequestId: string | null;
  inflightToolRequestIds: string[];
  run: AgentRun;
};

export function selectIsAgentRunActive(state: RunActivityState): boolean {
  return (
    state.activeRunRequestId !== null ||
    state.abortController !== null ||
    state.inflightToolRequestIds.length > 0 ||
    state.run.status === "running"
  );
}

/** chatRunStore 默认绑定的"全局"虚拟 bookId，未传 bookId 时使用。 */
export const DEFAULT_CHAT_BOOK_ID = "__global__";

export type ChatRunStoreState = {
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
  status: "idle" | "loading" | "ready" | "error";
};

/** 构造 store 的初始状态。 */
export function buildInitialState(): ChatRunStoreState {
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

/** 当本地仍在运行时，强制把 summary 标记为 running，避免持久化态盖掉本地实时态。 */
export function getPersistedSummaryStatus(
  state: ChatRunStoreState,
  summary: ChatSessionSummary,
): AgentRunStatus {
  if (state.activeSessionId === summary.id && selectIsAgentRunActive(state)) {
    return "running";
  }
  return normalizeRecoveredStatus(summary.status);
}

/** 把任意错误格式化为可展示的人类文本。 */
export function formatAgentError(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallbackMessage;
}

/** 把 summary 合并/替换进 sessions 列表并按规则排序。 */
export function upsertSessionSummary(
  sessions: ChatSessionSummary[],
  summary: ChatSessionSummary,
): ChatSessionSummary[] {
  const filtered = sessions.filter((candidate) => candidate.id !== summary.id);
  return sortSessionSummaries([...filtered, summary]);
}

/** 把 ChatBootstrap 应用到 store state，得到 partial 更新。 */
export function applyBootstrap(
  state: ChatRunStoreState,
  bootstrap: ChatBootstrap,
): Partial<ChatRunStoreState> {
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
    nextMessagesBySession[bootstrap.activeSessionId] = normalizeRecoveredMessages(
      bootstrap.activeSessionMessages,
    );
    nextDraftsBySession[bootstrap.activeSessionId] = bootstrap.activeSessionDraft;
  }

  const activeSummary = bootstrap.activeSessionId
    ? (normalizedSessions.find((session) => session.id === bootstrap.activeSessionId) ?? null)
    : null;
  const activeMessages = bootstrap.activeSessionId
    ? (nextMessagesBySession[bootstrap.activeSessionId] ?? [])
    : [];
  const planningState = derivePlanningState(activeMessages);

  return {
    activeSessionId: bootstrap.activeSessionId,
    currentBookId: bootstrap.bookId ?? state.currentBookId,
    draftsBySession: nextDraftsBySession,
    errorMessage: null,
    input: bootstrap.activeSessionId
      ? (nextDraftsBySession[bootstrap.activeSessionId] ?? "")
      : "",
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

/** 把指定 session 的 messages/input/status 写回 store，并联动 run/planningState。 */
export function ensureSessionState(
  state: ChatRunStoreState,
  sessionId: string,
  messages: AgentMessage[],
  input: string,
  status: AgentRunStatus,
): Partial<ChatRunStoreState> {
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

/** zustand setter 的最小签名，避免依赖 ChatRunStore 完整类型造成循环引用。 */
export type ChatRunStoreSetter<S extends ChatRunStoreState = ChatRunStoreState> = (
  partial: Partial<S> | ((state: S) => Partial<S>),
  replace?: false,
) => void;

/** 把持久化返回的 summary 应用到 store，必要时同步到当前 run。 */
export function applyPersistedSummary<S extends ChatRunStoreState>(
  set: ChatRunStoreSetter<S>,
  summary: ChatSessionSummary,
): void {
  set((state) => {
    const normalizedSummary = {
      ...summary,
      status: getPersistedSummaryStatus(state, summary),
    };
    const sessions = upsertSessionSummary(state.sessions, normalizedSummary);
    if (state.activeSessionId !== normalizedSummary.id) {
      return { sessions } as Partial<S>;
    }
    return {
      run: buildRun(
        normalizedSummary.id,
        normalizedSummary.title,
        normalizedSummary.status,
        state.messagesBySession[normalizedSummary.id] ?? [],
      ),
      sessions,
    } as Partial<S>;
  });
}

/** 增/删 inflight tool request id，集中维护避免重复实现。 */
export function trackInflightToolRequest<S extends ChatRunStoreState>(
  set: ChatRunStoreSetter<S>,
  requestId: string,
  action: "start" | "finish",
): void {
  set((state) => {
    const nextIds =
      action === "start"
        ? Array.from(new Set([...state.inflightToolRequestIds, requestId]))
        : state.inflightToolRequestIds.filter((id) => id !== requestId);
    return { inflightToolRequestIds: nextIds } as Partial<S>;
  });
}

/** 处理 abort 时的 assistant 占位消息：仅留 placeholder 时清掉，避免空消息留在历史里。 */
export function resolveAbortedAssistantState(
  latestMessages: AgentMessage[],
  assistantMessageId: string,
): {
  assistant: AgentMessage | null;
  messages: AgentMessage[];
  removePlaceholder: boolean;
} {
  const assistant = latestMessages[latestMessages.length - 1];
  if (assistant && assistant.id === assistantMessageId && isPlaceholderOnly(assistant)) {
    return {
      assistant,
      messages: latestMessages.filter((message) => message.id !== assistant.id),
      removePlaceholder: true,
    };
  }
  return { assistant: null, messages: latestMessages, removePlaceholder: false };
}

/** 生成新一次 run 的请求 ID，用于 set/get 之间识别"是否还是同一轮"。 */
export function buildRunRequestId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 拉取主代理 markdown：若设置中尚未加载则触发 initialize。 */
export async function ensureMainAgentMarkdown(): Promise<string> {
  const settings = useAgentSettingsStore.getState();
  if (settings.defaultAgentMarkdown.trim()) {
    return settings.defaultAgentMarkdown;
  }
  await settings.initialize();
  return (
    useAgentSettingsStore.getState().defaultAgentMarkdown || getStoredDefaultAgentMarkdown()
  );
}

/** 简单封装：等待 agent 设置 store ready。 */
export async function ensureAgentSettingsReady() {
  await useAgentSettingsStore.getState().initialize();
  return useAgentSettingsStore.getState();
}
