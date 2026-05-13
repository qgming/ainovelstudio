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

  it("疑似工具调用被供应商吞成普通 content 时会自动续跑一次", async () => {
    const messageSnapshots: ModelMessage[][] = [];
    const streamFn = vi.fn((input: { messages: ModelMessage[] }) => {
      messageSnapshots.push([...input.messages]);
      if (messageSnapshots.length === 1) {
        return streamResult([
          { type: "text-delta", id: "text-1", text: "先继续正文落盘，再回写章节与状态文件。" },
        ], "stop", [{ role: "assistant", content: "先继续正文落盘，再回写章节与状态文件。" }]);
      }
      return streamResult([{ type: "text-delta", id: "text-2", text: "已继续执行" }]);
    });

    const parts: AgentPart[] = [];
    for await (const part of agentLoop(
      { messages: [{ role: "user", content: "继续写" }], system: "test" },
      { providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
    )) {
      parts.push(part);
    }

    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(messageSnapshots[1]?.at(-1)?.role).toBe("user");
    expect(messageSnapshots[1]?.at(-1)?.content).toContain("只输出了行动预告");
    expect(messageSnapshots[1]?.at(-1)?.content).toContain("先继续正文落盘，再回写章节与状态文件。");
    expect(parts.map((part) => part.type)).toEqual(["text-delta", "text-delta"]);
  });

  it("只输出补完预告 content 时也会用该 content 触发下一轮", async () => {
    const messageSnapshots: ModelMessage[][] = [];
    const prelude = "先把第001章从当前断点补完：会补上林远离开电视台后的低谷、系统绑定和第一个任务。";
    const streamFn = vi.fn((input: { messages: ModelMessage[] }) => {
      messageSnapshots.push([...input.messages]);
      if (messageSnapshots.length === 1) {
        return streamResult([
          { type: "text-delta", id: "text-1", text: prelude },
        ], "stop", [{ role: "assistant", content: prelude }]);
      }
      return streamResult([{ type: "text-delta", id: "text-2", text: "继续完成" }]);
    });

    for await (const _part of agentLoop(
      { messages: [{ role: "user", content: "继续写" }], system: "test" },
      { providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
    )) {
      // drain stream
    }

    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(messageSnapshots[1]?.at(-1)?.content).toContain(prelude);
  });

  it("只输出 reasoning_content 转来的英文规划内容时也会触发下一轮", async () => {
    const messageSnapshots: ModelMessage[][] = [];
    const reasoning = "**Planning project details** I need to draft additional text, possibly breaking it into smaller chunks.";
    const streamFn = vi.fn((input: { messages: ModelMessage[] }) => {
      messageSnapshots.push([...input.messages]);
      if (messageSnapshots.length === 1) {
        return streamResult([
          { type: "text-delta", id: "text-1", text: reasoning },
        ], "stop", [{ role: "assistant", content: reasoning }]);
      }
      return streamResult([{ type: "text-delta", id: "text-2", text: "continued" }]);
    });

    for await (const _part of agentLoop(
      { messages: [{ role: "user", content: "继续写" }], system: "test" },
      { providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
    )) {
      // drain stream
    }

    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(messageSnapshots[1]?.at(-1)?.content).toContain(reasoning);
  });

  it("默认单步上限是 100", async () => {
    const streamFn = vi.fn(() => streamResult([], "tool-calls", []));

    await expect(async () => {
      for await (const _part of agentLoop(
        { messages: [{ role: "user", content: "循环" }], system: "test" },
        { providerConfig: { apiKey: "k", baseURL: "u", model: "m" }, streamFn: streamFn as never },
      )) {
        // drain stream
      }
    }).rejects.toThrow("Agent 达到最大单步次数 100");

    expect(streamFn).toHaveBeenCalledTimes(100);
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

  it("AI 解码尾错已有文本或思考片段时会按完成收尾", async () => {
    const streamFn = vi.fn(() =>
      streamFailure("error decoding response body", [
        { type: "reasoning-delta", id: "reasoning-0", text: "只返回了思考。" },
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
    expect(parts).toEqual([{ type: "reasoning", summary: "正在思考", detail: "只返回了思考。" }]);
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
