import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { generateAgentText } from "./modelGateway";
import type { AgentMessage, AgentUsage } from "./types";
import { extractMessageText } from "../chat/sessionRuntime";
import type { ChatEntry, CompactionPayload } from "../chat/types";
import { entriesToMessages, getLatestCompactionEntry, isMessageEntry } from "../chat/entries";

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
export const DEFAULT_COMPACTION_RESERVE_TOKENS = 16000;
export const DEFAULT_KEEP_RECENT_TOKENS = 24000;

export type CompactionSettings = {
  contextWindowTokens?: number;
  reserveTokens?: number;
  keepRecentTokens?: number;
};

export type PreparedCompaction = {
  firstKeptMessageId: string | null;
  messagesToSummarize: AgentMessage[];
  previousSummary: string | null;
  tokensBefore: number;
};

function estimateMessageTokens(message: AgentMessage) {
  return Math.ceil(extractMessageText(message).length / 4);
}

export function shouldCompactUsage(
  usage: AgentUsage,
  settings: CompactionSettings = {},
) {
  const windowTokens = settings.contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
  const reserve = settings.reserveTokens ?? DEFAULT_COMPACTION_RESERVE_TOKENS;
  return usage.totalTokens > windowTokens - reserve;
}

export function prepareCompaction(
  entries: ChatEntry[],
  settings: CompactionSettings = {},
): PreparedCompaction | null {
  const keepRecentTokens = settings.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS;
  const messageEntries = entries.filter(isMessageEntry);
  if (messageEntries.length < 4) return null;

  let recentTokens = 0;
  let firstKeptIndex = messageEntries.length - 1;
  for (let index = messageEntries.length - 1; index >= 0; index -= 1) {
    recentTokens += estimateMessageTokens(messageEntries[index].payload.message);
    firstKeptIndex = index;
    if (recentTokens >= keepRecentTokens) break;
  }

  if (firstKeptIndex <= 1) return null;
  const latestCompaction = getLatestCompactionEntry(entries);
  const messagesToSummarize = messageEntries
    .slice(0, firstKeptIndex)
    .map((entry) => entry.payload.message);
  const tokensBefore = entriesToMessages(entries).reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );

  return {
    firstKeptMessageId: messageEntries[firstKeptIndex]?.payload.message.id ?? null,
    messagesToSummarize,
    previousSummary: latestCompaction?.payload.summary ?? null,
    tokensBefore,
  };
}

function serializeMessage(message: AgentMessage) {
  return `${message.role}: ${extractMessageText(message)}`;
}

function buildCompactionPrompt(preparation: PreparedCompaction, customInstructions?: string) {
  return [
    "请为网文创作长会话生成一份可继续写作的上下文压缩摘要。",
    "要求：保留主线目标、人物状态、世界观设定、写作风格、已完成进展、未完成任务、关键文件路径。",
    "输出使用简体中文，结构清晰，避免寒暄。",
    customInstructions ? `额外要求：${customInstructions}` : null,
    preparation.previousSummary ? `\n## 上一次压缩摘要\n${preparation.previousSummary}` : null,
    "\n## 本次需要压缩的消息",
    preparation.messagesToSummarize.map(serializeMessage).join("\n\n"),
  ].filter(Boolean).join("\n");
}

export async function generateCompactionPayload(params: {
  abortSignal?: AbortSignal;
  customInstructions?: string;
  entries: ChatEntry[];
  modelId?: string | null;
  providerConfig: AgentProviderConfig;
  settings?: CompactionSettings;
}): Promise<CompactionPayload | null> {
  const preparation = prepareCompaction(params.entries, params.settings);
  if (!preparation) return null;

  const summary = await generateAgentText({
    prompt: buildCompactionPrompt(preparation, params.customInstructions),
    providerConfig: params.providerConfig,
    system: "你是神笔写作的线性长会话压缩器，只输出可供后续创作继续使用的摘要。",
  });

  return {
    summary,
    tokensBefore: preparation.tokensBefore,
    firstKeptMessageId: preparation.firstKeptMessageId,
    modelId: params.modelId ?? params.providerConfig.model,
    createdAt: Math.floor(Date.now() / 1000).toString(),
  };
}
