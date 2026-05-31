export type AgentRunStatus =
  | "idle"
  | "running"
  | "awaiting_user"
  | "completed"
  | "failed";

export type StatusTone = "neutral" | "warning" | "success" | "danger";

export type AskSelectionMode = "single" | "multiple";

export type AskOption = {
  id: string;
  label: string;
  description?: string;
};

export type AskToolAnswerValue = {
  type: "option" | "custom";
  id: string;
  label: string;
  value: string;
};

export type AskToolAnswer = {
  selectionMode: AskSelectionMode;
  values: AskToolAnswerValue[];
  usedCustomInput: boolean;
  customInput?: string;
};

export type AskUserRequest = {
  title: string;
  description?: string;
  selectionMode: AskSelectionMode;
  options: AskOption[];
  customOptionId: string;
  customPlaceholder?: string;
  minSelections?: number;
  maxSelections?: number;
  confirmLabel?: string;
};

export type AgentUsage = {
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

export type AgentPart =
  | { type: "placeholder"; text: string }
  | { type: "text"; text: string; messageId?: string }
  | { type: "text-delta"; delta: string; messageId?: string }
  | { type: "reasoning"; summary: string; detail: string; collapsed?: boolean; messageId?: string }
  | {
      type: "tool-call";
      toolName: string;
      toolCallId: string;
      status: AgentRunStatus;
      inputSummary: string;
      outputSummary?: string;
      output?: unknown;
      validationError?: string;
      // 该 part 所属的 assistant 消息 id（adapter 注入）。
      // mergeParts 据此把 part 路由回正确消息，避免续轮换消息时落到错误的 last message。
      messageId?: string;
    }
  | {
      type: "tool-result";
      toolName: string;
      toolCallId: string;
      status: AgentRunStatus;
      outputSummary: string;
      output?: unknown;
      validationError?: string;
      // 该 part 所属的 assistant 消息 id（adapter 注入），用途同 tool-call。
      messageId?: string;
    }
  | {
      type: "ask-user";
      toolName: "ask_user";
      toolCallId: string;
      status: "awaiting_user" | "completed" | "failed";
      title: string;
      description?: string;
      selectionMode: AskSelectionMode;
      options: AskOption[];
      customOptionId: string;
      customPlaceholder?: string;
      minSelections?: number;
      maxSelections?: number;
      confirmLabel?: string;
      answer?: AskToolAnswer;
      errorMessage?: string;
      // 该 part 所属的 assistant 消息 id（adapter 注入），用途同 tool-call。
      messageId?: string;
    }
  ;

export type AgentMessageMeta = {
  activeFilePath?: string | null;
  compactionId?: string | null;
  entryId?: string | null;
  finishReason?: string | null;
  workspaceRootPath?: string | null;
  usage?: AgentUsage | null;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  author: string;
  parts: AgentPart[];
  meta?: AgentMessageMeta;
};

export type AgentRun = {
  id: string;
  status: AgentRunStatus;
  title: string;
  messages: AgentMessage[];
};

export function isToolLikePart(part: AgentPart) {
  return part.type === "tool-call" || part.type === "tool-result";
}

export function getRunStatusTone(status: AgentRunStatus): StatusTone {
  if (status === "running" || status === "awaiting_user") {
    return "warning";
  }

  if (status === "completed") {
    return "success";
  }

  if (status === "failed") {
    return "danger";
  }

  return "neutral";
}
