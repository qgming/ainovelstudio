import type { AgentMessage } from "../types";
import { buildHybridHistorySummary, estimateMessagesChars } from "./memory";
import { serializeAgentMessage } from "./serialization";
import {
  MAX_DETAILED_HISTORY_MESSAGES,
  MAX_HISTORY_CHAR_BUDGET,
  MAX_HISTORY_TURNS,
  type HistorySummaryOptions,
  type SerializedHistoryMessage,
  type TextConversationMessage,
} from "./types";

function trimRecentMessagesToBudget(
  messages: SerializedHistoryMessage[],
  currentUserContent: string,
  prefixSummary: string,
) {
  const kept: SerializedHistoryMessage[] = [];
  let remainingBudget =
    MAX_HISTORY_CHAR_BUDGET - currentUserContent.length - prefixSummary.length;

  for (const message of [...messages].reverse()) {
    if (message.content.length > remainingBudget && kept.length > 0) {
      continue;
    }

    kept.unshift(message);
    remainingBudget -= message.content.length;
    if (remainingBudget <= 0) {
      break;
    }
  }

  return kept;
}

function toModelMessage(message: SerializedHistoryMessage): TextConversationMessage {
  return {
    role: message.role,
    content: message.content,
  };
}

export async function buildConversationMessages(
  historyMessages: AgentMessage[],
  currentUserContent: string,
  options?: HistorySummaryOptions,
): Promise<TextConversationMessage[]> {
  const recentHistory = historyMessages.slice(-MAX_HISTORY_TURNS);
  const compactBoundary = Math.max(
    0,
    recentHistory.length - MAX_DETAILED_HISTORY_MESSAGES,
  );
  const serializedHistory = recentHistory
    .map((message, index) =>
      serializeAgentMessage(message, index < compactBoundary ? "compact" : "detailed"))
    .filter((message): message is SerializedHistoryMessage => Boolean(message));
  const needsSummaryCompact =
    estimateMessagesChars(serializedHistory, currentUserContent) > MAX_HISTORY_CHAR_BUDGET;
  const historySummary = needsSummaryCompact
    ? await buildHybridHistorySummary(
        serializedHistory.slice(0, compactBoundary),
        currentUserContent,
        options?.summarizeHistory,
      )
    : "";
  const history = needsSummaryCompact
    ? [
        ...(historySummary
          ? [{
              role: "user" as const,
              content: historySummary,
            }]
          : []),
        ...trimRecentMessagesToBudget(
          serializedHistory.slice(compactBoundary),
          currentUserContent,
          historySummary,
        ).map((message) => toModelMessage(message)),
      ]
    : serializedHistory.map((message) => toModelMessage(message));

  return [
    ...history,
    {
      role: "user",
      content: currentUserContent,
    },
  ];
}
