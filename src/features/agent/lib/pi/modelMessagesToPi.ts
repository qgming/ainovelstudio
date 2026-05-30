import type { ModelMessage } from "../message-context/modelMessage";
import type { Message, TextContent, ToolCall } from "@earendil-works/pi-ai";

// 把 AI SDK 的 ModelMessage[] 转成 pi-ai 的 Message[]，作为 pi Agent 的 initialState.messages。
// 历史消息已被 message-context 序列化/摘要过，内容多为文本；这里只需做结构对齐：
// - user：content 统一成字符串。
// - assistant：text/reasoning 合成文本块；tool-call 转 pi ToolCall。
// - tool（AI SDK 的工具结果消息）：每个 tool-result 转成 pi 的 toolResult 消息。
// 注意：本项目不迁移旧会话数据，这里仅用于同一会话内继续对话时重建上下文。

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function piText(text: string): TextContent {
  return { type: "text", text };
}

function nowTs(index: number): number {
  // 历史消息无真实时间戳，用单调递增的占位（pi 仅用于排序/展示，不影响语义）。
  return index;
}

function convertUser(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "type" in part && part.type === "text" ? asText((part as { text?: string }).text) : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function convertAssistant(content: ModelMessage["content"], index: number): Message {
  const textParts: TextContent[] = [];
  const toolCalls: ToolCall[] = [];

  if (typeof content === "string") {
    textParts.push(piText(content));
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== "object" || !("type" in part)) continue;
      const type = (part as { type: string }).type;
      if (type === "text" || type === "reasoning") {
        const text = asText((part as { text?: string }).text);
        if (text.trim()) textParts.push(piText(text));
      } else if (type === "tool-call") {
        const tc = part as { toolCallId?: string; toolName?: string; input?: unknown };
        toolCalls.push({
          type: "toolCall",
          id: tc.toolCallId ?? "",
          name: tc.toolName ?? "",
          arguments: (tc.input as Record<string, unknown>) ?? {},
        });
      }
    }
  }

  return {
    role: "assistant",
    content: [...textParts, ...toolCalls],
    api: "openai-completions",
    provider: "ainovelstudio-provider",
    model: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: toolCalls.length > 0 ? "toolUse" : "stop",
    timestamp: nowTs(index),
  };
}

function convertToolResults(content: ModelMessage["content"], index: number): Message[] {
  if (!Array.isArray(content)) return [];
  const results: Message[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object" || !("type" in part) || (part as { type: string }).type !== "tool-result") continue;
    const tr = part as { toolCallId?: string; toolName?: string; output?: { type?: string; value?: unknown } };
    const output = tr.output;
    const isError = output?.type === "error-text" || output?.type === "error-json";
    const text =
      typeof output?.value === "string" ? output.value : output?.value === undefined ? "" : JSON.stringify(output.value);
    results.push({
      role: "toolResult",
      toolCallId: tr.toolCallId ?? "",
      toolName: tr.toolName ?? "",
      content: [piText(text)],
      isError,
      timestamp: nowTs(index),
    });
  }
  return results;
}

export function modelMessagesToPi(messages: ModelMessage[]): Message[] {
  const result: Message[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user") {
      const text = convertUser(message.content);
      if (text.trim()) result.push({ role: "user", content: text, timestamp: nowTs(index) });
      return;
    }
    if (message.role === "assistant") {
      result.push(convertAssistant(message.content, index));
      return;
    }
    if (message.role === "tool") {
      result.push(...convertToolResults(message.content, index));
      return;
    }
    // system 等其它角色不进 messages（systemPrompt 单独传）。
  });
  return result;
}
