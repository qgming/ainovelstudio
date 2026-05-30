import { describe, expect, it } from "vitest";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { assistantMessageToAgentUsage, mapStopReasonToFinishReason, sumUsage, toAgentUsage } from "./usage";

function buildUsage(overrides: Partial<Usage> = {}): Usage {
  return {
    input: 100,
    output: 50,
    cacheRead: 20,
    cacheWrite: 10,
    totalTokens: 150,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...overrides,
  };
}

describe("usage", () => {
  it("mapStopReasonToFinishReason: toolUse → tool-calls", () => {
    expect(mapStopReasonToFinishReason("toolUse")).toBe("tool-calls");
    expect(mapStopReasonToFinishReason("stop")).toBe("stop");
    expect(mapStopReasonToFinishReason("length")).toBe("length");
    expect(mapStopReasonToFinishReason("error")).toBe("error");
    expect(mapStopReasonToFinishReason("aborted")).toBe("aborted");
  });

  it("toAgentUsage: 直取字段 + noCacheTokens 推算 + reasoningTokens 置 0", () => {
    const usage = toAgentUsage({
      usage: buildUsage(),
      modelId: "gpt-4.1",
      finishReason: "stop",
    });

    expect(usage).toMatchObject({
      provider: "ainovelstudio-provider",
      modelId: "gpt-4.1",
      finishReason: "stop",
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      cacheReadTokens: 20,
      cacheWriteTokens: 10,
      noCacheTokens: 80, // input(100) - cacheRead(20)
      reasoningTokens: 0,
    });
  });

  it("toAgentUsage: totalTokens 缺省回退 input+output", () => {
    const usage = toAgentUsage({
      usage: buildUsage({ totalTokens: undefined as unknown as number }),
      modelId: "m",
      finishReason: "stop",
    });
    expect(usage.totalTokens).toBe(150);
  });

  it("toAgentUsage: cacheRead > input 时 noCacheTokens 不为负", () => {
    const usage = toAgentUsage({
      usage: buildUsage({ input: 10, cacheRead: 30 }),
      modelId: "m",
      finishReason: "stop",
    });
    expect(usage.noCacheTokens).toBe(0);
  });

  it("assistantMessageToAgentUsage: 从 AssistantMessage 取 usage + stopReason", () => {
    const message: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "openai-completions",
      provider: "ainovelstudio-provider",
      model: "gpt-4.1",
      usage: buildUsage(),
      stopReason: "toolUse",
      timestamp: Date.now(),
    };

    const usage = assistantMessageToAgentUsage(message, "gpt-4.1");
    expect(usage.finishReason).toBe("tool-calls");
    expect(usage.inputTokens).toBe(100);
    expect(usage.provider).toBe("ainovelstudio-provider");
  });

  it("sumUsage: acc 为 null 时直接返回 next", () => {
    const next = toAgentUsage({ usage: buildUsage(), modelId: "m", finishReason: "stop" });
    expect(sumUsage(null, next)).toBe(next);
  });

  it("sumUsage: token 字段逐项相加，finishReason 取末次", () => {
    const first = toAgentUsage({ usage: buildUsage(), modelId: "m", finishReason: "tool-calls" });
    const second = toAgentUsage({ usage: buildUsage(), modelId: "m", finishReason: "stop" });
    const sum = sumUsage(first, second);
    expect(sum).toMatchObject({
      finishReason: "stop", // 取末次
      inputTokens: 200,
      outputTokens: 100,
      totalTokens: 300,
      cacheReadTokens: 40,
      cacheWriteTokens: 20,
      noCacheTokens: 160, // (100-20) * 2
      reasoningTokens: 0,
    });
  });
});
