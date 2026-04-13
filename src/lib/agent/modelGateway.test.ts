import { APICallError } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateOpenAICompatible, mockGenerateText, mockStreamText } = vi.hoisted(() => ({
  mockCreateOpenAICompatible: vi.fn(),
  mockGenerateText: vi.fn(),
  mockStreamText: vi.fn(),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");
  return {
    ...actual,
    defineTool: vi.fn(),
    generateText: mockGenerateText,
    isLoopFinished: vi.fn(),
    streamText: mockStreamText,
    tool: vi.fn(),
  };
});

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

  it("缺少 Base URL 时返回配置错误", async () => {
    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "",
        model: "gpt-4.1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "config_error",
      stage: "config",
      message: "请先填写 Base URL。",
    });
  });

  it("Base URL 非法时返回配置错误", async () => {
    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "not-a-url",
        model: "gpt-4.1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "config_error",
      stage: "config",
      message: "Base URL 格式无效，请填写完整地址。",
    });
  });

  it("真实测试通过时返回结构化成功结果", async () => {
    mockGenerateText.mockResolvedValue({
      content: [{ type: "text" as const, text: "你好，我已收到测试消息。" }],
      finishReason: "stop",
      rawFinishReason: "stop",
    });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: "success",
      stage: "response",
      message: "已连接到模型并收到有效响应。",
      provider: {
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      },
      diagnostics: {
        finishReason: "stop",
        rawFinishReason: "stop",
        responseTextPreview: "你好，我已收到测试消息。",
      },
    });

    expect(mockGenerateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "provider:gpt-4.1",
        messages: [{ role: "user", content: "请直接回复一句简短的话，确认你已收到这条测试消息。" }],
      }),
    );
  });

  it("鉴权失败时返回 auth_error", async () => {
    mockGenerateText.mockRejectedValue(
      new APICallError({
        message: "Unauthorized",
        requestBodyValues: { model: "gpt-4.1" },
        responseHeaders: {},
        responseBody: '{"error":{"message":"invalid api key"}}',
        statusCode: 401,
        url: "https://example.com/v1/chat/completions",
      }),
    );

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "auth_error",
      stage: "request",
      diagnostics: {
        httpStatus: 401,
      },
    });
  });

  it("网络异常时返回 network_error", async () => {
    const error = new Error("fetch failed");
    Object.assign(error, {
      cause: { code: "ECONNREFUSED", message: "connect ECONNREFUSED" },
    });
    mockGenerateText.mockRejectedValue(error);

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "network_error",
      stage: "request",
      message: "网络不可达，请检查 Base URL 是否正确且服务可访问。",
    });
  });

  it("模型不存在时返回 model_error", async () => {
    mockGenerateText.mockRejectedValue(
      new APICallError({
        message: "Model not found",
        requestBodyValues: { model: "unknown-model" },
        responseHeaders: {},
        responseBody: '{"error":{"message":"model not found"}}',
        statusCode: 404,
        url: "https://example.com/v1/chat/completions",
      }),
    );

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "unknown-model",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "model_error",
      stage: "request",
      diagnostics: {
        httpStatus: 404,
      },
    });
  });

  it("模型只返回工具调用时返回 response_invalid", async () => {
    mockGenerateText.mockResolvedValue({
      content: [{ type: "tool-call" as const, toolCallId: "call_1", toolName: "search", input: {} }],
      finishReason: "tool-calls",
      rawFinishReason: "tool_calls",
    });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "response_invalid",
      stage: "response",
      message: "模型未直接返回文本，而是返回了工具调用。",
      diagnostics: {
        contentTypes: ["tool-call"],
        finishReason: "tool-calls",
        rawFinishReason: "tool_calls",
      },
    });
  });

  it("模型响应被过滤时返回 response_invalid", async () => {
    mockGenerateText.mockResolvedValue({
      content: [],
      finishReason: "content-filter",
      rawFinishReason: "content_filter",
    });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "response_invalid",
      stage: "response",
      message: "模型响应被内容过滤拦截，未返回可用文本。",
    });
  });

  it("返回非文本内容时返回 response_invalid", async () => {
    mockGenerateText.mockResolvedValue({
      content: [{ type: "image" as const }],
      finishReason: "stop",
      rawFinishReason: "stop",
    });

    await expect(
      testAgentProviderConnection({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "response_invalid",
      stage: "response",
      message: "模型未返回文本内容，收到的内容类型：image。",
      diagnostics: {
        contentTypes: ["image"],
      },
    });
  });
});
