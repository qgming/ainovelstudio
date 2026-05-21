import { APICallError, type ModelMessage } from "ai";
import { describe, expect, it, vi } from "vitest";
import { agentLoop } from "./loop";
import type { AgentPart } from "../types";

function streamResult(parts: unknown[], finishReason?: string, responseMessages: ModelMessage[] = []) {
  return {
    finishReasonPromise: Promise.resolve(finishReason ?? "stop"),
    fullStream: (async function* () {
      for (const part of parts) {
        yield part;
      }
    })(),
    responseMessagesPromise: Promise.resolve(responseMessages),
    usagePromise: Promise.resolve(null),
  };
}

function streamFailure(message: string, parts: unknown[] = []) {
  return {
    finishReasonPromise: Promise.resolve("stop"),
    fullStream: (async function* () {
      for (const part of parts) {
        yield part;
      }
      throw new Error(message);
    })(),
    responseMessagesPromise: Promise.resolve([]),
    usagePromise: Promise.resolve(null),
  };
}

function streamApiFailure(error: Error) {
  return {
    finishReasonPromise: Promise.resolve("stop"),
    fullStream: (async function* () {
      throw error;
    })(),
    responseMessagesPromise: Promise.resolve([]),
    usagePromise: Promise.resolve(null),
  };
}

describe("agentLoop", () => {
  it("工具结果后会继续下一次模型调用", async () => {
    const streamFn = vi
      .fn()
      .mockReturnValueOnce(
        streamResult(
          [
            { type: "tool-call", toolName: "read", toolCallId: "call-1", input: { path: "a.md" } },
            { type: "tool-result", toolName: "read", toolCallId: "call-1", output: "正文" },
          ],
          "tool-calls",
          [{ role: "assistant", content: "工具已调用" }],
        ),
      )
      .mockReturnValueOnce(
        streamResult([{ type: "text-delta", id: "text-1", text: "完成" }]),
      );

    const parts: AgentPart[] = [];
    for await (const part of agentLoop(
      { messages: [{ role: "user", content: "读文件" }], system: "test" },
      { providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
    )) {
      parts.push(part);
    }

    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(parts.map((part) => part.type)).toEqual(["tool-call", "tool-result", "text-delta"]);
  });

  it("steering 消息会插入工具结果之后", async () => {
    const streamFn = vi
      .fn()
      .mockReturnValueOnce(streamResult([], "tool-calls", [{ role: "assistant", content: "step-1" }]))
      .mockReturnValueOnce(streamResult([{ type: "text-delta", id: "text-1", text: "已纠偏" }]));
    let delivered = false;

    for await (const _part of agentLoop(
      { messages: [{ role: "user", content: "继续" }], system: "test" },
      {
        providerConfig: { apiKey: "k", baseURL: "u", model: "m" },
        streamFn: streamFn as never,
        takeSteeringMessages: () => {
          if (delivered) return [];
          delivered = true;
          return ["把节奏拉快"];
        },
      },
    )) {
      // drain stream
    }

    expect(streamFn.mock.calls[1]?.[0]?.messages).toContainEqual({
      role: "user",
      content: "把节奏拉快",
    });
  });

  it("未启用协议修复时纯文本行动预告不会被自动续跑", async () => {
    const messageSnapshots: ModelMessage[][] = [];
    const streamFn = vi.fn((input: { messages: ModelMessage[] }) => {
      messageSnapshots.push([...input.messages]);
      return streamResult([
        { type: "text-delta", id: "text-1", text: "先继续正文落盘，再回写章节与状态文件。" },
      ], "stop", [{ role: "assistant", content: "先继续正文落盘，再回写章节与状态文件。" }]);
    });

    const parts: AgentPart[] = [];
    for await (const part of agentLoop(
      { messages: [{ role: "user", content: "继续写" }], system: "test" },
      { providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
    )) {
      parts.push(part);
    }

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(messageSnapshots).toHaveLength(1);
    expect(parts.map((part) => part.type)).toEqual(["text-delta"]);
  });

  it("写入任务只输出行动预告时会后台追加协议修复并续跑", async () => {
    const messageSnapshots: ModelMessage[][] = [];
    const streamFn = vi.fn((input: { messages: ModelMessage[] }) => {
      messageSnapshots.push([...input.messages]);
      if (messageSnapshots.length === 1) {
        return streamResult([
          { type: "text-delta", id: "text-1", text: "好，第10章以赵黑风率人到达山门外为结尾。现在开始写第11章。" },
        ], "stop", [{ role: "assistant", content: "好，第10章以赵黑风率人到达山门外为结尾。现在开始写第11章。" }]);
      }
      if (messageSnapshots.length === 2) {
        return streamResult([
          { type: "tool-call", toolName: "workspace_write", toolCallId: "call-write-11", input: { path: "正文/第011章.md", content: "正文" } },
          { type: "tool-result", toolName: "workspace_write", toolCallId: "call-write-11", output: "已追加写入 正文/第011章.md" },
        ], "tool-calls", [{ role: "assistant", content: "工具已调用" }]);
      }
      return streamResult([{ type: "text-delta", id: "text-2", text: "已写入第11章。" }]);
    });

    const parts: AgentPart[] = [];
    for await (const part of agentLoop(
      { messages: [{ role: "user", content: "继续写第11章" }], system: "test", tools: { workspace_write: {} } as never },
      {
        providerConfig: { apiKey: "k", baseURL: "u", model: "m" },
        streamFn: streamFn as never,
        writeProtocolRepair: {
          enabledToolIds: ["workspace_write"],
          userPrompt: "继续写第11章",
        },
      },
    )) {
      parts.push(part);
    }

    expect(streamFn).toHaveBeenCalledTimes(3);
    expect(messageSnapshots[1]?.at(-1)).toMatchObject({ role: "user" });
    expect(String(messageSnapshots[1]?.at(-1)?.content)).toContain("协议修复");
    expect(String(messageSnapshots[1]?.at(-1)?.content)).toContain("必须至少产生一次相关工具调用");
    expect(parts.map((part) => part.type)).toEqual(["text-delta", "tool-call", "tool-result", "text-delta"]);
  });

  it("上一章已写入后的继续写下一章预告也会触发后台协议修复", async () => {
    const messageSnapshots: ModelMessage[][] = [];
    const streamFn = vi.fn((input: { messages: ModelMessage[] }) => {
      messageSnapshots.push([...input.messages]);
      if (messageSnapshots.length === 1) {
        return streamResult([
          { type: "tool-call", toolName: "workspace_write", toolCallId: "call-write-11", input: { path: "正文/第011章.md", content: "正文" } },
          { type: "tool-result", toolName: "workspace_write", toolCallId: "call-write-11", output: "已追加写入 正文/第011章.md" },
        ], "tool-calls", [{ role: "assistant", content: "工具已调用" }]);
      }
      if (messageSnapshots.length === 2) {
        return streamResult([
          { type: "text-delta", id: "text-1", text: "第011章写完，2357中文字。继续写第012章。" },
        ], "stop", [{ role: "assistant", content: "第011章写完，2357中文字。继续写第012章。" }]);
      }
      if (messageSnapshots.length === 3) {
        return streamResult([
          { type: "tool-call", toolName: "workspace_write", toolCallId: "call-write-12", input: { path: "正文/第012章.md", content: "正文" } },
          { type: "tool-result", toolName: "workspace_write", toolCallId: "call-write-12", output: "已追加写入 正文/第012章.md" },
        ], "tool-calls", [{ role: "assistant", content: "工具已调用" }]);
      }
      return streamResult([{ type: "text-delta", id: "text-2", text: "已开始写入第012章。" }]);
    });

    const parts: AgentPart[] = [];
    for await (const part of agentLoop(
      { messages: [{ role: "user", content: "继续连续写章节" }], system: "test", tools: { workspace_write: {} } as never },
      {
        providerConfig: { apiKey: "k", baseURL: "u", model: "m" },
        streamFn: streamFn as never,
        writeProtocolRepair: {
          enabledToolIds: ["workspace_write"],
          userPrompt: "继续连续写章节",
        },
      },
    )) {
      parts.push(part);
    }

    expect(streamFn).toHaveBeenCalledTimes(4);
    expect(String(messageSnapshots[2]?.at(-1)?.content)).toContain("协议修复");
    expect(parts.map((part) => part.type)).toEqual([
      "tool-call",
      "tool-result",
      "text-delta",
      "tool-call",
      "tool-result",
      "text-delta",
    ]);
  });

  it("诊断写入失败原因时不会触发后台写入协议修复", async () => {
    const streamFn = vi.fn(() => streamResult([
      { type: "text-delta", id: "text-1", text: "原因是上一轮没有产生结构化工具调用。" },
    ], "stop", [{ role: "assistant", content: "原因是上一轮没有产生结构化工具调用。" }]));

    const parts: AgentPart[] = [];
    for await (const part of agentLoop(
      { messages: [{ role: "user", content: "是什么原因导致没有调用 write 工具？" }], system: "test", tools: { workspace_write: {} } as never },
      {
        providerConfig: { apiKey: "k", baseURL: "u", model: "m" },
        streamFn: streamFn as never,
        writeProtocolRepair: {
          enabledToolIds: ["workspace_write"],
          userPrompt: "是什么原因导致没有调用 write 工具？",
        },
      },
    )) {
      parts.push(part);
    }

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(parts.map((part) => part.type)).toEqual(["text-delta"]);
  });

  it("要求先给提示词确认时不会触发后台写入协议修复", async () => {
    const streamFn = vi.fn(() => streamResult([
      { type: "text-delta", id: "text-1", text: "可以，先给你一个后台续跑提示词模板。" },
    ], "stop", [{ role: "assistant", content: "可以，先给你一个后台续跑提示词模板。" }]));

    const parts: AgentPart[] = [];
    for await (const part of agentLoop(
      { messages: [{ role: "user", content: "可以后台触发一次AI，先给我这个提示词我来确定" }], system: "test", tools: { workspace_write: {} } as never },
      {
        providerConfig: { apiKey: "k", baseURL: "u", model: "m" },
        streamFn: streamFn as never,
        writeProtocolRepair: {
          enabledToolIds: ["workspace_write"],
          userPrompt: "可以后台触发一次AI，先给我这个提示词我来确定",
        },
      },
    )) {
      parts.push(part);
    }

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(parts.map((part) => part.type)).toEqual(["text-delta"]);
  });

  it("默认单步上限是 1000", async () => {
    const streamFn = vi.fn(() => streamResult([], "tool-calls", []));

    await expect(async () => {
      for await (const _part of agentLoop(
        { messages: [{ role: "user", content: "循环" }], system: "test" },
        { providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
      )) {
        // drain stream
      }
    }).rejects.toThrow("Agent 达到最大单步次数 1000");

    expect(streamFn).toHaveBeenCalledTimes(1000);
  });

  it("null 单步上限允许调用方使用无限上限", async () => {
    const streamFn = vi
      .fn()
      .mockReturnValueOnce(streamResult([], "tool-calls", []))
      .mockReturnValueOnce(streamResult([], "tool-calls", []))
      .mockReturnValueOnce(streamResult([{ type: "text-delta", id: "text-1", text: "完成" }]));

    for await (const _part of agentLoop(
      { messages: [{ role: "user", content: "循环到完成" }], system: "test" },
      { maxSteps: null, providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
    )) {
      // drain stream
    }

    expect(streamFn).toHaveBeenCalledTimes(3);
  });

  it("用户续跑消息会重置单步计数", async () => {
    const streamFn = vi
      .fn()
      .mockReturnValueOnce(streamResult([], "tool-calls", []))
      .mockReturnValueOnce(streamResult([], "tool-calls", []))
      .mockReturnValueOnce(streamResult([], "tool-calls", []))
      .mockReturnValueOnce(streamResult([{ type: "text-delta", id: "text-1", text: "完成" }]));
    let delivered = false;

    for await (const _part of agentLoop(
      { messages: [{ role: "user", content: "循环" }], system: "test" },
      {
        maxSteps: 2,
        providerConfig: { apiKey: "k", baseURL: "u", model: "m" },
        streamFn: streamFn as never,
        takeSteeringMessages: () => {
          if (delivered || streamFn.mock.calls.length < 2) return [];
          delivered = true;
          return ["继续"];
        },
      },
    )) {
      // drain stream
    }

    expect(streamFn).toHaveBeenCalledTimes(4);
  });

  it("AI 请求连续失败未满 5 次时会自动续跑", async () => {
    const messageSnapshots: ModelMessage[][] = [];
    const responses = [
      streamFailure("error decoding response body"),
      streamFailure("No output generated. Check the stream for errors."),
      streamFailure("fetch failed"),
      streamFailure("stream closed"),
      streamResult([{ type: "text-delta", id: "text-1", text: "续跑完成" }]),
    ];
    const streamFn = vi.fn((input: { messages: ModelMessage[] }) => {
      messageSnapshots.push([...input.messages]);
      return responses.shift();
    });

    const parts: AgentPart[] = [];
    for await (const part of agentLoop(
      { messages: [{ role: "user", content: "继续写" }], system: "test" },
      { providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
    )) {
      parts.push(part);
    }

    expect(streamFn).toHaveBeenCalledTimes(5);
    expect(messageSnapshots[1]?.at(-1)?.content).toContain("连续第 1 次短暂失败");
    expect(messageSnapshots[4]?.at(-1)?.content).toContain("连续第 4 次短暂失败");
    expect(parts.at(-1)).toEqual({ type: "text-delta", delta: "续跑完成" });
  });

  it("供应商明确返回模型不可用时不会自动续跑", async () => {
    const error = new APICallError({
      message: "upstream error",
      requestBodyValues: { model: "deepseek-v4-pro" },
      responseBody: JSON.stringify({
        error: {
          code: "model_not_found",
          message: "No available channel for model deepseek-v4-pro under group default",
          type: "new_api_error",
        },
      }),
      statusCode: 503,
      url: "https://api.example.com/v1/chat/completions",
    });
    const streamFn = vi.fn(() => streamApiFailure(error));

    await expect(async () => {
      for await (const _part of agentLoop(
        { messages: [{ role: "user", content: "继续写" }], system: "test" },
        { providerConfig: { apiKey: "k", baseURL: "https://api.example.com/v1", model: "deepseek-v4-pro" }, streamFn: streamFn as never },
      )) {
        // drain stream
      }
    }).rejects.toThrow("upstream error");

    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it("AI 解码尾错只有思考片段时会自动续跑", async () => {
    const streamFn = vi
      .fn()
      .mockReturnValueOnce(streamFailure("error decoding response body", [
        { type: "reasoning-delta", id: "reasoning-0", text: "只返回了思考。" },
      ]))
      .mockReturnValueOnce(streamResult([{ type: "text-delta", id: "text-1", text: "续跑完成" }]));

    const parts: AgentPart[] = [];
    for await (const part of agentLoop(
      { messages: [{ role: "user", content: "继续写" }], system: "test" },
      { providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
    )) {
      parts.push(part);
    }

    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(parts).toEqual([
      { type: "reasoning", summary: "", detail: "只返回了思考。" },
      { type: "text-delta", delta: "续跑完成" },
    ]);
  });

  it("AI 解码尾错已有正文片段时会按完成收尾", async () => {
    const streamFn = vi.fn(() =>
      streamFailure("error decoding response body", [
        { type: "reasoning-delta", id: "reasoning-0", text: "准备写正文。" },
        { type: "text-delta", id: "text-1", text: "已有正文。" },
      ]),
    );

    const parts: AgentPart[] = [];
    for await (const part of agentLoop(
      { messages: [{ role: "user", content: "继续写" }], system: "test" },
      { providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
    )) {
      parts.push(part);
    }

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(parts).toEqual([
      { type: "reasoning", summary: "", detail: "准备写正文。" },
      { type: "text-delta", delta: "已有正文。" },
    ]);
  });

  it("AI 请求连续失败 5 次时只展示最近一次失败报告", async () => {
    const streamFn = vi.fn(() => streamFailure("error decoding response body"));

    await expect(async () => {
      for await (const _part of agentLoop(
        { messages: [{ role: "user", content: "继续写" }], system: "test" },
        {
          providerConfig: { apiKey: "k", baseURL: "https://example.test", model: "test-model" },
          streamFn: streamFn as never,
        },
      )) {
        // drain stream
      }
    }).rejects.toThrow(/连续 5 次 AI 请求失败[\s\S]*模型：test-model[\s\S]*最近一次 turnId：[\s\S]*已生成片段数：0/);

    expect(streamFn).toHaveBeenCalledTimes(5);
  });
});
