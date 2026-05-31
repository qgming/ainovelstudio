import type { AgentSessionEvent } from "@features/agent/lib/session";
import type { AgentMessage } from "@features/agent/lib/types";
import { appendChatEntry } from "@features/agent/chat/api";
import { buildMessageEntry, nextEntrySeq } from "@features/agent/chat/entries";
import { buildSessionPatch, createMessageId } from "@features/agent/chat/sessionRuntime";
import type { ChatEntry, ChatSessionSummary, CompactionPayload } from "@features/agent/chat/types";
import { DEFAULT_CHAT_BOOK_ID } from "./helpers";

export type CompactionMarkerResult = {
  entries: ChatEntry[];
  latestCompactionAt: string;
  latestCompactionTokensBefore: number;
  summary: ChatSessionSummary;
};

export function queuePatchFromEvent(event: AgentSessionEvent) {
  if (event.type !== "queue_update") return null;
  return {
    queuedFollowUpMessages: [...event.followUp],
    queuedSteeringMessages: [...event.steering],
  };
}

export function nowEpoch() {
  return Math.floor(Date.now() / 1000).toString();
}

export function appendMessageEntry(entries: ChatEntry[], message: AgentMessage) {
  return [...entries, buildMessageEntry(message, nextEntrySeq(entries), nowEpoch())];
}

export function replaceMessageEntry(entries: ChatEntry[], message: AgentMessage): ChatEntry[] {
  return entries.map((entry) =>
    entry.entryType === "message" && entry.id === message.id
      ? { ...entry, payload: { message } }
      : entry,
  );
}

export function removeEntry(entries: ChatEntry[], entryId: string) {
  return entries.filter((entry) => entry.id !== entryId);
}

function appendCompactionLocalEntry(
  entries: ChatEntry[],
  payload: CompactionPayload,
): ChatEntry[] {
  const createdAt = payload.createdAt ?? nowEpoch();
  return [
    ...entries,
    {
      id: createMessageId("compaction"),
      seq: nextEntrySeq(entries),
      entryType: "compaction",
      payload: { ...payload, createdAt },
      createdAt,
    },
  ];
}

// 在 app entries 追加一条压缩标记并持久化（纯本地，不调 LLM）。
// 真实压缩已由 pi harness.compact() 完成（compactBookSession / runner 自动压缩），
// 这里仅生成 UI 可见的「已压缩」记录，summary 直接取自 pi 的压缩结果。
export async function appendCompactionMarker(params: {
  bookId?: string | null;
  sessionId: string;
  entries: ChatEntry[];
  messages: AgentMessage[];
  summary: string;
  tokensBefore: number;
  firstKeptMessageId?: string | null;
  modelId?: string | null;
}): Promise<CompactionMarkerResult> {
  const payload: CompactionPayload = {
    summary: params.summary,
    tokensBefore: params.tokensBefore,
    firstKeptMessageId: params.firstKeptMessageId ?? null,
    modelId: params.modelId ?? null,
    createdAt: nowEpoch(),
  };

  const entries = appendCompactionLocalEntry(params.entries, payload);
  const summary = await appendChatEntry(
    params.bookId ?? DEFAULT_CHAT_BOOK_ID,
    params.sessionId,
    { id: entries[entries.length - 1].id, entryType: "compaction", payload },
    buildSessionPatch(params.messages, "idle"),
  );

  return {
    entries,
    latestCompactionAt: payload.createdAt ?? nowEpoch(),
    latestCompactionTokensBefore: payload.tokensBefore,
    summary,
  };
}
