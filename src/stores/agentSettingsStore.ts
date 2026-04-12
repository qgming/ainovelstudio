import { create } from "zustand";
import {
  initializeDefaultAgentConfig,
  readDefaultAgentConfig,
  writeDefaultAgentConfig,
} from "../lib/agentConfig/api";
import { clearAgentSettings, readAgentSettings, writeAgentSettings } from "../lib/agentSettings/api";
import { getDefaultEnabledTools } from "../lib/agent/toolDefs";

let initializePromise: Promise<void> | null = null;

export type AgentProviderConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
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
  refreshDefaultAgentMarkdown: () => Promise<void>;
  reset: () => void;
  resetConfig: () => void;
  saveConfig: (config: AgentProviderConfig) => Promise<void>;
  toggleTool: (toolId: string) => void;
  updateConfig: (nextConfig: Partial<AgentProviderConfig>) => void;
  updateDefaultAgentMarkdown: (content: string) => Promise<void>;
};

export type AgentSettingsStore = AgentSettingsState & AgentSettingsActions;

function getDefaultConfig(): AgentProviderConfig {
  return {
    apiKey: "",
    baseURL: "",
    model: "",
  };
}

export function getDefaultAgentProviderConfig(): AgentProviderConfig {
  return getDefaultConfig();
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

function readState(): AgentSettingsState {
  return getDefaultState();
}

async function loadPersistedAgentSettings() {
  const persisted = await readAgentSettings();
  if (!persisted) {
    return null;
  }

  const defaults = getDefaultState();
  return {
    config: { ...defaults.config, ...persisted.config },
    enabledTools: { ...defaults.enabledTools, ...(persisted.enabledTools ?? {}) },
  };
}

async function persistAgentSettings(state: Pick<AgentSettingsState, "config" | "enabledTools">) {
  await writeAgentSettings({
    config: state.config,
    enabledTools: state.enabledTools,
  });
}

function persistAgentSettingsInBackground(state: Pick<AgentSettingsState, "config" | "enabledTools">, onError: (message: string) => void) {
  void persistAgentSettings(state).catch((error) => {
    onError(formatSettingsError(error, "保存 Agent 设置失败。"));
  });
}

function formatSettingsError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (typeof error === "object" && error !== null) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallbackMessage;
}

function normalizeMainAgentMarkdown(markdown: unknown) {
  return typeof markdown === "string" ? markdown : "";
}

export function getStoredAgentConfig() {
  return useAgentSettingsStore.getState().config;
}

export function getStoredDefaultAgentMarkdown() {
  return useAgentSettingsStore.getState().defaultAgentMarkdown;
}

export function getStoredEnabledTools() {
  return useAgentSettingsStore.getState().enabledTools;
}

export const useAgentSettingsStore = create<AgentSettingsStore>((set, get) => ({
  ...readState(),
  initialize: async () => {
    if (get().status === "ready") {
      return;
    }
    if (initializePromise) {
      return initializePromise;
    }

    initializePromise = (async () => {
      set((state) => ({ ...state, errorMessage: null, status: "loading" }));

      try {
        const [doc, persisted] = await Promise.all([
          initializeDefaultAgentConfig(),
          loadPersistedAgentSettings(),
        ]);
        set((state) => ({
          ...state,
          config: persisted?.config ?? state.config,
          enabledTools: persisted?.enabledTools ?? state.enabledTools,
          configFilePath: typeof doc?.path === "string" ? doc.path : null,
          defaultAgentMarkdown: normalizeMainAgentMarkdown(doc?.markdown),
          errorMessage: null,
          status: "ready",
        }));
      } catch (error) {
        set((state) => ({
          ...state,
          errorMessage: formatSettingsError(error, "主代理 AGENTS.md 加载失败。"),
          status: "error",
        }));
      }
    })().finally(() => {
      initializePromise = null;
    });

    return initializePromise;
  },
  refreshDefaultAgentMarkdown: async () => {
    set((state) => ({ ...state, errorMessage: null, status: "loading" }));

    try {
      const doc = await readDefaultAgentConfig();
      set((state) => ({
        ...state,
        configFilePath: typeof doc?.path === "string" ? doc.path : null,
        defaultAgentMarkdown: normalizeMainAgentMarkdown(doc?.markdown),
        errorMessage: null,
        status: "ready",
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatSettingsError(error, "主代理 AGENTS.md 刷新失败。"),
        status: "error",
      }));
      throw error;
    }
  },
  reset: () => {
    initializePromise = null;
    void clearAgentSettings().catch((error) => {
      set((state) => ({
        ...state,
        errorMessage: formatSettingsError(error, "重置 Agent 设置失败。"),
      }));
    });
    set(getDefaultState());
  },
  resetConfig: () =>
    set((state) => {
      const config = getDefaultConfig();
      const nextState = { config, enabledTools: state.enabledTools };
      persistAgentSettingsInBackground(nextState, (message) => {
        set((current) => ({ ...current, errorMessage: message }));
      });
      return { config, errorMessage: null };
    }),
  saveConfig: async (config) => {
    const nextState = { config, enabledTools: get().enabledTools };
    await persistAgentSettings(nextState);
    set((state) => ({
      ...state,
      config,
      errorMessage: null,
    }));
  },
  toggleTool: (toolId) =>
    set((state) => {
      const enabledTools = {
        ...state.enabledTools,
        [toolId]: !(state.enabledTools[toolId] ?? true),
      };
      const nextState = { config: state.config, enabledTools };
      persistAgentSettingsInBackground(nextState, (message) => {
        set((current) => ({ ...current, errorMessage: message }));
      });
      return { enabledTools, errorMessage: null };
    }),
  updateConfig: (nextConfig) =>
    set((state) => {
      const config = { ...state.config, ...nextConfig };
      const nextState = { config, enabledTools: state.enabledTools };
      persistAgentSettingsInBackground(nextState, (message) => {
        set((current) => ({ ...current, errorMessage: message }));
      });
      return { config, errorMessage: null };
    }),
  updateDefaultAgentMarkdown: async (content) => {
    try {
      const doc = await writeDefaultAgentConfig(content);
      set((state) => ({
        ...state,
        configFilePath: typeof doc?.path === "string" ? doc.path : null,
        defaultAgentMarkdown: normalizeMainAgentMarkdown(doc?.markdown),
        errorMessage: null,
        status: "ready",
      }));
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
