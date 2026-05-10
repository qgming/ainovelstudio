import type { AgentMessage, AgentPart } from "../types";
import { extractPathsFromToolPart } from "./pathExtract";
import { compactText, truncateText } from "./text";
import {
  MAX_ASSISTANT_MESSAGE_CHARS,
  MAX_COMPACT_MESSAGE_CHARS,
  MAX_TOOL_TARGET_CHARS,
  MAX_TOOL_PREVIEW_CHARS,
  MAX_USER_MESSAGE_CHARS,
  type SerializationMode,
  type SerializedHistoryMessage,
} from "./types";

type ToolLikePart = Extract<AgentPart, { type: "tool-call" | "tool-result" }>;

function stripTrailingSentencePunctuation(value: string) {
  return value.replace(/[。！？.!?；;，,：:]+$/u, "").trim();
}

function formatStatus(status: ToolLikePart["status"], hasError: boolean) {
  if (hasError || status === "failed") return "失败";
  if (status === "completed") return "成功";
  if (status === "awaiting_user") return "等待用户";
  if (status === "running") return "执行中";
  return "未执行";
}

function extractToolTarget(part: ToolLikePart) {
  const paths = extractPathsFromToolPart(part);
  if (paths.length > 0) {
    return paths.slice(0, 3).join(", ");
  }

  if (part.type === "tool-call") {
    const input = compactText(part.inputSummary);
    if (input) return truncateText(input, MAX_TOOL_TARGET_CHARS);
  }

  return "未记录目标";
}

function serializeToolExecution(
  part: ToolLikePart,
  result?: ToolLikePart,
  mode: SerializationMode = "detailed",
) {
  const error = compactText(result?.validationError ?? part.validationError ?? "");
  const status = formatStatus(result?.status ?? part.status, Boolean(error));
  const suffix = error
    ? `，异常：${stripTrailingSentencePunctuation(truncateText(error, MAX_TOOL_TARGET_CHARS))}`
    : "";
  const line = `工具执行：${part.toolName}，对象：${extractToolTarget(part)}，结果：${status}${suffix}。`;
  if (mode === "compact") return line;

  const input = part.type === "tool-call"
    ? truncateText(compactText(part.inputSummary), MAX_TOOL_TARGET_CHARS)
    : "";
  const outputSource =
    result && "outputSummary" in result
      ? result.outputSummary ?? ""
      : "outputSummary" in part
        ? part.outputSummary ?? ""
        : "";
  const output = truncateText(compactText(outputSource), MAX_TOOL_PREVIEW_CHARS);
  return [
    line,
    input ? `输入摘要：${input}` : null,
    output ? `输出摘要：${output}` : null,
  ].filter(Boolean).join("\n");
}

function serializeReasoning(
  part: Extract<AgentPart, { type: "reasoning" }>,
  maxChars: number,
) {
  const summary = compactText(part.summary);
  const detail = compactText(part.detail);
  const content = summary && detail && summary !== detail
    ? `${stripTrailingSentencePunctuation(summary)}；${detail}`
    : summary || detail;
  return content ? `思考摘要：${truncateText(content, maxChars)}` : null;
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

function findMatchingToolResult(parts: AgentPart[], startIndex: number) {
  const part = parts[startIndex];
  if (!part || part.type !== "tool-call") return undefined;
  return parts.slice(startIndex + 1).find(
    (candidate): candidate is ToolLikePart =>
      candidate.type === "tool-result"
      && candidate.toolCallId === part.toolCallId
      && candidate.toolName === part.toolName,
  );
}

function hasPreviousToolCall(parts: AgentPart[], currentIndex: number) {
  const part = parts[currentIndex];
  if (!part || part.type !== "tool-result") return false;
  return parts.slice(0, currentIndex).some((candidate) =>
    candidate.type === "tool-call"
    && candidate.toolCallId === part.toolCallId
    && candidate.toolName === part.toolName
  );
}

function serializeAgentPart(
  part: AgentPart,
  mode: SerializationMode,
  parts: AgentPart[],
  index: number,
): string | null {
  const textLimit =
    mode === "compact" ? MAX_COMPACT_MESSAGE_CHARS : MAX_ASSISTANT_MESSAGE_CHARS;

  switch (part.type) {
    case "placeholder":
    case "text-delta":
      return null;
    case "text":
      return truncateText(part.text, textLimit) || null;
    case "reasoning":
      return serializeReasoning(part, textLimit);
    case "tool-call":
      return serializeToolExecution(part, findMatchingToolResult(parts, index), mode);
    case "tool-result":
      return hasPreviousToolCall(parts, index) ? null : serializeToolExecution(part, undefined, mode);
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
      if (part.type === "reasoning") {
        return [serializeReasoning(part, MAX_COMPACT_MESSAGE_CHARS)];
      }
      if (part.type === "subagent") {
        return [truncateText([part.summary, part.detail ?? ""].filter(Boolean).join(" "), MAX_COMPACT_MESSAGE_CHARS)];
      }
      return [];
    })
    .filter((item): item is string => Boolean(item));
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
    .map((part, index) => serializeAgentPart(part, "detailed", normalizedParts, index))
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
