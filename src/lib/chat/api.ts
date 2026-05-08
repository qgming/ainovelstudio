import { invoke } from "@tauri-apps/api/core";
import type { ChatBootstrap, ChatEntry, ChatEntryInput, ChatSessionPatch, ChatSessionSummary } from "./types";

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

export function loadChatEntries(bookId: string, sessionId: string) {
  return invoke<ChatEntry[]>("load_chat_entries", { bookId, sessionId });
}

export function appendChatEntry(
  bookId: string,
  sessionId: string,
  entry: ChatEntryInput,
  sessionPatch?: ChatSessionPatch,
) {
  return invoke<ChatSessionSummary>("append_chat_entry", { bookId, entry, sessionId, sessionPatch });
}

export function updateChatEntry(
  bookId: string,
  sessionId: string,
  entryId: string,
  payload: unknown,
  sessionPatch?: ChatSessionPatch,
) {
  return invoke<ChatSessionSummary>("update_chat_entry", {
    bookId,
    entryId,
    payload,
    sessionId,
    sessionPatch,
  });
}

export function deleteChatEntry(
  bookId: string,
  sessionId: string,
  entryId: string,
  sessionPatch?: ChatSessionPatch,
) {
  return invoke<ChatSessionSummary>("delete_chat_entry", { bookId, entryId, sessionId, sessionPatch });
}

export function appendCompactionEntry(
  bookId: string,
  sessionId: string,
  summary: string,
  tokensBefore: number,
  firstKeptMessageId?: string | null,
  sessionPatch?: ChatSessionPatch,
) {
  return invoke<ChatSessionSummary>("append_compaction_entry", {
    bookId,
    firstKeptMessageId,
    sessionId,
    sessionPatch,
    summary,
    tokensBefore,
  });
}
