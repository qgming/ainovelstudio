import { create } from "zustand";
import {
  initializeDefaultAgentConfig,
  readDefaultAgentConfig,
  writeDefaultAgentConfig,
} from "../lib/agentConfig/api";
import { clearAgentSettings, readAgentSettings, writeAgentSettings } from "../lib/agentSettings/api";
import { getDefaultEnabledTools } from "../lib/agent/toolDefs";

const STORAGE_KEY = "ainovelstudio-agent-settings";
let initializePromise: Promise<void> | null = null;

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
  refreshDefaultAgentMarkdown: () => Promise<void>;
  reset: () => void;
  resetConfig: () => void;
  toggleTool: (toolId: string) => void;
  updateConfig: (nextConfig: Partial<AgentProviderConfig>) => void;
  updateDefaultAgentMarkdown: (content: string) => Promise<void>;
};

export type AgentSettingsStore = AgentSettingsState & AgentSettingsActions;

type PersistedState = {
  config?: Partial<AgentProviderConfig>;
  enabledTools?: Record<string, boolean>;
};

function normalizeEnabledTools(enabledTools?: Record<string, boolean>) {
  const normalized = { ...(enabledTools ?? {}) };
  if ("rename_path" in normalized && !("rename" in normalized)) {
    normalized.rename = Boolean(normalized.rename_path);
  }
  return normalized;
}

function normalizePersistedState(parsed?: PersistedState | null) {
  const defaults = getDefaultState();
  return {
    config: { ...defaults.config, ...(parsed?.config ?? parsed ?? {}) },
    enabledTools: { ...defaults.enabledTools, ...normalizeEnabledTools(parsed?.enabledTools) },
  };
}

async function migrateLegacyLocalStorage() {
  const parsed = readPersistedState();
  if (!parsed.config && !parsed.enabledTools) {
    return null;
  }

  const normalized = normalizePersistedState(parsed);
  await writeAgentSettings(normalized);
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  return normalized;
}

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
  return getDefaultState();
}

async function loadPersistedAgentSettings() {
  const persisted = await readAgentSettings();
  if (persisted) {
    return normalizePersistedState({
      config: persisted.config,
      enabledTools: persisted.enabledTools,
    });
  }
  return migrateLegacyLocalStorage();
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
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
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
