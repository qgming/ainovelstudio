import { invoke } from "@tauri-apps/api/core";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";

export type ProviderHttpResponse = {
  ok: boolean;
  status: number;
  body: string;
};

export type ForwardProviderRequest = {
  method: string;
  headers: Record<string, string>;
  body?: string;
  url: string;
};

export type ForwardProviderResponse = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: string;
};

export function fetchProviderModelsViaTauri(config: AgentProviderConfig) {
  return invoke<ProviderHttpResponse>("fetch_provider_models", { config });
}

export function probeProviderConnectionViaTauri(config: AgentProviderConfig) {
  return invoke<ProviderHttpResponse>("probe_provider_connection", { config });
}

export function forwardProviderRequestViaTauri(request: ForwardProviderRequest) {
  return invoke<ForwardProviderResponse>("forward_provider_request", { request });
}
