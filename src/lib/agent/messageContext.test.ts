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

  it("assistant 历史会保留 toolCallId 语义，并从合并后的 tool-call 合成结构化结果块", () => {
    const messages = buildConversationMessages(
      [
        {
          id: "assistant-1",
          role: "assistant",
          author: "主代理",
          parts: [
            {
              type: "tool-call",
              toolName: "read_file",
              toolCallId: "call-1",
              status: "completed",
              inputSummary: "{\"path\":\"设定.md\"}",
              output: { protagonist: "林燃", goal: "逃离北城" },
              outputSummary: "主角：林燃；目标：逃离北城",
            },
            { type: "text", text: "我已整理完关键设定。" },
          ],
        },
      ],
      "继续",
    );

    expect(messages[0]).toEqual({
      role: "assistant",
      content: [
        "工具调用 [call-1] read_file",
        "输入摘要：{\"path\":\"设定.md\"}",
        "",
        "工具结果 [call-1] read_file",
        "输出摘要：{\"protagonist\":\"林燃\",\"goal\":\"逃离北城\"}",
        "",
        "我已整理完关键设定。",
      ].join("\n"),
    });
  });

  it("异常 tool-result 不会丢失，并会保留校验错误", () => {
    const messages = buildConversationMessages(
      [
        {
          id: "assistant-1",
          role: "assistant",
          author: "主代理",
          parts: [
            {
              type: "tool-result",
              toolName: "read_file",
              toolCallId: "",
              status: "failed",
              outputSummary: "读取失败",
              validationError: "toolCallId 缺失。",
            },
          ],
        },
      ],
      "继续",
    );

    expect(messages[0]).toEqual({
      role: "assistant",
      content: "工具结果 [] read_file\n输出摘要：读取失败\n校验异常：toolCallId 缺失。",
    });
  });
});
