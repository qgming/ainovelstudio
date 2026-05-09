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
