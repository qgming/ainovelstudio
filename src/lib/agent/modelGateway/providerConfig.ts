import {
  normalizeReasoningEffort,
  type AgentProviderConfig,
} from "../../../stores/agentSettingsStore";

export function normalizeProviderConfig(providerConfig: AgentProviderConfig): AgentProviderConfig {
  return {
    apiKey: providerConfig.apiKey.trim(),
    baseURL: providerConfig.baseURL.trim(),
    model: providerConfig.model.trim(),
    enableReasoningEffort: Boolean(providerConfig.enableReasoningEffort),
    reasoningEffort: normalizeReasoningEffort(providerConfig.reasoningEffort),
    simulateOpencodeBeta: Boolean(providerConfig.simulateOpencodeBeta),
  };
}

export function buildProviderOptions(providerConfig: AgentProviderConfig) {
  if (!providerConfig.enableReasoningEffort) {
    return undefined;
  }

  return {
    ainovelstudioProvider: {
      reasoningEffort: normalizeReasoningEffort(providerConfig.reasoningEffort),
    },
  };
}
