import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateOpenAICompatible, mockStreamProviderRequestViaTauri } = vi.hoisted(() => ({
  mockCreateOpenAICompatible: vi.fn(),
  mockStreamProviderRequestViaTauri: vi.fn(),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: mockCreateOpenAICompatible,
}));

vi.mock("./providerApi", () => ({
  streamProviderRequestViaTauri: mockStreamProviderRequestViaTauri,
}));

import { createProvider } from "./providerRequest";

describe("createProvider", () => {
  beforeEach(() => {
    mockCreateOpenAICompatible.mockReset();
    mockStreamProviderRequestViaTauri.mockReset();
    mockCreateOpenAICompatible.mockReturnValue((model: string) => `provider:${model}`);
    mockStreamProviderRequestViaTauri.mockResolvedValue(new Response(""));
  });

  it("出站请求里有 reasoning part 时兜底回传 reasoning_content", async () => {
    createProvider({
      apiKey: "sk-test",
      baseURL: "https://example.com/v1",
      model: "mimo-v2.5-pro",
    });

    const fetch = mockCreateOpenAICompatible.mock.calls[0]?.[0]?.fetch as typeof globalThis.fetch;
    await fetch("https://example.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "mimo-v2.5-pro",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "reasoning", text: "先判断上下文。" },
              { type: "text", text: "可以继续。" },
            ],
          },
          { role: "user", content: "继续" },
        ],
      }),
    });

    const forwardedBody = JSON.parse(mockStreamProviderRequestViaTauri.mock.calls[0]?.[0]?.body);
    expect(forwardedBody.messages[0]).toEqual({
      role: "assistant",
      content: [
        { type: "reasoning", text: "先判断上下文。" },
        { type: "text", text: "可以继续。" },
      ],
      reasoning_content: "先判断上下文。",
    });
  });

  it("带工具调用的 assistant 缺失 reasoning_content 时强制补齐", async () => {
    createProvider({
      apiKey: "sk-test",
      baseURL: "https://example.com/v1",
      model: "mimo-v2.5-pro",
    });

    const fetch = mockCreateOpenAICompatible.mock.calls[0]?.[0]?.fetch as typeof globalThis.fetch;
    await fetch("https://example.com/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "mimo-v2.5-pro",
        messages: [
          {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_read",
                type: "function",
                function: {
                  name: "workspace_read",
                  arguments: "{\"path\":\"设定.md\"}",
                },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_read", content: "角色设定" },
          { role: "user", content: "继续" },
        ],
      }),
    });

    const forwardedBody = JSON.parse(mockStreamProviderRequestViaTauri.mock.calls[0]?.[0]?.body);
    expect(forwardedBody.messages[0].reasoning_content).toContain("workspace_read");
  });
});
