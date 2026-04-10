import type { ModelMessage } from "ai";
import type { AgentMessage, AgentPart } from "./types";

function serializeAgentPart(part: AgentPart): string | null {
  switch (part.type) {
    case "placeholder":
    case "text-delta":
      return null;
    case "text":
      return part.text.trim() || null;
    case "reasoning":
      return ["思考摘要：" + part.summary, part.detail.trim()].filter(Boolean).join("\n");
    case "tool-call":
      return part.outputSummary
        ? `工具 ${part.toolName} 结果：${part.outputSummary}`
        : `工具 ${part.toolName} 输入：${part.inputSummary}`;
    case "tool-result":
      return `工具 ${part.toolName} 结果：${part.outputSummary}`;
    case "subagent":
      return [
        `子任务摘要（${part.name}）：${part.summary}`,
        part.detail?.trim() || null,
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

  const content = message.parts
    .map((part) => serializeAgentPart(part))
    .filter((part): part is string => Boolean(part?.trim()))
    .join("\n\n")
    .trim();

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
