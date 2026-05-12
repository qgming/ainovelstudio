import { beforeEach, describe, expect, it, vi } from "vitest";

const { listeners, mockInvoke, mockListen } = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  return {
    listeners,
    mockInvoke: vi.fn(),
    mockListen: vi.fn(async (event: string, handler: (event: { payload: unknown }) => void) => {
      listeners.set(event, handler);
      return () => listeners.delete(event);
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
}));

import { streamProviderRequestViaTauri } from "./providerApi";

function emitProviderStream(payload: unknown) {
  listeners.get("provider-stream")?.({ payload });
}

async function readResponseText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

describe("streamProviderRequestViaTauri", () => {
  beforeEach(() => {
    listeners.clear();
    mockInvoke.mockReset();
    mockListen.mockClear();
  });

  it("按 start/chunk/end 事件构造可读响应流", async () => {
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      emitProviderStream({
        type: "start",
        requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      emitProviderStream({ type: "chunk", requestId, chunk: Array.from(new TextEncoder().encode("hello ")) });
      emitProviderStream({ type: "chunk", requestId, chunk: Array.from(new TextEncoder().encode("world")) });
      emitProviderStream({ type: "end", requestId });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: "{}",
      url: "https://example.com/v1/chat/completions",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    await expect(readResponseText(response)).resolves.toBe("hello world");
  });

  it("兼容后端旧版 request_id 事件字段", async () => {
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      emitProviderStream({
        type: "start",
        request_id: requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      emitProviderStream({ type: "chunk", request_id: requestId, chunk: Array.from(new TextEncoder().encode("ok")) });
      emitProviderStream({ type: "end", request_id: requestId });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: "{}",
      url: "https://example.com/v1/chat/completions",
    });

    expect(response.status).toBe(200);
    await expect(readResponseText(response)).resolves.toBe("ok");
  });

  it("将流式请求收到的非流式 chat.completion JSON 转成 SSE", async () => {
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      emitProviderStream({
        type: "start",
        requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "application/json" },
      });
      emitProviderStream({
        type: "chunk",
        requestId,
        chunk: Array.from(new TextEncoder().encode(JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1778480260,
          model: "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                reasoning_content: "后台有响应，但不是 SSE。",
              },
              finish_reason: "stop",
            },
          ],
        }))),
      });
      emitProviderStream({ type: "end", requestId });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: JSON.stringify({ model: "test", messages: [], stream: true }),
      url: "https://example.com/v1/chat/completions",
    });

    const text = await readResponseText(response);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("x-ainovelstudio-stream-fallback")).toBe("chat-completion-json");
    expect(text).toContain("\"object\":\"chat.completion.chunk\"");
    expect(text).toContain("\"content\":\"后台有响应，但不是 SSE。\"");
    expect(text).toContain("data: [DONE]");
  });

  it("转换非流式 chat.completion JSON 时保留工具调用", async () => {
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      emitProviderStream({
        type: "start",
        requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "application/json" },
      });
      emitProviderStream({
        type: "chunk",
        requestId,
        chunk: Array.from(new TextEncoder().encode(JSON.stringify({
          id: "chatcmpl-tools",
          object: "chat.completion",
          created: 1778480148,
          model: "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: " ",
                tool_calls: [
                  {
                    id: "call_read",
                    type: "function",
                    function: {
                      name: "read",
                      arguments: "{\"path\":\"设定/角色/林鹿溪.md\"}",
                    },
                    index: 0,
                  },
                ],
                reasoning_content: "先读取角色设定。",
              },
              finish_reason: "tool_calls",
            },
          ],
        }))),
      });
      emitProviderStream({ type: "end", requestId });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: JSON.stringify({ model: "test", messages: [], stream: true }),
      url: "https://example.com/v1/chat/completions",
    });

    const text = await readResponseText(response);
    expect(text).not.toContain("\"content\":\"先读取角色设定。\"");
    expect(text).toContain("\"tool_calls\"");
    expect(text).toContain("\"id\":\"call_read\"");
    expect(text).toContain("\"name\":\"read\"");
    expect(text).toContain("\"finish_reason\":\"tool_calls\"");
  });

  it("缺失 finish_reason 的非流式工具调用会忽略 tool_calls 并保留 content", async () => {
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      emitProviderStream({
        type: "start",
        requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "application/json" },
      });
      emitProviderStream({
        type: "chunk",
        requestId,
        chunk: Array.from(new TextEncoder().encode(JSON.stringify({
          id: "chatcmpl-object-tools",
          object: "chat.completion",
          created: 1778581721,
          model: "gpt-5.4",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "先直接落盘。",
                tool_calls: [
                  {
                    id: "call_write",
                    type: "function",
                    function: {
                      name: "write",
                      arguments: {
                        content: "# 第001章\n\n正文",
                      },
                    },
                  },
                ],
              },
            },
          ],
        }))),
      });
      emitProviderStream({ type: "end", requestId });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: JSON.stringify({ model: "test", messages: [], stream: true }),
      url: "https://example.com/v1/chat/completions",
    });

    const text = await readResponseText(response);
    expect(text).toContain("\"content\":\"先直接落盘。\"");
    expect(text).not.toContain("\"tool_calls\"");
    expect(text).not.toContain("\"id\":\"call_write\"");
    expect(text).toContain("\"finish_reason\":\"stop\"");
  });

  it("即使响应头标成 SSE，也会识别完整 chat.completion JSON 并转换", async () => {
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      emitProviderStream({
        type: "start",
        requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      emitProviderStream({
        type: "chunk",
        requestId,
        chunk: Array.from(new TextEncoder().encode(JSON.stringify({
          id: "chatcmpl-mislabeled",
          object: "chat.completion",
          created: 1778480442,
          model: "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_read_outline",
                    type: "function",
                    function: {
                      name: "read",
                      arguments: "{\"mode\":\"full\",\"path\":\"大纲/大纲.md\"}",
                    },
                    index: 0,
                  },
                ],
                reasoning_content: "好的，用户要求继续执行。",
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 50677,
            completion_tokens: 0,
            total_tokens: 50677,
          },
        }))),
      });
      emitProviderStream({ type: "end", requestId });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: JSON.stringify({ model: "test", messages: [], stream: true }),
      url: "https://example.com/v1/chat/completions",
    });

    const text = await readResponseText(response);
    expect(response.headers.get("x-ainovelstudio-stream-fallback")).toBe("chat-completion-json");
    expect(text).not.toContain("\"content\":\"好的，用户要求继续执行。\"");
    expect(text).toContain("\"tool_calls\"");
    expect(text).toContain("\"completion_tokens\"");
  });

  it("SSE data 包完整 chat.completion JSON 时也转换为可执行工具流", async () => {
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      const rawCompletion = JSON.stringify({
        id: "resp-tools-in-data",
        object: "chat.completion",
        created: 1778581721,
        model: "gpt-5.4",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "先直接落盘第001章正文。",
              tool_calls: [
                {
                  id: "call_write_chapter",
                  type: "function",
                  function: {
                    name: "write",
                    arguments: "{\"content\":\"# 第001章\\n\\n正文\",\"path\":\"正文/第001章.md\"}",
                  },
                  index: 0,
                },
              ],
              reasoning_content: "准备写入章节。",
            },
          },
        ],
      });

      emitProviderStream({
        type: "start",
        requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      emitProviderStream({
        type: "chunk",
        requestId,
        chunk: Array.from(new TextEncoder().encode(`data: ${rawCompletion}\n\n`)),
      });
      emitProviderStream({
        type: "chunk",
        requestId,
        chunk: Array.from(new TextEncoder().encode("data: [DONE]\n\n")),
      });
      emitProviderStream({ type: "end", requestId });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: JSON.stringify({ model: "test", messages: [], stream: true }),
      url: "https://example.com/v1/chat/completions",
    });

    const text = await readResponseText(response);
    expect(response.headers.get("x-ainovelstudio-stream-fallback")).toBe("chat-completion-json");
    expect(text).toContain("\"object\":\"chat.completion.chunk\"");
    expect(text).toContain("\"content\":\"先直接落盘第001章正文。\"");
    expect(text).not.toContain("\"tool_calls\"");
    expect(text).not.toContain("\"id\":\"call_write_chapter\"");
    expect(text).toContain("\"finish_reason\":\"stop\"");
  });

  it("缺失 finish_reason 且没有 content 时会用 choice.reasoning_content 作为续跑内容", async () => {
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      emitProviderStream({
        type: "start",
        requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "application/json" },
      });
      emitProviderStream({
        type: "chunk",
        requestId,
        chunk: Array.from(new TextEncoder().encode(JSON.stringify({
          id: "chatcmpl-reasoning-invalid-tools",
          object: "chat.completion",
          created: 1778592129,
          model: "gpt-5.4",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_invalid_write",
                    type: "function",
                    function: {
                      name: "write",
                      arguments: "{\"action\":\"append\",\"content\":\"正文\"}",
                    },
                  },
                ],
              },
              reasoning_content: "**Planning project details** I need to draft additional text and continue the chapter.",
            },
          ],
        }))),
      });
      emitProviderStream({ type: "end", requestId });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: JSON.stringify({ model: "test", messages: [], stream: true }),
      url: "https://example.com/v1/chat/completions",
    });

    const text = await readResponseText(response);
    expect(text).toContain("I need to draft additional text");
    expect(text).not.toContain("\"tool_calls\"");
    expect(text).toContain("\"finish_reason\":\"stop\"");
  });

  it("非流式 chat.completion JSON 只有 reasoning_content 时也输出内容", async () => {
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      emitProviderStream({
        type: "start",
        requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "application/json" },
      });
      emitProviderStream({
        type: "chunk",
        requestId,
        chunk: Array.from(new TextEncoder().encode(JSON.stringify({
          id: "chatcmpl-reasoning",
          object: "chat.completion",
          created: 1778480148,
          model: "deepseek-v4-pro",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "",
                reasoning_content: "只有思考内容也应该继续显示。",
              },
              finish_reason: "stop",
            },
          ],
        }))),
      });
      emitProviderStream({ type: "end", requestId });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: JSON.stringify({ model: "test", messages: [], stream: true }),
      url: "https://example.com/v1/chat/completions",
    });

    await expect(readResponseText(response)).resolves.toContain("\"content\":\"只有思考内容也应该继续显示。\"");
  });

  it("非流式请求收到 JSON 时保持原始响应", async () => {
    const rawBody = JSON.stringify({ object: "chat.completion", choices: [] });
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      emitProviderStream({
        type: "start",
        requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "application/json" },
      });
      emitProviderStream({ type: "chunk", requestId, chunk: Array.from(new TextEncoder().encode(rawBody)) });
      emitProviderStream({ type: "end", requestId });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: JSON.stringify({ model: "test", messages: [] }),
      url: "https://example.com/v1/chat/completions",
    });

    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(readResponseText(response)).resolves.toBe(rawBody);
  });

  it("abort 时取消后端流式请求", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const abortController = new AbortController();
    const promise = streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: "{}",
      url: "https://example.com/v1/chat/completions",
    }, abortController.signal);

    abortController.abort();

    await expect(promise).rejects.toThrow("Provider request aborted.");
    expect(mockInvoke).toHaveBeenCalledWith("cancel_provider_stream", expect.objectContaining({
      requestId: expect.stringMatching(/^provider-stream-/),
    }));
  });

  it("普通响应体取消不会误取消后端请求", async () => {
    mockInvoke.mockImplementation(async (_command: string, payload: { request: { requestId: string } }) => {
      const requestId = payload.request.requestId;
      emitProviderStream({
        type: "start",
        requestId,
        ok: true,
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
      emitProviderStream({
        type: "chunk",
        requestId,
        chunk: Array.from(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"A\"}}]}\n\n")),
      });
    });

    const response = await streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: "{}",
      url: "https://example.com/v1/chat/completions",
    });
    await response.body?.cancel();

    expect(mockInvoke).not.toHaveBeenCalledWith("cancel_provider_stream", expect.anything());
  });

  it("abort 早于事件监听完成时不会再启动后端流", async () => {
    let resolveListen!: () => void;
    mockListen.mockImplementationOnce(async (event: string, handler: (event: { payload: unknown }) => void) => {
      await new Promise<void>((resolve) => {
        resolveListen = resolve;
      });
      listeners.set(event, handler);
      return () => listeners.delete(event);
    });
    mockInvoke.mockResolvedValue(undefined);
    const abortController = new AbortController();
    const promise = streamProviderRequestViaTauri({
      baseUrl: "https://example.com/v1",
      method: "POST",
      mode: "provider",
      headers: {},
      body: "{}",
      url: "https://example.com/v1/chat/completions",
    }, abortController.signal);

    abortController.abort();
    resolveListen();

    await expect(promise).rejects.toThrow("Provider request aborted.");
    await Promise.resolve();
    expect(mockInvoke).not.toHaveBeenCalledWith("stream_provider_request", expect.anything());
  });
});
