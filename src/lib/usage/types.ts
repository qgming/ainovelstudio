export type UsageSourceType = "chat" | "workflow" | "expansion";

export type UsageLogEntry = {
  messageId: string;
  sessionId: string;
  sessionTitle: string;
  /** 来源模式：图书 Agent / 工作流 / 创作台。 */
  sourceType: UsageSourceType;
  /** 来源名称：会话标题 / 工作流名 / 创作台动作名。 */
  sourceName: string;
  bookName: string;
  createdAt: string;
  recordedAt: string;
  provider: string;
  modelId: string;
  finishReason: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  noCacheTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};
