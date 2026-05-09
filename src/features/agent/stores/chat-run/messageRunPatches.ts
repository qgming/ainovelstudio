import type { AgentMessage, AgentPart, AgentUsage } from "@features/agent/lib/types";
import { derivePlanningState } from "@features/agent/lib/planning";
import { buildRun, deriveSessionTitle } from "@features/agent/chat/sessionRuntime";
import type { ChatEntry } from "@features/agent/chat/types";
import { ensureSessionState, type ChatRunStoreState } from "./helpers";
import { replaceMessageEntry } from "./entriesRuntime";

type RunPatchContext = {
  abortController: AbortController;
  assistantMessageId: string;
  autopilotGoal: string | null;
  latestEntries: ChatEntry[];
  latestMessages: AgentMessage[];
  runRequestId: string;
};

export function buildPendingSessionPatch(context: RunPatchContext) {
  return {
    abortController: context.abortController,
    activeRunRequestId: context.runRequestId,
    inflightToolRequestIds: [],
    errorMessage: null,
    input: "",
    planningState: derivePlanningState(context.latestMessages),
    run: buildRun(
      "pending-session",
      deriveSessionTitle(context.latestMessages),
      "running",
      context.latestMessages,
    ),
  };
}

export function buildActiveRunPatch(
  state: ChatRunStoreState,
  sessionId: string,
  context: RunPatchContext,
) {
  return {
    abortController: context.abortController,
    activeRunRequestId: context.runRequestId,
    autopilotGoalsBySession: context.autopilotGoal
      ? { ...state.autopilotGoalsBySession, [sessionId]: context.autopilotGoal }
      : state.autopilotGoalsBySession,
    inflightToolRequestIds: [],
    errorMessage: null,
    entriesBySession: { ...state.entriesBySession, [sessionId]: context.latestEntries },
    ...ensureSessionState(state, sessionId, context.latestMessages, "", "running"),
  };
}

export function buildStreamPatch(
  state: ChatRunStoreState,
  sessionId: string,
  part: AgentPart,
  context: RunPatchContext,
) {
  const nextStatus = part.type === "ask-user" && part.status === "awaiting_user"
    ? "awaiting_user"
    : "running";
  return {
    pendingAsk: part.type === "ask-user" && part.status === "completed" ? null : state.pendingAsk,
    entriesBySession: { ...state.entriesBySession, [sessionId]: context.latestEntries },
    ...ensureSessionState(state, sessionId, context.latestMessages, "", nextStatus),
  };
}

export function buildUsagePatch(
  state: ChatRunStoreState,
  sessionId: string,
  usage: AgentUsage,
  context: RunPatchContext,
) {
  if (state.activeRunRequestId !== context.runRequestId) return { patch: state, context };
  const messages = [...(state.messagesBySession[sessionId] ?? [])];
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.id !== context.assistantMessageId) return { patch: state, context };

  messages[messages.length - 1] = {
    ...lastMessage,
    meta: { ...(lastMessage.meta ?? {}), finishReason: usage.finishReason, usage },
  };
  const latestEntries = replaceMessageEntry(context.latestEntries, messages[messages.length - 1]);
  const status = state.pendingAsk || state.run.status === "awaiting_user" ? "awaiting_user" : "running";
  return {
    context: { ...context, latestEntries, latestMessages: messages },
    patch: {
      entriesBySession: { ...state.entriesBySession, [sessionId]: latestEntries },
      ...ensureSessionState(state, sessionId, messages, "", status),
    },
  };
}
