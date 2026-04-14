import { invoke } from "@tauri-apps/api/core";
import type { AgentMessage } from "../agent/types";
import type { ChatBootstrap, ChatSessionPatch, ChatSessionSummary } from "./types";

type ChatMessagePayload = Pick<AgentMessage, "id" | "role" | "author" | "parts" | "meta">;

export function initializeChatStorage(bookId = "__global__") {
  return invoke<ChatBootstrap>("initialize_chat_storage", { bookId });
}

export function createChatSession(bookId: string) {
  return invoke<ChatBootstrap>("create_chat_session", { bookId });
}

export function switchChatSession(bookId: string, sessionId: string) {
  return invoke<ChatBootstrap>("switch_chat_session", { bookId, sessionId });
}

export function deleteChatSession(bookId: string, sessionId: string) {
  return invoke<ChatBootstrap>("delete_chat_session", { bookId, sessionId });
}

export function renameChatSession(bookId: string, sessionId: string, title: string) {
  return invoke<ChatSessionSummary>("rename_chat_session", { bookId, sessionId, title });
}

export function setChatDraft(sessionId: string, draft: string) {
  return invoke<void>("set_chat_draft", { draft, sessionId });
}

export function appendChatMessage(
  bookId: string,
  sessionId: string,
  message: ChatMessagePayload,
  sessionPatch?: ChatSessionPatch,
) {
  return invoke<ChatSessionSummary>("append_chat_message", { bookId, message, sessionId, sessionPatch });
}

export function updateChatMessage(
  bookId: string,
  sessionId: string,
  messageId: string,
  parts: AgentMessage["parts"],
  meta?: AgentMessage["meta"],
  sessionPatch?: ChatSessionPatch,
) {
  return invoke<ChatSessionSummary>("update_chat_message", {
    bookId,
    messageId,
    meta,
    parts,
    sessionId,
    sessionPatch,
  });
}

export function deleteChatMessage(
  bookId: string,
  sessionId: string,
  messageId: string,
  sessionPatch?: ChatSessionPatch,
) {
  return invoke<ChatSessionSummary>("delete_chat_message", { bookId, messageId, sessionId, sessionPatch });
}
