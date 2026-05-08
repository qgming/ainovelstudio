import { appendChatEntry } from "../../lib/chat/api";
import { getCompactionCount } from "../../lib/chat/entries";
import type { ChatEntry, ChatSessionSummary } from "../../lib/chat/types";
import { generateCompactionPayload } from "../../lib/agent/compaction";
import type { AgentProviderConfig } from "../agentSettingsStore";
import { appendCompactionLocalEntry, nowEpoch } from "./persistenceAdapter";
import { DEFAULT_CHAT_BOOK_ID } from "./helpers";
import { buildSessionPatch } from "../../lib/chat/sessionRuntime";
import type { AgentMessage } from "../../lib/agent/types";

export type CompactionControllerResult = {
  entries: ChatEntry[];
  latestCompactionAt: string;
  latestCompactionTokensBefore: number;
  summary: ChatSessionSummary;
};

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
