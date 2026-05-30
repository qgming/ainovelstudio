import { invoke } from "@tauri-apps/api/core";

// Provider 请求转发（绕 CORS）。LLM 模型调用已迁至 pi-ai（走 webview 原生 fetch），
// 不再经此模块；这里仅保留工具类请求（联网搜索 / 网页抓取 / 排行榜）所需的 forward 转发。
// 历史的 stream_provider_request / fetch_provider_models / probe_provider_connection 封装
// 已随 pi 重构（CP2）移除——modelCatalog 改前端直接 fetch，providerProbe 改 pi complete()。

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
