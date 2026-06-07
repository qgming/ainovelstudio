import { Channel, invoke } from "@tauri-apps/api/core";

// LLM 模型调用走 Rust reqwest 代理的 fetch 注入层。
//
// 背景（见记忆 llm-cors-rust-proxy-saga）：pi-ai 的 openai-completions provider 内部
// `new OpenAI({ dangerouslyAllowBrowser: true })`，OpenAI SDK 默认用 globalThis.fetch
// 经 webview 原生 fetch 直连模型网关。国产中转网关不回 CORS 头 → POST /chat/completions
// 的 OPTIONS 预检失败 → fetch 抛 TypeError → SDK 包装成 `Connection error.`。
//
// 修复：在应用启动早期把 globalThis.fetch 包一层（installRustProviderFetch）。命中外部
// http(s) 模型端点的请求改调 Rust `stream_provider_request`（reqwest 后端代理，不经浏览器
// 同源策略 → 网关零 CORS 要求），用 Tauri Channel 把 SSE chunk 增量回传，拼成 ReadableStream
// 喂回伪造 Response，让 SDK 的 getReader() 逐字消费。
//
// 防白屏铁律（见 7067b68 教训）：注入的 fetch 必须严格只代理「绝对 http(s) 且非本机」的请求；
// localhost / tauri.localhost / 相对路径 / blob / data 一律走原生 fetch，否则会把 HMR、
// Vite 资源、同源 IPC 也错误代理 → 启动白屏。

// 与 Rust StreamEvent（infrastructure/provider_stream.rs）一一对应：
// serde externally-tagged + tag="type"，camelCase。
type StreamEvent =
  | { type: "open"; status: number; ok: boolean; headers: Record<string, string> }
  | { type: "chunk"; bytes: number[] }
  | { type: "done" }
  | { type: "error"; message: string };

// 与 Rust ForwardProviderRequest（infrastructure/provider_forward.rs）对应的子集。
// provider 模式必填 baseUrl，Rust 据此做 same-origin scope 校验。
type StreamProviderRequest = {
  baseUrl: string;
  method: string;
  headers: Record<string, string>;
  mode: "provider";
  body?: string;
  url: string;
};

// 判断一个 fetch 请求是否该代理到 Rust（即「外部模型端点」）。
//
// 规则：绝对 http(s):// 且 host 不是本机。其余一切走原生：
// - 相对路径（HMR、Vite 静态资源）：new URL 需 base，这里直接判非绝对 → 原生。
// - http://localhost:* / 127.* / [::1] / tauri.localhost（同源 IPC 资源）→ 原生。
// - blob: / data: / file: 等非 http 协议 → 原生。
//
// 内网/非本机私有地址（如 192.168.*）仍会被代理走 Rust——与现有非流式
// forward_provider_request 的 provider 模式语义一致（用户自填网关视为可信端点）。
export function shouldProxyToRust(input: RequestInfo | URL): boolean {
  const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let parsed: URL;
  try {
    // 不传 base：相对路径会抛 → 视为同源资源，走原生。
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  return !isLocalHost(parsed.hostname);
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host.startsWith("127.") ||
    host === "::1" ||
    host === "[::1]" ||
    host === "0.0.0.0"
  );
}

// 从 fetch 的 (input, init) 还原出 Rust 所需的 StreamProviderRequest。
// baseUrl 取请求 URL 的 origin：Rust 的 validate_provider_scope 据此做 same-origin 校验，
// 而 path_is_under_base("/...", "") 因 base path 为空直接放行——无需运行时维护 baseURL 注册表。
async function toStreamRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<StreamProviderRequest> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const headers = collectHeaders(input, init);
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const body = await readBodyAsString(input, init);
  return {
    baseUrl: new URL(url).origin,
    method,
    headers,
    mode: "provider",
    body,
    url,
  };
}

function collectHeaders(input: RequestInfo | URL, init: RequestInit | undefined): Record<string, string> {
  const merged: Record<string, string> = {};
  // Request 自带 headers 在前，init.headers 覆盖在后（与 fetch 语义一致）。
  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      merged[key] = value;
    });
  }
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      merged[key] = value;
    });
  }
  return merged;
}

// OpenAI SDK 把 body 以字符串（JSON）或 ReadableStream/Request 传入。
// LLM 请求体是 JSON 字符串，这里统一读成字符串交给 Rust。
async function readBodyAsString(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<string | undefined> {
  if (init?.body !== undefined && init.body !== null) {
    if (typeof init.body === "string") {
      return init.body;
    }
    // 兜底：用 Request 包装统一读成文本（覆盖 Uint8Array / Blob / ReadableStream）。
    return await new Request("http://x", { method: "POST", body: init.body as BodyInit }).text();
  }
  if (input instanceof Request && input.body) {
    return await input.clone().text();
  }
  return undefined;
}

// 把一次外部模型请求转发给 Rust，返回一个其 body 由 Channel 事件驱动的 Response。
async function streamViaRust(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Response> {
  const request = await toStreamRequest(input, init);
  const requestId = crypto.randomUUID();
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);

  // Open 事件决定 Response 的 status/headers。它在首个 chunk 前到达；在它之前的失败
  // 属于网络层（reject promise → SDK 视为 Connection error），之后的失败属于流读取中断
  // （controller.error → SDK 读流时抛错）。
  let resolveOpen!: (response: Response) => void;
  let rejectOpen!: (error: Error) => void;
  const openPromise = new Promise<Response>((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });
  let opened = false;

  const cancelOnRust = () => {
    void invoke("cancel_provider_stream", { requestId }).catch(() => {});
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const channel = new Channel<StreamEvent>();
      channel.onmessage = (event) => {
        switch (event.type) {
          case "open": {
            opened = true;
            resolveOpen(
              new Response(body, {
                status: event.status,
                statusText: "",
                headers: toResponseHeaders(event.headers),
              }),
            );
            break;
          }
          case "chunk": {
            controller.enqueue(Uint8Array.from(event.bytes));
            break;
          }
          case "done": {
            controller.close();
            break;
          }
          case "error":
            if (opened) {
              controller.error(new Error(event.message));
            } else {
              rejectOpen(new Error(event.message));
            }
            break;
        }
      };

      // 校验/构造阶段失败（缺 baseUrl、非法 URL 等）走 invoke 的 reject，此时尚无 Open，
      // 等价于网络层失败。
      void invoke("stream_provider_request", { request, requestId, channel }).catch(
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (opened) {
            controller.error(new Error(message));
          } else {
            rejectOpen(new Error(message));
          }
        },
      );
    },
    // SDK abort 或读者主动取消时，通知 Rust 停止拉流。
    cancel() {
      cancelOnRust();
    },
  });

  // 外部 AbortSignal（pi-ai 传入的 abortSignal）也要能打断 Rust 流。
  if (signal) {
    if (signal.aborted) {
      cancelOnRust();
    } else {
      signal.addEventListener("abort", cancelOnRust, { once: true });
    }
  }

  return openPromise;
}

// Response 构造对个别 header 名敏感（如 set-cookie），逐个 set 并跳过非法值，避免抛错。
function toResponseHeaders(headers: Record<string, string>): Headers {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    try {
      result.set(key, value);
    } catch {
      // 忽略非法 header（不影响 SDK 读取 SSE body）。
    }
  }
  return result;
}

let installed = false;

// 在应用启动早期（main.tsx，render 之前）调用一次：把 globalThis.fetch 包一层。
// 必须先于任何 pi-ai 调用——OpenAI SDK 在构造 client 时捕获当时的 globalThis.fetch。
export function installRustProviderFetch(): void {
  if (installed) {
    return;
  }
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (shouldProxyToRust(input)) {
      return streamViaRust(input, init);
    }
    return nativeFetch(input, init);
  };
}
