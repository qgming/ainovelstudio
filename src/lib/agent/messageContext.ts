import type { ModelMessage } from "ai";
import type { AgentMessage, AgentPart } from "./types";

const MAX_HISTORY_TURNS = 20;
const MAX_DETAILED_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHAR_BUDGET = 14_000;
const MAX_USER_MESSAGE_CHARS = 1_600;
const MAX_ASSISTANT_MESSAGE_CHARS = 2_400;
const MAX_COMPACT_MESSAGE_CHARS = 360;
const MAX_TOOL_PREVIEW_CHARS = 1_400;
const MAX_COMPACT_TOOL_PREVIEW_CHARS = 220;
const MAX_HISTORY_SUMMARY_ITEMS = 4;
const MAX_HISTORY_SUMMARY_PATHS = 6;

type SerializationMode = "compact" | "detailed";

type SerializedHistoryMessage = {
  content: string;
  paths: string[];
  role: "assistant" | "user";
  tools: string[];
};

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxChars: number) {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars).trimEnd()}…`;
}

function tryParseJson(text: string) {
  const normalized = text.trim();
  if (!normalized.startsWith("{") && !normalized.startsWith("[")) {
    return null;
  }

  try {
    return JSON.parse(normalized) as unknown;
  } catch {
    return null;
  }
}

function collectPathLikeStrings(value: unknown, bucket: Set<string>, depth = 0) {
  if (depth > 3 || value == null) {
    return;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (/[\\/]/.test(normalized) && normalized.length <= 180) {
      bucket.add(normalized);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectPathLikeStrings(entry, bucket, depth + 1));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  Object.entries(value).forEach(([key, candidate]) => {
    if (typeof candidate === "string" && /path$/i.test(key) && candidate.trim()) {
      bucket.add(candidate.trim());
      return;
    }

    collectPathLikeStrings(candidate, bucket, depth + 1);
  });
}

function extractPathsFromToolPart(part: Extract<AgentPart, { type: "tool-call" | "tool-result" }>) {
  const paths = new Set<string>();
  const parsedInput = "inputSummary" in part ? tryParseJson(part.inputSummary) : null;
  const parsedOutput = "outputSummary" in part ? tryParseJson(part.outputSummary) : null;

  if (parsedInput) {
    collectPathLikeStrings(parsedInput, paths);
  }
  if (parsedOutput) {
    collectPathLikeStrings(parsedOutput, paths);
  }

  return Array.from(paths);
}

function formatToolOutput(
  part: Extract<AgentPart, { type: "tool-result" }>,
  maxChars: number,
) {
  return truncateText(part.outputSummary, maxChars);
}

function serializeToolCall(
  part: Extract<AgentPart, { type: "tool-call" }>,
  maxChars: number,
) {
  return [
    `工具调用 [${part.toolCallId}] ${part.toolName}`,
    compactText(part.inputSummary)
      ? `输入摘要：${truncateText(part.inputSummary, maxChars)}`
      : null,
    compactText(part.validationError ?? "")
      ? `校验异常：${compactText(part.validationError ?? "")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function serializeToolResult(
  part: Extract<AgentPart, { type: "tool-result" }>,
  maxChars: number,
) {
  const output = formatToolOutput(part, maxChars);
  return [
    `工具结果 [${part.toolCallId}] ${part.toolName}`,
    output ? `输出摘要：${output}` : null,
    compactText(part.validationError ?? "")
      ? `校验异常：${compactText(part.validationError ?? "")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function hasExplicitToolResult(
  parts: AgentPart[],
  startIndex: number,
  part: Extract<AgentPart, { type: "tool-call" }>,
) {
  return parts.slice(startIndex + 1).some((candidate) => {
    return candidate.type === "tool-result"
      && candidate.toolCallId === part.toolCallId
      && candidate.toolName === part.toolName;
  });
}

function normalizeAssistantParts(parts: AgentPart[]) {
  return parts.flatMap((part, index) => {
    if (part.type !== "tool-call") {
      return [part];
    }

    const normalizedParts: AgentPart[] = [part];
    const hasOutput =
      part.output !== undefined
      || compactText(part.outputSummary ?? "").length > 0
      || compactText(part.validationError ?? "").length > 0;
    if (hasOutput && !hasExplicitToolResult(parts, index, part)) {
      normalizedParts.push({
        type: "tool-result",
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        status: part.status,
        output: part.output,
        outputSummary: part.outputSummary ?? "",
        validationError: part.validationError,
      });
    }

    return normalizedParts;
  });
}

function serializeAgentPart(
  part: AgentPart,
  mode: SerializationMode,
): string | null {
  const textLimit =
    mode === "compact" ? MAX_COMPACT_MESSAGE_CHARS : MAX_ASSISTANT_MESSAGE_CHARS;
  const toolLimit =
    mode === "compact" ? MAX_COMPACT_TOOL_PREVIEW_CHARS : MAX_TOOL_PREVIEW_CHARS;

  switch (part.type) {
    case "placeholder":
    case "text-delta":
      return null;
    case "text":
      return truncateText(part.text, textLimit) || null;
    case "reasoning":
      return null;
    case "tool-call":
      return serializeToolCall(part, toolLimit);
    case "tool-result":
      return serializeToolResult(part, toolLimit);
    case "subagent":
      return [
        `子任务（${part.name}）：${truncateText(part.summary, textLimit)}`,
        truncateText(part.detail ?? "", textLimit) || null,
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return null;
  }
}

function serializeCompactAgentMessage(message: AgentMessage): SerializedHistoryMessage | null {
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  if (message.role === "user") {
    const content = message.parts
      .map((part) => (part.type === "text" ? truncateText(part.text, MAX_COMPACT_MESSAGE_CHARS) : null))
      .filter((part): part is string => Boolean(part))
      .join("\n\n")
      .trim();

    if (!content) {
      return null;
    }

    return {
      content,
      paths: [],
      role: "user",
      tools: [],
    };
  }

  const normalizedParts = normalizeAssistantParts(message.parts);
  const toolNames = Array.from(
    new Set(
      normalizedParts
        .filter(
          (part): part is Extract<AgentPart, { type: "tool-call" | "tool-result" }> =>
            part.type === "tool-call" || part.type === "tool-result",
        )
        .map((part) => part.toolName),
    ),
  );
  const paths = Array.from(
    new Set(
      normalizedParts.flatMap((part) => {
        if (part.type !== "tool-call" && part.type !== "tool-result") {
          return [];
        }
        return extractPathsFromToolPart(part);
      }),
    ),
  );
  const textParts = normalizedParts
    .flatMap((part) => {
      if (part.type === "text") {
        return [truncateText(part.text, MAX_COMPACT_MESSAGE_CHARS)];
      }
      if (part.type === "subagent") {
        return [truncateText([part.summary, part.detail ?? ""].filter(Boolean).join(" "), MAX_COMPACT_MESSAGE_CHARS)];
      }
      return [];
    })
    .filter(Boolean);

  const content = [
    toolNames.length > 0
      ? `较早工具活动已折叠：${toolNames.join(", ")}。${paths.length > 0 ? `涉及路径：${paths.slice(0, 3).join(", ")}。` : ""}`
      : null,
    ...textParts,
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!content) {
    return null;
  }

  return {
    content,
    paths,
    role: "assistant",
    tools: toolNames,
  };
}

function serializeAgentMessage(
  message: AgentMessage,
  mode: SerializationMode,
): SerializedHistoryMessage | null {
  if (mode === "compact") {
    return serializeCompactAgentMessage(message);
  }

  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  const normalizedParts = message.role === "assistant"
    ? normalizeAssistantParts(message.parts)
    : message.parts;
  const serializedParts = normalizedParts
    .map((part) => serializeAgentPart(part, "detailed"))
    .filter((part): part is string => Boolean(part?.trim()));
  const dedupedParts = serializedParts.filter(
    (part, index) => index === 0 || part !== serializedParts[index - 1],
  );
  const content = truncateText(
    dedupedParts.join("\n\n").trim(),
    message.role === "user" ? MAX_USER_MESSAGE_CHARS : MAX_ASSISTANT_MESSAGE_CHARS,
  );

  if (!content) {
    return null;
  }

  const toolLikeParts = normalizedParts.filter(
    (part): part is Extract<AgentPart, { type: "tool-call" | "tool-result" }> =>
      part.type === "tool-call" || part.type === "tool-result",
  );

  return {
    content,
    paths: Array.from(
      new Set(toolLikeParts.flatMap((part) => extractPathsFromToolPart(part))),
    ),
    role: message.role,
    tools: Array.from(new Set(toolLikeParts.map((part) => part.toolName))),
  };
}

function estimateMessagesChars(messages: SerializedHistoryMessage[], currentUserContent: string) {
  return messages.reduce((total, message) => total + message.content.length, currentUserContent.length);
}

function buildHistorySummary(messages: SerializedHistoryMessage[]) {
  if (messages.length === 0) {
    return "";
  }

  const userGoals = messages
    .filter((message) => message.role === "user")
    .map((message) => truncateText(message.content, MAX_COMPACT_MESSAGE_CHARS))
    .slice(-MAX_HISTORY_SUMMARY_ITEMS);
  const assistantNotes = messages
    .filter((message) => message.role === "assistant")
    .map((message) => truncateText(message.content, MAX_COMPACT_MESSAGE_CHARS))
    .slice(-MAX_HISTORY_SUMMARY_ITEMS);
  const paths = Array.from(
    new Set(messages.flatMap((message) => message.paths)),
  ).slice(-MAX_HISTORY_SUMMARY_PATHS);
  const tools = Array.from(
    new Set(messages.flatMap((message) => message.tools)),
  ).slice(0, MAX_HISTORY_SUMMARY_PATHS);

  return [
    "# 会话连续性摘要",
    "较早历史已压缩，只保留继续执行仍有用的线索。",
    userGoals.length > 0
      ? ["## 先前用户目标", ...userGoals.map((item) => `- ${item}`)].join("\n")
      : null,
    assistantNotes.length > 0
      ? ["## 已知结论/进展", ...assistantNotes.map((item) => `- ${item}`)].join("\n")
      : null,
    paths.length > 0
      ? ["## 相关路径", ...paths.map((item) => `- ${item}`)].join("\n")
      : null,
    tools.length > 0
      ? `## 已用工具\n- ${tools.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

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

function toModelMessage(message: SerializedHistoryMessage): ModelMessage {
  return {
    role: message.role,
    content: message.content,
  };
}

export function buildConversationMessages(
  historyMessages: AgentMessage[],
  currentUserContent: string,
): ModelMessage[] {
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
    ? buildHistorySummary(serializedHistory.slice(0, compactBoundary))
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
