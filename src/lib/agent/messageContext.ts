import type { ModelMessage } from "ai";
import type { AgentMessage, AgentPart } from "./types";

const MAX_HISTORY_TURNS = 20;

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function formatToolOutput(part: Extract<AgentPart, { type: "tool-result" }>) {
  if (typeof part.output === "string") {
    return compactText(part.output) || compactText(part.outputSummary);
  }
  if (part.output !== undefined) {
    try {
      return compactText(JSON.stringify(part.output)) || compactText(part.outputSummary);
    } catch {
      return compactText(part.outputSummary);
    }
  }
  return compactText(part.outputSummary);
}

function serializeToolCall(part: Extract<AgentPart, { type: "tool-call" }>) {
  return [
    `工具调用 [${part.toolCallId}] ${part.toolName}`,
    compactText(part.inputSummary) ? `输入摘要：${compactText(part.inputSummary)}` : null,
    compactText(part.validationError ?? "") ? `校验异常：${compactText(part.validationError ?? "")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function serializeToolResult(part: Extract<AgentPart, { type: "tool-result" }>) {
  const output = formatToolOutput(part);
  return [
    `工具结果 [${part.toolCallId}] ${part.toolName}`,
    output ? `输出摘要：${output}` : null,
    compactText(part.validationError ?? "") ? `校验异常：${compactText(part.validationError ?? "")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function hasExplicitToolResult(parts: AgentPart[], startIndex: number, part: Extract<AgentPart, { type: "tool-call" }>) {
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
    const hasOutput = part.output !== undefined || compactText(part.outputSummary ?? "").length > 0 || compactText(part.validationError ?? "").length > 0;
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

function serializeAgentPart(part: AgentPart): string | null {
  switch (part.type) {
    case "placeholder":
    case "text-delta":
      return null;
    case "text":
      return compactText(part.text) || null;
    case "reasoning":
      return null;
    case "tool-call":
      return serializeToolCall(part);
    case "tool-result":
      return serializeToolResult(part);
    case "subagent":
      return [
        `子任务（${part.name}）：${compactText(part.summary)}`,
        compactText(part.detail ?? "") || null,
      ]
        .filter(Boolean)
        .join("\n");
    default:
      return null;
  }
}

function serializeAgentMessage(message: AgentMessage): ModelMessage | null {
  if (message.role !== "user" && message.role !== "assistant") {
    return null;
  }

  const normalizedParts = message.role === "assistant" ? normalizeAssistantParts(message.parts) : message.parts;
  const serializedParts = normalizedParts
    .map((part) => serializeAgentPart(part))
    .filter((part): part is string => Boolean(part?.trim()));
  const dedupedParts = serializedParts.filter(
    (part, index) => index === 0 || part !== serializedParts[index - 1],
  );
  const content = dedupedParts.join("\n\n").trim();

  if (!content) {
    return null;
  }

  return {
    role: message.role,
    content,
  };
}

export function buildConversationMessages(historyMessages: AgentMessage[], currentUserContent: string): ModelMessage[] {
  const history = historyMessages
    .slice(-MAX_HISTORY_TURNS)
    .map((message) => serializeAgentMessage(message))
    .filter((message): message is ModelMessage => Boolean(message));

  return [
    ...history,
    {
      role: "user",
      content: currentUserContent,
    },
  ];
}
