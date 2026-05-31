import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, ProviderResponse, ProviderStreamOptions } from "@earendil-works/pi-ai";

// 只 mock pi-ai 的 complete（网络调用），其余（Type/validateToolCall）用真实实现，
// 以便结构化输出（generateAgentObject）走真实的 TypeBox 校验路径。
const { mockComplete } = vi.hoisted(() => ({
  mockComplete: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-ai")>("@earendil-works/pi-ai");
  return {
    ...actual,
    complete: mockComplete,
  };
});

import { generateAgentObject, generateAgentText, testAgentProviderConnection } from "./index";
import { Type } from "@earendil-works/pi-ai";

// 构造一个最小可用的 AssistantMessage。
function buildAssistantMessage(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "ainovelstudio-provider",
    model: "gpt-4.1",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  };
}

// 模拟 complete：可注入返回的消息，并可通过 onResponse 注入 HTTP 状态码。
function mockCompleteResolve(message: AssistantMessage, httpStatus = 200) {
  mockComplete.mockImplementation(
    async (_model: unknown, _context: unknown, options?: ProviderStreamOptions) => {
      await options?.onResponse?.({ status: httpStatus, headers: {} } as ProviderResponse, _model as never);
      return message;
    },
  );
}

describe("modelGateway", () => {
  beforeEach(() => {
    mockComplete.mockReset();
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
    mockCompleteResolve(
      buildAssistantMessage({
        content: [{ type: "text", text: "你好，我已收到测试消息。" }],
        stopReason: "stop",
      }),
    );

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
  });

  it("非流式生成遇到非法 Base URL 时返回清晰配置错误", async () => {
    await expect(
      generateAgentText({
        prompt: "压缩上下文",
        providerConfig: {
          apiKey: "sk-test",
          baseURL: "not-a-url",
          model: "gpt-4.1",
        },
        system: "test-system",
      }),
    ).rejects.toThrow("Base URL 格式无效，请填写完整地址。");

    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("非流式生成从 AssistantMessage 提取文本", async () => {
    mockCompleteResolve(
      buildAssistantMessage({ content: [{ type: "text", text: "压缩摘要" }] }),
    );

    await expect(
      generateAgentText({
        prompt: "压缩上下文",
        providerConfig: {
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
        },
        system: "test-system",
      }),
    ).resolves.toBe("压缩摘要");

    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("非流式生成失败（stopReason=error）时抛出错误", async () => {
    mockCompleteResolve(
      buildAssistantMessage({ stopReason: "error", errorMessage: "上游网关错误" }),
    );

    await expect(
      generateAgentText({
        prompt: "压缩上下文",
        providerConfig: {
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
        },
        system: "test-system",
      }),
    ).rejects.toThrow("上游网关错误");
  });

  it("结构化生成从强制工具调用重建对象", async () => {
    mockCompleteResolve(
      buildAssistantMessage({
        content: [
          {
            type: "toolCall",
            id: "call_1",
            name: "compaction_summary",
            arguments: { summary: "高密度摘要" },
          },
        ],
        stopReason: "toolUse",
      }),
    );

    const result = await generateAgentObject({
      schema: Type.Object({ summary: Type.String() }),
      toolName: "compaction_summary",
      toolDescription: "压缩摘要工具",
      prompt: "请压缩",
      providerConfig: {
        apiKey: "sk-test",
        baseURL: "https://example.com/v1",
        model: "gpt-4.1",
      },
      system: "test-system",
    });

    expect(result).toEqual({ summary: "高密度摘要" });

    // 应强制调用目标结构化工具。
    const options = mockComplete.mock.calls[0]?.[2] as ProviderStreamOptions | undefined;
    expect(options?.toolChoice).toEqual({
      type: "function",
      function: { name: "compaction_summary" },
    });
  });

  it("结构化生成未返回工具调用时抛错", async () => {
    mockCompleteResolve(
      buildAssistantMessage({ content: [{ type: "text", text: "我不会调用工具" }] }),
    );

    await expect(
      generateAgentObject({
        schema: Type.Object({ summary: Type.String() }),
        toolName: "compaction_summary",
        toolDescription: "压缩摘要工具",
        prompt: "请压缩",
        providerConfig: {
          apiKey: "sk-test",
          baseURL: "https://example.com/v1",
          model: "gpt-4.1",
        },
        system: "test-system",
      }),
    ).rejects.toThrow("模型未按要求返回结构化结果。");
  });

  it("鉴权失败（HTTP 401）时返回 auth_error", async () => {
    mockCompleteResolve(
      buildAssistantMessage({ stopReason: "error", errorMessage: "invalid api key" }),
      401,
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

  it("模型不存在（HTTP 404）时返回 model_error", async () => {
    mockCompleteResolve(
      buildAssistantMessage({ stopReason: "error", errorMessage: "model not found" }),
      404,
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
    mockCompleteResolve(
      buildAssistantMessage({
        content: [{ type: "toolCall", id: "call_1", name: "noop", arguments: {} }],
        stopReason: "toolUse",
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
      status: "response_invalid",
      stage: "response",
      message: "模型未直接返回文本，而是返回了工具调用。",
      diagnostics: {
        contentTypes: ["tool-call"],
        finishReason: "tool-calls",
        rawFinishReason: "toolUse",
      },
    });
  });

  it("返回空内容（stopReason=stop 无文本）时返回 response_invalid", async () => {
    mockCompleteResolve(buildAssistantMessage({ content: [], stopReason: "stop" }));

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
