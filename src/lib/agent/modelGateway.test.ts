import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateOpenAICompatible, mockGenerateText, mockStreamText } = vi.hoisted(() => ({
  mockCreateOpenAICompatible: vi.fn(),
  mockGenerateText: vi.fn(),
  mockStreamText: vi.fn(),
}));

vi.mock("ai", () => ({
  defineTool: vi.fn(),
  generateText: mockGenerateText,
  isLoopFinished: vi.fn(),
  streamText: mockStreamText,
  tool: vi.fn(),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mockCreateOpenAICompatible,
}));

import { testAgentProviderConnection } from "./modelGateway";

describe("modelGateway", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockStreamText.mockReset();
    mockCreateOpenAICompatible.mockReset();
    mockCreateOpenAICompatible.mockReturnValue((model: string) => `provider:${model}`);
  });

  it("真实测试通过时返回校验结果", async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta" as const, text: "你好，我已收到测试消息。" };
      })(),
    });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      }),
    ).resolves.toEqual({
      hasContent: true,
      reply: "你好，我已收到测试消息。",
    });

    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "provider:gpt-4.1",
        messages: [{ role: "user", content: "请回复一句简短的话，确认你已收到这条测试消息。" }],
      }),
    );
  });

  it("模型即使没有文本内容，只要链路不报错也判定成功", async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {})(),
    });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      }),
    ).resolves.toEqual({
      hasContent: true,
      reply: "连接成功",
    });
  });

  it("流式调用抛错时判定失败", async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        throw new Error("HTTP 403");
      })(),
    });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      }),
    ).rejects.toThrow("HTTP 403");
  });

  it("模型返回任意非空文本时即判定成功", async () => {
    mockStreamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta" as const, text: "ok" };
      })(),
    });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      }),
    ).resolves.toEqual({
      hasContent: true,
      reply: "ok",
    });
  });
});
