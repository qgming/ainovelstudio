import { create } from "zustand";
import { getDefaultEnabledTools } from "../lib/agent/toolDefs";
import { DEFAULT_MAIN_AGENT_MARKDOWN } from "../lib/agent/promptContext";

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
  defaultAgentMarkdown: string;
  /** 每个内置工具的启用状态 */
  enabledTools: Record<string, boolean>;
};

type AgentSettingsActions = {
  reset: () => void;
  resetConfig: () => void;
  resetDefaultAgentMarkdown: () => void;
  toggleTool: (toolId: string) => void;
  updateConfig: (nextConfig: Partial<AgentProviderConfig>) => void;
  updateDefaultAgentMarkdown: (content: string) => void;
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
  defaultAgentMarkdown?: string;
  enabledTools?: Record<string, boolean>;
};

function getDefaultState(): AgentSettingsState {
  return {
    config: getDefaultConfig(),
    defaultAgentMarkdown: DEFAULT_MAIN_AGENT_MARKDOWN,
    enabledTools: getDefaultEnabledTools(),
  };
}

function readState(): AgentSettingsState {
  const defaults = getDefaultState();

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
      defaultAgentMarkdown:
        typeof parsed.defaultAgentMarkdown === "string"
          ? parsed.defaultAgentMarkdown
          : defaults.defaultAgentMarkdown,
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

export function getStoredDefaultAgentMarkdown() {
  return readState().defaultAgentMarkdown;
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

    set(getDefaultState());
  },
  resetConfig: () =>
    set((state) => {
      const nextState = {
        config: getDefaultConfig(),
        defaultAgentMarkdown: state.defaultAgentMarkdown,
        enabledTools: state.enabledTools,
      };
      persistState(nextState);
      return { config: nextState.config };
    }),
  resetDefaultAgentMarkdown: () =>
    set((state) => {
      const nextState = {
        config: state.config,
        defaultAgentMarkdown: DEFAULT_MAIN_AGENT_MARKDOWN,
        enabledTools: state.enabledTools,
      };
      persistState(nextState);
      return { defaultAgentMarkdown: DEFAULT_MAIN_AGENT_MARKDOWN };
    }),
  toggleTool: (toolId) =>
    set((state) => {
      const enabledTools = { ...state.enabledTools, [toolId]: !state.enabledTools[toolId] };
      const nextState = { config: state.config, defaultAgentMarkdown: state.defaultAgentMarkdown, enabledTools };
      persistState(nextState);
      return { enabledTools };
    }),
  updateConfig: (nextConfig) =>
    set((state) => {
      const config = { ...state.config, ...nextConfig };
      persistState({ config, defaultAgentMarkdown: state.defaultAgentMarkdown, enabledTools: state.enabledTools });
      return { config };
    }),
  updateDefaultAgentMarkdown: (content) =>
    set((state) => {
      const defaultAgentMarkdown = content;
      persistState({ config: state.config, defaultAgentMarkdown, enabledTools: state.enabledTools });
      return { defaultAgentMarkdown };
    }),
}));
