import type { AgentMessage, AgentPart } from "../types";
import { extractPathsFromToolPart } from "./pathExtract";
import { compactText, truncateText } from "./text";
import {
  MAX_ASSISTANT_MESSAGE_CHARS,
  MAX_COMPACT_MESSAGE_CHARS,
  MAX_COMPACT_TOOL_PREVIEW_CHARS,
  MAX_TOOL_PREVIEW_CHARS,
  MAX_USER_MESSAGE_CHARS,
  type SerializationMode,
  type SerializedHistoryMessage,
} from "./types";

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
    case "ask-user":
      return null;
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

export function serializeAgentMessage(
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
