import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateOpenAICompatible, mockGenerateText } = vi.hoisted(() => ({
  mockCreateOpenAICompatible: vi.fn(),
  mockGenerateText: vi.fn(),
}));

vi.mock("ai", () => ({
  defineTool: vi.fn(),
  generateText: mockGenerateText,
  stepCountIs: vi.fn(),
  streamText: vi.fn(),
  tool: vi.fn(),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mockCreateOpenAICompatible,
}));

import { testAgentProviderConnection } from "./modelGateway";

describe("modelGateway", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockCreateOpenAICompatible.mockReset();
    mockCreateOpenAICompatible.mockReturnValue((model: string) => `provider:${model}`);
  });

  it("真实测试通过时返回校验结果", async () => {
    mockGenerateText.mockResolvedValue({ text: "你好，我已收到测试消息。", content: [] });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        maxOutputTokens: 4096,
        model: "gpt-4.1",
        temperature: 0.7,
      }),
    ).resolves.toEqual({
      hasContent: true,
      reply: "你好，我已收到测试消息。",
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 32,
        model: "provider:gpt-4.1",
        temperature: 0,
      }),
    );
  });

  it("模型返回非预期答案时判定失败", async () => {
    mockGenerateText.mockResolvedValue({ text: "   ", reasoningText: undefined, content: [] });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        maxOutputTokens: 4096,
        model: "gpt-4.1",
        temperature: 0.7,
      }),
    ).rejects.toThrow("模型未返回有效内容。");
  });

  it("文本为空但 reasoningText 有内容时也判定成功", async () => {
    mockGenerateText.mockResolvedValue({
      text: "",
      reasoningText: "测试成功，模型已响应。",
      content: [{ type: "reasoning", text: "测试成功，模型已响应。" }],
    });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        maxOutputTokens: 4096,
        model: "gpt-4.1",
        temperature: 0.7,
      }),
    ).resolves.toEqual({
      hasContent: true,
      reply: "测试成功，模型已响应。",
    });
  });
});
