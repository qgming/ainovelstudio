export type UsageLogEntry = {
  messageId: string;
  sessionId: string;
  sessionTitle: string;
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
