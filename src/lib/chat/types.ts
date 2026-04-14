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
  activeSessionMessages: AgentMessage[];
  activeSessionDraft: string;
  bookId?: string;
};

export type ChatSessionPatch = {
  title?: string;
  summary?: string;
  status?: AgentRunStatus;
  updatedAt?: string;
  lastMessageAt?: string | null;
};
