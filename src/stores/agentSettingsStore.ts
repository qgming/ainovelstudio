import { create } from "zustand";
import { getDefaultEnabledTools } from "../lib/agent/toolDefs";

const STORAGE_KEY = "ainovelstudio-agent-settings";

export type AgentProviderConfig = {
  apiKey: string;
  baseURL: string;
  maxOutputTokens: number;
  model: string;
  temperature: number;
};

type AgentSettingsState = {
  config: AgentProviderConfig;
  /** 每个内置工具的启用状态 */
  enabledTools: Record<string, boolean>;
};

type AgentSettingsActions = {
  reset: () => void;
  toggleTool: (toolId: string) => void;
  updateConfig: (nextConfig: Partial<AgentProviderConfig>) => void;
};

export type AgentSettingsStore = AgentSettingsState & AgentSettingsActions;

function getDefaultConfig(): AgentProviderConfig {
  return {
    apiKey: "",
    baseURL: "https://api.openai.com/v1",
    maxOutputTokens: 4096,
    model: "",
    temperature: 0.7,
  };
}

type PersistedState = {
  config?: Partial<AgentProviderConfig>;
  enabledTools?: Record<string, boolean>;
};

function readState(): AgentSettingsState {
  const defaults: AgentSettingsState = {
    config: getDefaultConfig(),
    enabledTools: getDefaultEnabledTools(),
  };

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const parsed = JSON.parse(raw) as PersistedState;
    return {
      config: { ...defaults.config, ...(parsed.config ?? parsed) },
      enabledTools: { ...defaults.enabledTools, ...(parsed.enabledTools ?? {}) },
    };
  } catch {
    return defaults;
  }
}

function persistState(state: AgentSettingsState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getStoredAgentConfig() {
  return readState().config;
}

export function getStoredEnabledTools() {
  return readState().enabledTools;
}

export const useAgentSettingsStore = create<AgentSettingsStore>((set) => ({
  ...readState(),
  reset: () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }

    set({ config: getDefaultConfig(), enabledTools: getDefaultEnabledTools() });
  },
  toggleTool: (toolId) =>
    set((state) => {
      const enabledTools = { ...state.enabledTools, [toolId]: !state.enabledTools[toolId] };
      const nextState = { config: state.config, enabledTools };
      persistState(nextState);
      return { enabledTools };
    }),
  updateConfig: (nextConfig) =>
    set((state) => {
      const config = { ...state.config, ...nextConfig };
      persistState({ config, enabledTools: state.enabledTools });
      return { config };
    }),
}));
