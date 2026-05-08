import { invoke } from "@tauri-apps/api/core";

export type AgentProviderConfigDocument = {
  apiKey: string;
  baseURL: string;
  model: string;
  enableReasoningEffort?: boolean;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  simulateOpencodeBeta?: boolean;
};

export type AgentProviderPreset = {
  id: string;
  name: string;
  apiKey: string;
  model: string;
  provider: string;
  baseURL: string;
  websiteUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentModelConfigPreset = {
  id: string;
  name: string;
  config: AgentProviderConfigDocument;
  createdAt: string;
  updatedAt: string;
};

export type AgentSettingsDocument = {
  config: AgentProviderConfigDocument;
  enabledTools: Record<string, boolean>;
  providerPresets: AgentProviderPreset[];
  modelConfigPresets: AgentModelConfigPreset[];
};

export function readAgentSettings() {
  return invoke<AgentSettingsDocument | null>("read_agent_settings");
}

export function writeAgentSettings(settings: AgentSettingsDocument) {
  return invoke<AgentSettingsDocument>("write_agent_settings", { settings });
}

export function clearAgentSettings() {
  return invoke<void>("clear_agent_settings");
}
