import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { buildProviderRequestHeaders } from "./providerRequest";

type ProviderModelsPayload = {
  data?: Array<{ id?: string | null }>;
};

function normalizeBaseUrl(baseURL: string) {
  return baseURL.trim().replace(/\/+$/, "");
}

function parseModelIds(payload: unknown) {
  const data = typeof payload === "object" && payload !== null
    ? (payload as ProviderModelsPayload).data
    : undefined;

  if (!Array.isArray(data)) {
    return [];
  }

  return Array.from(
    new Set(
      data
        .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function getErrorMessage(status: number) {
  if (status === 401 || status === 403) {
    return "鉴权失败，请检查 API Key 是否有效。";
  }

  if (status === 404) {
    return "当前服务未提供 /models 接口。";
  }

  return "获取模型列表失败，请稍后重试。";
}

export async function fetchProviderModels(providerConfig: AgentProviderConfig) {
  const baseURL = normalizeBaseUrl(providerConfig.baseURL);
  const apiKey = providerConfig.apiKey.trim();

  if (!baseURL) {
    throw new Error("请先填写 Base URL。");
  }

  if (!apiKey) {
    throw new Error("请先填写 API Key。");
  }

  // 前端直接用 webview 原生 fetch 请求 /models（Tauri webview 允许跨域）。
  // 鉴权头（Bearer + Accept + 可选 opencode beta）由前端拼。
  const response = await fetch(`${baseURL}/models`, {
    headers: buildProviderRequestHeaders(providerConfig),
  });

  if (!response.ok) {
    throw new Error(getErrorMessage(response.status));
  }

  // 响应体由用户配置的网关返回，可能非 JSON（如 HTML/网关错误页），需容错避免抛原始 SyntaxError。
  let payload: unknown;
  try {
    payload = JSON.parse(await response.text());
  } catch {
    throw new Error("解析模型列表响应失败，请确认 Base URL 指向兼容 OpenAI 的服务。");
  }
  const models = parseModelIds(payload);

  if (models.length === 0) {
    throw new Error("未从 /models 返回可用模型。");
  }

  return models;
}
