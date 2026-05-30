import type { ModelMessage } from "./message-context/modelMessage";
import type { ChatEntry } from "../chat/types";
import { getLatestCompactionEntry, getMessagesAfterLatestCompaction } from "../chat/entries";
import type { AgentMessage } from "./types";
import { buildConversationMessages, type HistorySummaryOptions } from "./messageContext";

function buildCompactionMessage(summary: string): ModelMessage {
  return {
    role: "user",
    content: [
      "## 历史压缩摘要",
      summary,
      "",
      "以上摘要是当前线性长会话中较早内容的压缩结果。继续写作时应保持人物、设定、文风和已完成进展一致。",
    ].join("\n"),
  };
}

export async function buildLinearConversationMessages(
  params: {
    entries?: ChatEntry[];
    history?: AgentMessage[];
    currentUserContent: string | string[];
    summaryOptions?: HistorySummaryOptions;
  },
): Promise<ModelMessage[]> {
  if (!params.entries) {
    return buildConversationMessages(
      params.history ?? [],
      params.currentUserContent,
      params.summaryOptions,
    );
  }

  const compaction = getLatestCompactionEntry(params.entries);
  const keptMessages = getMessagesAfterLatestCompaction(params.entries);
  const messages = await buildConversationMessages(
    keptMessages,
    params.currentUserContent,
    params.summaryOptions,
  );
  const summary = compaction?.payload.summary.trim();
  return summary ? [buildCompactionMessage(summary), ...messages] : messages;
}
