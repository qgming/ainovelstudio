import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";

export function normalizeProviderConfig(providerConfig: AgentProviderConfig): AgentProviderConfig {
  return {
    apiKey: providerConfig.apiKey.trim(),
    baseURL: providerConfig.baseURL.trim(),
    model: providerConfig.model.trim(),
    simulateOpencodeBeta: Boolean(providerConfig.simulateOpencodeBeta),
  };
}

export function getProviderConfigError(providerConfig: AgentProviderConfig): string | null {
  if (!providerConfig.baseURL) {
    return "请先填写 Base URL。";
  }

  try {
    const parsedUrl = new URL(providerConfig.baseURL);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return "Base URL 必须使用 http 或 https 协议。";
    }
  } catch {
    return "Base URL 格式无效，请填写完整地址。";
  }

  if (!providerConfig.apiKey) {
    return "请先填写 API Key。";
  }

  if (!providerConfig.model) {
    return "请先填写 Model。";
  }

  return null;
}

export function assertProviderConfigReady(providerConfig: AgentProviderConfig) {
  const message = getProviderConfigError(providerConfig);
  if (message) {
    throw new Error(message);
  }
}

export function buildProviderOptions(providerConfig: AgentProviderConfig) {
  void providerConfig;
  return undefined;
}
