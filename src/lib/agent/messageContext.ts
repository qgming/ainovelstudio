import type { ModelMessage } from "ai";
import type { AgentMessage, AgentPart } from "./types";

const MAX_HISTORY_TURNS = 20;

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
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
      return null;
    case "tool-result":
      return compactText(part.outputSummary) ? `工具结果（${part.toolName}）：${compactText(part.outputSummary)}` : null;
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

  const serializedParts = message.parts
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
