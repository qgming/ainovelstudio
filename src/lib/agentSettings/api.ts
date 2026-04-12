import { invoke } from "@tauri-apps/api/core";

export type AgentProviderConfigDocument = {
  apiKey: string;
  baseURL: string;
  model: string;
};

export type AgentSettingsDocument = {
  config: AgentProviderConfigDocument;
  enabledTools: Record<string, boolean>;
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
