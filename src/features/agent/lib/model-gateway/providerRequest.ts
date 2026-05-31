import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";

// 仅保留请求头构造工具。LLM 调用走 pi-ai，其 webview fetch 经 pi/rustProviderFetch.ts
// 注入改道至 Rust 代理（绕国产网关 CORS）；旧的 AI SDK provider（createProvider）已随 CP4.6 移除。
// buildProviderHeaders / buildProviderRequestHeaders 仍被 modelCatalog 与 pi/models 使用。

const OPENCODE_CLIENT = "cli";
const OPENCODE_PROJECT = "global";

const opencodeSessionId = createOpencodeId("ses_");

function createOpencodeId(prefix: "msg_" | "ses_") {
  const rawId = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

  return `${prefix}${rawId}`;
}

export function buildProviderHeaders(providerConfig: AgentProviderConfig) {
  if (!providerConfig.simulateOpencodeBeta) {
    return undefined;
  }

  return {
    "x-opencode-client": OPENCODE_CLIENT,
    "x-opencode-project": OPENCODE_PROJECT,
    "x-opencode-request": createOpencodeId("msg_"),
    "x-opencode-session": opencodeSessionId,
  };
}

export function buildProviderRequestHeaders(providerConfig: AgentProviderConfig) {
  const headers = new Headers(buildProviderHeaders(providerConfig));
  headers.set("Authorization", `Bearer ${providerConfig.apiKey.trim()}`);
  headers.set("Accept", "application/json");
  return Object.fromEntries(headers.entries());
}
