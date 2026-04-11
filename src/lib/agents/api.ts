import { invoke } from "@tauri-apps/api/core";

export type AgentSourceKind = "builtin-package" | "installed-package";

export type AgentValidation = {
  errors: string[];
  isValid: boolean;
  warnings: string[];
};

export type AgentManifest = {
  author?: string;
  agentFilePath?: string;
  body: string;
  defaultEnabled?: boolean;
  description: string;
  discoveredAt: number;
  dispatchHint?: string;
  frontmatter?: Record<string, unknown>;
  frontmatterRaw?: string;
  id: string;
  installPath?: string;
  isBuiltin: boolean;
  memoryFilePath?: string;
  memoryPreview?: string;
  name: string;
  rawMarkdown: string;
  role?: string;
  sourceKind: AgentSourceKind;
  suggestedTools: string[];
  tags: string[];
  toolsFilePath?: string;
  toolsPreview?: string;
  validation: AgentValidation;
  version?: string;
};

export type TogglePreferences = {
  enabledById: Record<string, boolean>;
};

export type BuiltinAgentsInitializationResult = {
  initializedAgentIds: string[];
  skippedAgentIds: string[];
};

export function readAgentPreferences() {
  return invoke<TogglePreferences>("read_agent_preferences");
}

export function writeAgentPreferences(preferences: TogglePreferences) {
  return invoke<TogglePreferences>("write_agent_preferences", { preferences });
}

export function clearAgentPreferences() {
  return invoke<void>("clear_agent_preferences");
}

export function pickAgentArchive() {
  return invoke<string | null>("pick_agent_archive");
}

export function scanInstalledAgents() {
  return invoke<AgentManifest[]>("scan_installed_agents");
}

export function initializeBuiltinAgents() {
  return invoke<BuiltinAgentsInitializationResult>("initialize_builtin_agents");
}

export function readAgentDetail(agentId: string) {
  return invoke<AgentManifest>("read_agent_detail", { agentId });
}

export function readAgentFileContent(agentId: string, relativePath: string) {
  return invoke<string>("read_agent_file_content", { agentId, relativePath });
}

export function writeAgentFileContent(agentId: string, relativePath: string, content: string) {
  return invoke<AgentManifest[]>("write_agent_file_content", { agentId, relativePath, content });
}

export function createAgent(name: string, description: string) {
  return invoke<AgentManifest[]>("create_agent", { name, description });
}

export function deleteInstalledAgent(agentId: string) {
  return invoke<AgentManifest[]>("delete_installed_agent", { agentId });
}

export function importAgentZip(zipPath: string) {
  return invoke<AgentManifest[]>("import_agent_zip", { zipPath });
}

