import { invoke } from "@tauri-apps/api/core";
import type { AgentMessage } from "../agent/types";
import type { ChatBootstrap, ChatSessionPatch, ChatSessionSummary } from "./types";

type ChatMessagePayload = Pick<AgentMessage, "id" | "role" | "author" | "parts" | "meta">;

export function initializeChatStorage() {
  return invoke<ChatBootstrap>("initialize_chat_storage");
}

export function createChatSession() {
  return invoke<ChatBootstrap>("create_chat_session");
}

export function switchChatSession(sessionId: string) {
  return invoke<ChatBootstrap>("switch_chat_session", { sessionId });
}

export function deleteChatSession(sessionId: string) {
  return invoke<ChatBootstrap>("delete_chat_session", { sessionId });
}

export function renameChatSession(sessionId: string, title: string) {
  return invoke<ChatSessionSummary>("rename_chat_session", { sessionId, title });
}

export function setChatDraft(sessionId: string, draft: string) {
  return invoke<void>("set_chat_draft", { draft, sessionId });
}

export function appendChatMessage(
  sessionId: string,
  message: ChatMessagePayload,
  sessionPatch?: ChatSessionPatch,
) {
  return invoke<ChatSessionSummary>("append_chat_message", { message, sessionId, sessionPatch });
}

export function updateChatMessage(
  sessionId: string,
  messageId: string,
  parts: AgentMessage["parts"],
  meta?: AgentMessage["meta"],
  sessionPatch?: ChatSessionPatch,
) {
  return invoke<ChatSessionSummary>("update_chat_message", {
    messageId,
    meta,
    parts,
    sessionId,
    sessionPatch,
  });
}

export function deleteChatMessage(sessionId: string, messageId: string, sessionPatch?: ChatSessionPatch) {
  return invoke<ChatSessionSummary>("delete_chat_message", { messageId, sessionId, sessionPatch });
}
