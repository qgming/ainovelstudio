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

  it("assistant 历史会保留 toolCallId 语义，并优先使用输出摘要而不是完整原始结果", () => {
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
        "输出摘要：主角：林燃；目标：逃离北城",
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

  it("较早的工具历史会折叠为占位提示，只保留最近消息的详细内容", () => {
    const messages = buildConversationMessages(
      [
        createUserMessage(1),
        {
          id: "assistant-1",
          role: "assistant",
          author: "主代理",
          parts: [
            {
              type: "tool-call",
              toolName: "read_file",
              toolCallId: "call-older",
              status: "completed",
              inputSummary: "{\"path\":\"设定/人物.md\"}",
              outputSummary: "主角：林燃；目标：逃离北城",
            },
            {
              type: "text",
              text: "我已经读取过人物设定。",
            },
          ],
        },
        createUserMessage(2),
        createAssistantMessage(2),
        createUserMessage(3),
        createAssistantMessage(3),
        createUserMessage(4),
        createAssistantMessage(4),
      ],
      "继续分析",
    );

    expect(
      messages.some(
        (message) =>
          message.role === "assistant"
          && message.content.includes("较早工具活动已折叠：read_file"),
      ),
    ).toBe(true);
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "继续分析" });
  });

  it("历史超预算时会生成连续性摘要", () => {
    const longText = "很长的上下文 ".repeat(800);
    const history = Array.from({ length: 12 }, (_, index) =>
      index % 2 === 0
        ? {
            id: `user-${index}`,
            role: "user" as const,
            author: "你",
            parts: [{ type: "text" as const, text: `用户目标 ${index} ${longText}` }],
          }
        : {
            id: `assistant-${index}`,
            role: "assistant" as const,
            author: "主代理",
            parts: [{ type: "text" as const, text: `处理进展 ${index} ${longText}` }],
          },
    );

    const messages = buildConversationMessages(history, "继续推进");

    expect(messages[0]).toEqual(
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("# 会话连续性摘要"),
      }),
    );
    expect(messages[messages.length - 1]).toEqual({ role: "user", content: "继续推进" });
    expect(messages.length).toBeLessThan(history.length + 1);
  });

  it("只在构建新上下文时压缩，不会改写原始 AI 输出或工具结果", () => {
    const originalOutput = "完整工具结果 ".repeat(500);
    const history: AgentMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        author: "主代理",
        parts: [
          {
            type: "tool-call",
            toolName: "read_file",
            toolCallId: "call-keep-full",
            status: "completed",
            inputSummary: "{\"path\":\"设定/人物.md\"}",
            outputSummary: originalOutput,
            output: originalOutput,
          },
          {
            type: "text",
            text: "我已经读取并整理完成。",
          },
        ],
      },
    ];

    const messages = buildConversationMessages(history, "继续");

    expect(messages[0]?.content.length).toBeLessThan(originalOutput.length);
    const part = history[0]?.parts[0];
    expect(part).toMatchObject({
      output: originalOutput,
      outputSummary: originalOutput,
      type: "tool-call",
    });
  });
});
