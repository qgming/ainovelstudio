import { invoke } from "@tauri-apps/api/core";
import { invokeWithCancellation, type InvokeCancellationOptions } from "../bookWorkspace/api";

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
  id: string;
  installPath?: string;
  isBuiltin: boolean;
  manifestFilePath?: string;
  memoryFilePath?: string;
  memoryPreview?: string;
  name: string;
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

export function scanInstalledAgents(options?: InvokeCancellationOptions) {
  return invokeWithCancellation<AgentManifest[]>("scan_installed_agents", {}, options);
}

export function initializeBuiltinAgents() {
  return invoke<BuiltinAgentsInitializationResult>("initialize_builtin_agents");
}

export function readAgentDetail(agentId: string) {
  return invoke<AgentManifest>("read_agent_detail", { agentId });
}

export function readAgentFileContent(agentId: string, relativePath: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("read_agent_file_content", { agentId, relativePath }, options);
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

export function importAgentZip(fileName: string, archiveBytes: number[]) {
  return invoke<AgentManifest[]>("import_agent_zip", { fileName, archiveBytes });
}
