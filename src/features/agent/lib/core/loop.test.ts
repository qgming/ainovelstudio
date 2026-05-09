import type { ModelMessage } from "ai";
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
});
