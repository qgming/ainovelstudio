import type { ModelMessage } from "ai";

export const MAX_HISTORY_TURNS = 20;
export const MAX_DETAILED_HISTORY_MESSAGES = 6;
export const MAX_HISTORY_CHAR_BUDGET = 14_000;
export const MAX_USER_MESSAGE_CHARS = 1_600;
export const MAX_ASSISTANT_MESSAGE_CHARS = 2_400;
export const MAX_COMPACT_MESSAGE_CHARS = 360;
export const MAX_TOOL_PREVIEW_CHARS = 1_400;
export const MAX_COMPACT_TOOL_PREVIEW_CHARS = 220;
export const MAX_TOOL_TARGET_CHARS = 220;
export const MAX_HISTORY_SUMMARY_ITEMS = 4;
export const MAX_HISTORY_SUMMARY_PATHS = 6;
export const MAX_MODEL_MEMORY_CHARS = 900;

export type SerializationMode = "compact" | "detailed";

export type SerializedHistoryMessage = {
  content: string;
  paths: string[];
  role: "assistant" | "user";
  tools: string[];
};

export type TextConversationMessage = Extract<ModelMessage, { role: "assistant" | "user" }> & {
  content: string;
};

export type TaskMemory = {
  constraints: string[];
  facts: string[];
  paths: string[];
  progress: string[];
  tools: string[];
  userGoals: string[];
};

export type HistorySummaryModelInput = {
  compactHistory: SerializedHistoryMessage[];
  currentUserContent: string;
  taskMemory: TaskMemory;
};

export type HistorySummaryOptions = {
  summarizeHistory?: (input: HistorySummaryModelInput) => Promise<string | null>;
};
