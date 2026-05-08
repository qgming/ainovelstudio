import type { AgentMessage, AgentRunStatus } from "../agent/types";

export type ChatSessionSummary = {
  bookId?: string;
  id: string;
  title: string;
  summary: string;
  status: AgentRunStatus;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  pinned: boolean;
  archived: boolean;
};

export type ChatBootstrap = {
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  activeSessionEntries: ChatEntry[];
  activeSessionDraft: string;
  bookId?: string;
};

export type MessageEntryPayload = {
  message: AgentMessage;
};

export type CompactionPayload = {
  summary: string;
  tokensBefore: number;
  firstKeptMessageId?: string | null;
  modelId?: string | null;
  createdAt?: string | null;
};

export type MessageChatEntry = {
  id: string;
  seq: number;
  entryType: "message";
  payload: MessageEntryPayload;
  createdAt: string;
};

export type CompactionChatEntry = {
  id: string;
  seq: number;
  entryType: "compaction";
  payload: CompactionPayload;
  createdAt: string;
};

export type UnknownChatEntry = {
  id: string;
  seq: number;
  entryType: string;
  payload: unknown;
  createdAt: string;
};

export type ChatEntry = MessageChatEntry | CompactionChatEntry | UnknownChatEntry;

export type ChatEntryInput = {
  id?: string;
  entryType: string;
  payload: unknown;
};

export type ChatSessionPatch = {
  title?: string;
  summary?: string;
  status?: AgentRunStatus;
  updatedAt?: string;
  lastMessageAt?: string | null;
};
