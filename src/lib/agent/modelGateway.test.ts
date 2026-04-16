import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateOpenAICompatible, mockGenerateText, mockProbeProviderConnectionViaTauri, mockStreamText } = vi.hoisted(() => ({
  mockCreateOpenAICompatible: vi.fn(),
  mockGenerateText: vi.fn(),
  mockProbeProviderConnectionViaTauri: vi.fn(),
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

vi.mock("./providerApi", () => ({
  probeProviderConnectionViaTauri: mockProbeProviderConnectionViaTauri,
}));

import { generateAgentText, testAgentProviderConnection } from "./modelGateway";

describe("modelGateway", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
    mockProbeProviderConnectionViaTauri.mockReset();
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
    mockProbeProviderConnectionViaTauri.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            native_finish_reason: "stop",
            message: {
              content: "你好，我已收到测试消息。",
            },
          },
        ],
      }),
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

    expect(mockProbeProviderConnectionViaTauri).toHaveBeenCalledWith({
      apiKey: "sk-test",
      baseURL: "https://example.com/v1",
      model: "gpt-4.1",
      simulateOpencodeBeta: false,
    });
  });

  it("启用模拟 OpenCode 时注入额外请求头", async () => {
    mockGenerateText.mockResolvedValue({
      text: "你好",
    });

    await generateAgentText({
      prompt: "你好",
      providerConfig: {
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
        simulateOpencodeBeta: true,
      },
      system: "test-system",
    });

    expect(mockCreateOpenAICompatible).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        headers: expect.objectContaining({
          "x-opencode-client": "cli",
          "x-opencode-project": "global",
          "x-opencode-request": expect.stringMatching(/^msg_/),
          "x-opencode-session": expect.stringMatching(/^ses_/),
        }),
      }),
    );
  });

  it("鉴权失败时返回 auth_error", async () => {
    mockProbeProviderConnectionViaTauri.mockResolvedValue({
      ok: false,
      status: 401,
      body: '{"error":{"message":"invalid api key"}}',
    });

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
    mockProbeProviderConnectionViaTauri.mockRejectedValue(error);

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
    mockProbeProviderConnectionViaTauri.mockResolvedValue({
      ok: false,
      status: 404,
      body: '{"error":{"message":"model not found"}}',
    });

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
    mockProbeProviderConnectionViaTauri.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            finish_reason: "tool-calls",
            native_finish_reason: "tool_calls",
            message: {
              tool_calls: [{ id: "call_1" }],
            },
          },
        ],
      }),
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
    mockProbeProviderConnectionViaTauri.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            finish_reason: "content-filter",
            native_finish_reason: "content_filter",
            message: {},
          },
        ],
      }),
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
    mockProbeProviderConnectionViaTauri.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            native_finish_reason: "stop",
            message: {},
          },
        ],
      }),
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
      message: "模型未返回有效文本响应。finishReason=stop，raw=stop。",
    });
  });
});
