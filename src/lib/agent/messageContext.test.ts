import { describe, expect, it } from "vitest";
import { buildConversationMessages } from "./messageContext";
import type { AgentMessage } from "./types";

function createUserMessage(index: number): AgentMessage {
  return {
    id: `user-${index}`,
    role: "user",
    author: "你",
    parts: [{ type: "text", text: `用户消息 ${index}` }],
  };
}

function createAssistantMessage(index: number): AgentMessage {
  return {
    id: `assistant-${index}`,
    role: "assistant",
    author: "主代理",
    parts: [{ type: "text", text: `助手消息 ${index}` }],
  };
}

describe("buildConversationMessages", () => {
  it("只保留最近20条历史消息", () => {
    const history = Array.from({ length: 24 }, (_, index) =>
      index % 2 === 0 ? createUserMessage(index + 1) : createAssistantMessage(index + 1),
    );

    const messages = buildConversationMessages(history, "当前问题");

    expect(messages).toHaveLength(21);
    expect(messages[0]).toEqual({ role: "user", content: "用户消息 5" });
    expect(messages[19]).toEqual({ role: "assistant", content: "助手消息 24" });
    expect(messages[20]).toEqual({ role: "user", content: "当前问题" });
  });

  it("过滤思考和工具调用，但保留工具结果进入后续上下文", () => {
    const messages = buildConversationMessages(
      [
        {
          id: "assistant-1",
          role: "assistant",
          author: "主代理",
          parts: [
            { type: "reasoning", summary: "正在思考", detail: "分析章节结构。" },
            { type: "tool-call", toolName: "read_file", toolCallId: "call-1", status: "completed", inputSummary: "{\"path\":\"设定.md\"}" },
            { type: "tool-result", toolName: "read_file", toolCallId: "call-1", status: "completed", outputSummary: "已读取设定.md" },
            { type: "text", text: "我已整理完关键设定。" },
          ],
        },
      ],
      "继续",
    );

    expect(messages[0]).toEqual({
      role: "assistant",
      content: "工具结果（read_file）：已读取设定.md\n\n我已整理完关键设定。",
    });
  });
});
