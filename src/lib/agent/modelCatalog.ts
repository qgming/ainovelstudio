import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import { fetchProviderModelsViaTauri } from "./providerApi";

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

  const response = await fetchProviderModelsViaTauri(providerConfig);

  if (!response.ok) {
    throw new Error(getErrorMessage(response.status));
  }

  const payload = JSON.parse(response.body);
  const models = parseModelIds(payload);

  if (models.length === 0) {
    throw new Error("未从 /models 返回可用模型。");
  }

  return models;
}
