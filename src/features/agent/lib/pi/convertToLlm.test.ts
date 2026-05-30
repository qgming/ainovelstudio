import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { convertToLlm } from "./convertToLlm";

describe("convertToLlm", () => {
  it("透传 user/assistant/toolResult 三类标准消息", () => {
    const messages = [
      { role: "user", content: "你好", timestamp: 1 },
      {
        role: "assistant",
        content: [{ type: "text", text: "hi" }],
        api: "openai-completions",
        provider: "p",
        model: "m",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: 2,
      },
      { role: "toolResult", toolCallId: "c1", toolName: "write", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 3 },
    ] as AgentMessage[];

    expect(convertToLlm(messages)).toHaveLength(3);
  });

  it("过滤自定义 role 消息（UI-only/ask_user 留痕）", () => {
    const messages = [
      { role: "user", content: "你好", timestamp: 1 },
      { role: "askUser", request: {}, toolCallId: "c1" } as unknown,
    ] as AgentMessage[];

    const result = convertToLlm(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ role: "user" });
  });

  it("空数组安全", () => {
    expect(convertToLlm([])).toEqual([]);
  });
});
