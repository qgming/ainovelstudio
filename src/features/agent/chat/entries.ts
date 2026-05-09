import type { AgentMessage } from "@features/agent/lib/types";
import type { ChatEntry, CompactionChatEntry, MessageChatEntry } from "./types";

export function isMessageEntry(entry: ChatEntry): entry is MessageChatEntry {
  return entry.entryType === "message"
    && typeof entry.payload === "object"
    && entry.payload !== null
    && "message" in entry.payload;
}

export function isCompactionEntry(entry: ChatEntry): entry is CompactionChatEntry {
  return entry.entryType === "compaction"
    && typeof entry.payload === "object"
    && entry.payload !== null
    && "summary" in entry.payload;
}

export function entryToMessage(entry: ChatEntry): AgentMessage | null {
  return isMessageEntry(entry) ? entry.payload.message : null;
}

export function entriesToMessages(entries: ChatEntry[]) {
  return entries
    .map((entry) => entryToMessage(entry))
    .filter((message): message is AgentMessage => Boolean(message));
}

export function getLatestCompactionEntry(entries: ChatEntry[]) {
  return [...entries].reverse().find(isCompactionEntry) ?? null;
}

export function getCompactionCount(entries: ChatEntry[]) {
  return entries.filter(isCompactionEntry).length;
}

export function getMessagesAfterLatestCompaction(entries: ChatEntry[]) {
  const compaction = getLatestCompactionEntry(entries);
  if (!compaction) return entriesToMessages(entries);

  let foundKept = !compaction.payload.firstKeptMessageId;
  const kept: AgentMessage[] = [];
  for (const entry of entries) {
    if (entry.id === compaction.id) {
      foundKept = true;
      kept.length = 0;
      continue;
    }

    const message = entryToMessage(entry);
    if (!message) continue;
    if (message.id === compaction.payload.firstKeptMessageId) foundKept = true;
    if (foundKept) kept.push(message);
  }
  return kept;
}

export function nextEntrySeq(entries: ChatEntry[]) {
  return entries.reduce((max, entry) => Math.max(max, entry.seq), 0) + 1;
}

export function buildMessageEntry(message: AgentMessage, seq: number, createdAt: string): MessageChatEntry {
  return {
    id: message.id,
    seq,
    entryType: "message",
    payload: { message },
    createdAt,
  };
}
