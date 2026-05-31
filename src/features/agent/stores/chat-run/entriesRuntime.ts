import { generateCompactionPayload } from "@features/agent/lib/prompt-context/contextCompaction";
import type { AgentSessionEvent } from "@features/agent/lib/session";
import type { AgentMessage } from "@features/agent/lib/types";
import { appendChatEntry } from "@features/agent/chat/api";
import { buildMessageEntry, getCompactionCount, nextEntrySeq } from "@features/agent/chat/entries";
import { buildSessionPatch, createMessageId } from "@features/agent/chat/sessionRuntime";
import type { ChatEntry, ChatSessionSummary, CompactionPayload } from "@features/agent/chat/types";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { DEFAULT_CHAT_BOOK_ID } from "./helpers";

export type CompactionControllerResult = {
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

export async function compactChatEntries(params: {
  bookId?: string | null;
  entries: ChatEntry[];
  messages: AgentMessage[];
  providerConfig: AgentProviderConfig;
  sessionId: string;
}): Promise<CompactionControllerResult | null> {
  const payload = await generateCompactionPayload({
    entries: params.entries,
    modelId: params.providerConfig.model,
    providerConfig: params.providerConfig,
  });
  if (!payload) return null;

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

export function buildCompactionState(entries: ChatEntry[], result: CompactionControllerResult) {
  return {
    compactionCount: getCompactionCount(entries),
    latestCompactionAt: result.latestCompactionAt,
    latestCompactionTokensBefore: result.latestCompactionTokensBefore,
  };
}
