import { buildAssistantPlaceholderMessage, buildMessageMeta, buildUserMessage } from "@features/agent/chat/sessionRuntime";
import type { AgentMode } from "@features/agent/lib/modes/modeRules";
import type { AgentMessage } from "@features/agent/lib/types";
import type { ChatEntry } from "@features/agent/chat/types";
import { useBookWorkspaceStore } from "@features/books/stores/useBookWorkspaceStore";
import { appendMessageEntry } from "./entriesRuntime";
import { buildRunRequestId } from "./helpers";
import type { ChatRunStoreAccess, SendMessageRequest } from "./runtimeTypes";

export type RunContext = {
  activeModeId: AgentMode;
  autopilotGoal: string | null;
  autopilotIteration: number;
  nextInput: string;
  runRequestId: string;
};

export type RunConversation = {
  conversationEntries: ChatEntry[];
  conversationHistory: AgentMessage[];
  latestEntries: ChatEntry[];
  latestMessages: AgentMessage[];
};

export function appendRunConversation(
  conversationEntries: ChatEntry[],
  conversationHistory: AgentMessage[],
  userMessage: AgentMessage,
  assistantMessage: AgentMessage,
): RunConversation {
  const latestEntries = appendMessageEntry(
    appendMessageEntry([...conversationEntries], userMessage),
    assistantMessage,
  );
  const latestMessages = [...conversationHistory, userMessage, assistantMessage];
  return { conversationEntries, conversationHistory, latestEntries, latestMessages };
}

export function createMessageRunSeed(params: ChatRunStoreAccess & { request: SendMessageRequest }) {
  const state = params.get();
  const workspaceState = useBookWorkspaceStore.getState();
  const nextInput = params.request.promptOverride ?? state.input.trim();
  const activeModeId = params.request.options?.modeId ?? state.activeModeId;
  const autopilotGoal = activeModeId === "autopilot"
    ? params.request.options?.autopilotGoal ?? nextInput
    : null;
  const messageMeta = buildMessageMeta(workspaceState.rootPath, workspaceState.activeFilePath);
  const userMessage = buildUserMessage(nextInput, messageMeta);
  const assistantMessage = buildAssistantPlaceholderMessage(messageMeta);
  return {
    assistantMessage,
    context: {
      activeModeId,
      autopilotGoal,
      autopilotIteration: params.request.options?.autopilotIteration ?? 1,
      nextInput,
      runRequestId: buildRunRequestId(),
    },
    messageMeta,
    sessionId: state.activeSessionId,
    userMessage,
    ...buildRunConversation(params, state.activeSessionId, userMessage, assistantMessage),
  };
}

export function buildRunConversation(
  access: ChatRunStoreAccess,
  sessionId: string | null,
  userMessage: AgentMessage,
  assistantMessage: AgentMessage,
): RunConversation {
  const conversationEntries = sessionId ? access.get().entriesBySession[sessionId] ?? [] : [];
  const conversationHistory = sessionId ? access.get().messagesBySession[sessionId] ?? [] : [];
  return appendRunConversation(conversationEntries, conversationHistory, userMessage, assistantMessage);
}
