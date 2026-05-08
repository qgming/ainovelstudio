import { invoke } from "@tauri-apps/api/core";

export type DefaultAgentConfigDocument = {
  initializedFromBuiltin: boolean;
  markdown: string;
  path: string;
};

export function initializeDefaultAgentConfig() {
  return invoke<DefaultAgentConfigDocument | null | undefined>("initialize_default_agent_config");
}

export function readDefaultAgentConfig() {
  return invoke<DefaultAgentConfigDocument | null | undefined>("read_default_agent_config");
}

export function writeDefaultAgentConfig(content: string) {
  return invoke<DefaultAgentConfigDocument>("write_default_agent_config", { content });
}

