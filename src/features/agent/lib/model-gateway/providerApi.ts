import { invoke } from "@tauri-apps/api/core";

// Provider 请求转发（绕 CORS）。本模块仅保留工具类请求（联网搜索 / 网页抓取 / 排行榜）
// 所需的一次性 forward 转发。
// LLM 模型调用走 pi-ai，其 webview fetch 已由 pi/rustProviderFetch.ts 注入改道至 Rust
// 流式命令 stream_provider_request（SSE 逐字流），不经此模块。

export type ForwardProviderRequest = {
  baseUrl?: string;
  method: string;
  headers: Record<string, string>;
  mode?: "provider" | "publicWeb";
  body?: string;
  url: string;
};

export type ForwardProviderResponse = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: string;
};

export function forwardProviderRequestViaTauri(request: ForwardProviderRequest) {
  return invoke<ForwardProviderResponse>("forward_provider_request", { request });
}
