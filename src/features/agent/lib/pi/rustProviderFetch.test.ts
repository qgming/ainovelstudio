import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// mock Tauri core：Channel 暴露 onmessage 供测试手动投递事件；invoke 记录调用并可控返回。
const invokeMock = vi.fn();
// 收集所有被创建的 Channel 实例，测试里据此向 onmessage 投递 Rust 事件。
const channels: Array<{ onmessage?: (event: unknown) => void }> = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {
    onmessage?: (event: unknown) => void;
    constructor() {
      channels.push(this);
    }
  },
}));

import { shouldProxyToRust } from "./rustProviderFetch";

// 取最近一次创建的 Channel（streamViaRust 每次调用新建一个）。
function latestChannel() {
  return channels[channels.length - 1]!;
}

describe("shouldProxyToRust", () => {
  it("绝对 http(s) 且非本机 → 代理走 Rust", () => {
    expect(shouldProxyToRust("https://gateway.example.com/v1/chat/completions")).toBe(true);
    expect(shouldProxyToRust("http://api.deepseek.com/chat/completions")).toBe(true);
    expect(shouldProxyToRust("http://192.168.1.10:8080/v1/chat/completions")).toBe(true);
  });

  it("localhost / 127.* / tauri.localhost → 原生", () => {
    expect(shouldProxyToRust("http://localhost:1420/src/main.tsx")).toBe(false);
    expect(shouldProxyToRust("http://127.0.0.1:1420/@vite/client")).toBe(false);
    expect(shouldProxyToRust("https://tauri.localhost/assets/index.js")).toBe(false);
    expect(shouldProxyToRust("http://[::1]:3000/x")).toBe(false);
  });

  it("相对路径 / 非 http 协议 → 原生", () => {
    expect(shouldProxyToRust("/api/models")).toBe(false);
    expect(shouldProxyToRust("./chunk.js")).toBe(false);
    expect(shouldProxyToRust("blob:https://x/abc")).toBe(false);
    expect(shouldProxyToRust("data:text/plain,hi")).toBe(false);
  });

  it("接受 URL 与 Request 形态", () => {
    expect(shouldProxyToRust(new URL("https://gateway.example.com/v1"))).toBe(true);
    expect(shouldProxyToRust(new Request("http://localhost:1420/x"))).toBe(false);
  });
});

describe("installRustProviderFetch", () => {
  const nativeFetch = vi.fn();

  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    nativeFetch.mockReset();
    nativeFetch.mockResolvedValue(new Response("native"));
    channels.length = 0;
    // 每个用例重置 globalThis.fetch 并重新安装。installed 标志是模块级单例，
    // 但因 fetch 被替换后无法还原 installed=false，这里靠 vi.resetModules 重新加载。
    globalThis.fetch = nativeFetch as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("本机请求透传给原生 fetch，不调用 Rust", async () => {
    const { installRustProviderFetch: install } = await freshModule();
    globalThis.fetch = nativeFetch as unknown as typeof globalThis.fetch;
    install();

    await globalThis.fetch("http://localhost:1420/src/main.tsx");
    expect(nativeFetch).toHaveBeenCalledOnce();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("外部模型请求 → invoke stream_provider_request，open 后 chunk 拼成 Response body", async () => {
    const { installRustProviderFetch: install } = await freshModule();
    globalThis.fetch = nativeFetch as unknown as typeof globalThis.fetch;
    install();

    const responsePromise = globalThis.fetch("https://gateway.example.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer sk-x", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "x", stream: true }),
    });

    // 等 invoke 被调用（ReadableStream.start 同步执行，但 invoke 在微任务里）。
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());

    // 校验 invoke 参数：命令名、provider 模式、baseUrl=origin、body 透传。
    const [command, payload] = invokeMock.mock.calls.find(
      (c) => c[0] === "stream_provider_request",
    )!;
    expect(command).toBe("stream_provider_request");
    const request = (payload as { request: Record<string, unknown> }).request;
    expect(request.mode).toBe("provider");
    expect(request.baseUrl).toBe("https://gateway.example.com");
    expect(request.url).toBe("https://gateway.example.com/v1/chat/completions");
    expect(request.method).toBe("POST");
    expect(request.body).toBe(JSON.stringify({ model: "x", stream: true }));
    expect((request.headers as Record<string, string>)["authorization"]).toBe("Bearer sk-x");

    const channel = latestChannel();
    // 投递 Rust 事件序列：open → chunk → chunk → done。
    channel.onmessage!({ type: "open", status: 200, ok: true, headers: { "content-type": "text/event-stream" } });
    const response = await responsePromise;
    expect(response.status).toBe(200);

    channel.onmessage!({ type: "chunk", bytes: Array.from(new TextEncoder().encode("data: a\n\n")) });
    channel.onmessage!({ type: "chunk", bytes: Array.from(new TextEncoder().encode("data: b\n\n")) });
    channel.onmessage!({ type: "done" });

    const text = await response.text();
    expect(text).toBe("data: a\n\ndata: b\n\n");
  });

  it("open 前 error → reject（网络层失败）", async () => {
    const { installRustProviderFetch: install } = await freshModule();
    globalThis.fetch = nativeFetch as unknown as typeof globalThis.fetch;
    install();

    const responsePromise = globalThis.fetch("https://gateway.example.com/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });
    await vi.waitFor(() => expect(latestChannel().onmessage).toBeDefined());

    latestChannel().onmessage!({ type: "error", message: "连接被拒绝" });
    await expect(responsePromise).rejects.toThrow("连接被拒绝");
  });

  it("open 后 error → Response body 读取时抛错（HTTP 流中断）", async () => {
    const { installRustProviderFetch: install } = await freshModule();
    globalThis.fetch = nativeFetch as unknown as typeof globalThis.fetch;
    install();

    const responsePromise = globalThis.fetch("https://gateway.example.com/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });
    await vi.waitFor(() => expect(latestChannel().onmessage).toBeDefined());

    const channel = latestChannel();
    channel.onmessage!({ type: "open", status: 200, ok: true, headers: {} });
    const response = await responsePromise;
    channel.onmessage!({ type: "error", message: "流中途断开" });

    await expect(response.text()).rejects.toThrow("流中途断开");
  });

  it("非 2xx 也照常 open(ok=false)，错误 body 当 chunk 流回", async () => {
    const { installRustProviderFetch: install } = await freshModule();
    globalThis.fetch = nativeFetch as unknown as typeof globalThis.fetch;
    install();

    const responsePromise = globalThis.fetch("https://gateway.example.com/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });
    await vi.waitFor(() => expect(latestChannel().onmessage).toBeDefined());

    const channel = latestChannel();
    channel.onmessage!({ type: "open", status: 401, ok: false, headers: {} });
    const response = await responsePromise;
    expect(response.status).toBe(401);
    expect(response.ok).toBe(false);

    channel.onmessage!({ type: "chunk", bytes: Array.from(new TextEncoder().encode('{"error":"unauthorized"}')) });
    channel.onmessage!({ type: "done" });
    expect(await response.text()).toBe('{"error":"unauthorized"}');
  });

  it("AbortSignal 触发时调用 cancel_provider_stream", async () => {
    const { installRustProviderFetch: install } = await freshModule();
    globalThis.fetch = nativeFetch as unknown as typeof globalThis.fetch;
    install();

    const controller = new AbortController();
    void globalThis.fetch("https://gateway.example.com/v1/chat/completions", {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());

    controller.abort();
    await vi.waitFor(() =>
      expect(invokeMock.mock.calls.some((c) => c[0] === "cancel_provider_stream")).toBe(true),
    );
  });
});

// 重新加载被测模块，重置其模块级 installed 单例，使每个用例都能干净 install。
async function freshModule() {
  vi.resetModules();
  return await import("./rustProviderFetch");
}
