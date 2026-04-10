import { create } from "zustand";
import {
  initializeDefaultAgentConfig,
  resetDefaultAgentConfig,
  writeDefaultAgentConfig,
} from "../lib/agentConfig/api";
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
  configFilePath: string | null;
  defaultAgentMarkdown: string;
  enabledTools: Record<string, boolean>;
  errorMessage: string | null;
  status: "idle" | "loading" | "ready" | "error";
};

type AgentSettingsActions = {
  initialize: () => Promise<void>;
  reset: () => void;
  resetConfig: () => void;
  resetDefaultAgentMarkdown: () => Promise<void>;
  toggleTool: (toolId: string) => void;
  updateConfig: (nextConfig: Partial<AgentProviderConfig>) => void;
  updateDefaultAgentMarkdown: (content: string) => Promise<void>;
};

export type AgentSettingsStore = AgentSettingsState & AgentSettingsActions;

type PersistedState = {
  config?: Partial<AgentProviderConfig>;
  enabledTools?: Record<string, boolean>;
};

function getDefaultConfig(): AgentProviderConfig {
  return {
    apiKey: "",
    baseURL: "https://api.openai.com/v1",
    maxOutputTokens: 4096,
    model: "",
    temperature: 0.7,
  };
}

function getDefaultState(): AgentSettingsState {
  return {
    config: getDefaultConfig(),
    configFilePath: null,
    defaultAgentMarkdown: "",
    enabledTools: getDefaultEnabledTools(),
    errorMessage: null,
    status: "idle",
  };
}

function readPersistedState(): PersistedState {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as PersistedState;
  } catch {
    return {};
  }
}

function readState(): AgentSettingsState {
  const defaults = getDefaultState();
  const parsed = readPersistedState();
  return {
    ...defaults,
    config: { ...defaults.config, ...(parsed.config ?? parsed) },
    enabledTools: { ...defaults.enabledTools, ...(parsed.enabledTools ?? {}) },
  };
}

function persistState(state: Pick<AgentSettingsState, "config" | "enabledTools">) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatSettingsError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }
  return fallbackMessage;
}

function normalizeMainAgentMarkdown(markdown: unknown) {
  return typeof markdown === "string" ? markdown : "";
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

export const useAgentSettingsStore = create<AgentSettingsStore>((set, get) => ({
  ...readState(),
  initialize: async () => {
    set((state) => ({ ...state, errorMessage: null, status: "loading" }));

    try {
      const doc = await initializeDefaultAgentConfig();
      set((state) => ({
        ...state,
        configFilePath: typeof doc?.path === "string" ? doc.path : null,
        defaultAgentMarkdown: normalizeMainAgentMarkdown(doc?.markdown),
        errorMessage: null,
        status: "ready",
      }));
      persistState({ config: get().config, enabledTools: get().enabledTools });
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatSettingsError(error, "主代理 AGENTS.md 加载失败。"),
        status: "error",
      }));
    }
  },
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
        enabledTools: state.enabledTools,
      };
      persistState(nextState);
      return { config: nextState.config };
    }),
  resetDefaultAgentMarkdown: async () => {
    try {
      const doc = await resetDefaultAgentConfig();
      set((state) => ({
        ...state,
        configFilePath: doc.path,
        defaultAgentMarkdown: normalizeMainAgentMarkdown(doc.markdown),
        errorMessage: null,
        status: "ready",
      }));
      persistState({ config: get().config, enabledTools: get().enabledTools });
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatSettingsError(error, "恢复主代理 AGENTS.md 失败。"),
        status: "error",
      }));
      throw error;
    }
  },
  toggleTool: (toolId) =>
    set((state) => {
      const enabledTools = { ...state.enabledTools, [toolId]: !state.enabledTools[toolId] };
      persistState({ config: state.config, enabledTools });
      return { enabledTools };
    }),
  updateConfig: (nextConfig) =>
    set((state) => {
      const config = { ...state.config, ...nextConfig };
      persistState({ config, enabledTools: state.enabledTools });
      return { config };
    }),
  updateDefaultAgentMarkdown: async (content) => {
    try {
      const doc = await writeDefaultAgentConfig(content);
      set((state) => ({
        ...state,
        configFilePath: doc.path,
        defaultAgentMarkdown: normalizeMainAgentMarkdown(doc.markdown),
        errorMessage: null,
        status: "ready",
      }));
      persistState({ config: get().config, enabledTools: get().enabledTools });
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatSettingsError(error, "保存主代理 AGENTS.md 失败。"),
        status: "error",
      }));
      throw error;
    }
  },
}));
