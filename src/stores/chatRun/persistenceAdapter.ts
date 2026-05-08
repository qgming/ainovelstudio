import type { AgentMessage } from "../../lib/agent/types";
import { buildMessageEntry, nextEntrySeq } from "../../lib/chat/entries";
import type { ChatEntry, CompactionPayload } from "../../lib/chat/types";

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

export function appendCompactionLocalEntry(
  entries: ChatEntry[],
  payload: CompactionPayload,
): ChatEntry[] {
  const createdAt = payload.createdAt ?? nowEpoch();
  return [
    ...entries,
    {
      id: `compaction-${Date.now()}`,
      seq: nextEntrySeq(entries),
      entryType: "compaction",
      payload: { ...payload, createdAt },
      createdAt,
    },
  ];
}
