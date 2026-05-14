import type { AgentMessage } from "../types";
import { buildHybridHistorySummary, estimateMessagesChars } from "./memory";
import { serializeAgentMessage, serializeAgentMessageToModelMessages } from "./serialization";
import {
  MAX_DETAILED_HISTORY_MESSAGES,
  MAX_HISTORY_CHAR_BUDGET,
  MAX_HISTORY_TURNS,
  type HistorySummaryOptions,
  type SerializedHistoryMessage,
  type TextConversationMessage,
} from "./types";

function normalizeCurrentUserContent(currentUserContent: string | string[]) {
  return (Array.isArray(currentUserContent) ? currentUserContent : [currentUserContent])
    .map((content) => content.trim())
    .filter(Boolean);
}

function trimRecentMessagesToBudget(
  messages: SerializedHistoryMessage[],
  currentUserContent: string | string[],
  prefixSummary: string,
) {
  const kept: SerializedHistoryMessage[] = [];
  const currentUserContentText = normalizeCurrentUserContent(currentUserContent).join("\n\n");
  let remainingBudget =
    MAX_HISTORY_CHAR_BUDGET - currentUserContentText.length - prefixSummary.length;

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

function buildDetailedHistoryMessages(
  historyMessages: AgentMessage[],
  compactBoundary: number,
) {
  return historyMessages
    .slice(compactBoundary)
    .flatMap((message) => serializeAgentMessageToModelMessages(message));
}

function buildTrimmedDetailedHistoryMessages(
  recentHistory: AgentMessage[],
  compactBoundary: number,
  currentUserMessages: string[],
  historySummary: string,
) {
  const detailedEntries = recentHistory
    .slice(compactBoundary)
    .map((message) => ({
      message,
      serialized: serializeAgentMessage(message, "detailed"),
    }))
    .filter((entry): entry is { message: AgentMessage; serialized: SerializedHistoryMessage } =>
      Boolean(entry.serialized),
    );
  const keptSerialized = new Set(
    trimRecentMessagesToBudget(
      detailedEntries.map((entry) => entry.serialized),
      currentUserMessages,
      historySummary,
    ),
  );

  return detailedEntries
    .filter((entry) => keptSerialized.has(entry.serialized))
    .flatMap((entry) => serializeAgentMessageToModelMessages(entry.message));
}

export async function buildConversationMessages(
  historyMessages: AgentMessage[],
  currentUserContent: string | string[],
  options?: HistorySummaryOptions,
): Promise<TextConversationMessage[]> {
  const currentUserMessages = normalizeCurrentUserContent(currentUserContent);
  const currentUserContentText = currentUserMessages.join("\n\n");
  const recentHistory = historyMessages.slice(-MAX_HISTORY_TURNS);
  const compactBoundary = Math.max(
    0,
    recentHistory.length - MAX_DETAILED_HISTORY_MESSAGES,
  );
  const serializedHistory = recentHistory
    .map((message, index) =>
      serializeAgentMessage(message, index < compactBoundary ? "compact" : "detailed"))
    .filter((message): message is SerializedHistoryMessage => Boolean(message));
  const detailedHistory = buildDetailedHistoryMessages(recentHistory, compactBoundary);
  const needsSummaryCompact =
    estimateMessagesChars(serializedHistory, currentUserContentText) > MAX_HISTORY_CHAR_BUDGET;
  const historySummary = needsSummaryCompact
    ? await buildHybridHistorySummary(
        serializedHistory.slice(0, compactBoundary),
        currentUserContentText,
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
        ...buildTrimmedDetailedHistoryMessages(
          recentHistory,
          compactBoundary,
          currentUserMessages,
          historySummary,
        ),
      ]
    : [
        ...serializedHistory.slice(0, compactBoundary).map((message) => toModelMessage(message)),
        ...detailedHistory,
      ];

  return [
    ...history,
    ...currentUserMessages.map((content) => ({
      role: "user" as const,
      content,
    })),
  ];
}
