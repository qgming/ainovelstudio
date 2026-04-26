import { create } from "zustand";
import {
  initializeDefaultAgentConfig,
  readDefaultAgentConfig,
  writeDefaultAgentConfig,
} from "../lib/agentConfig/api";
import {
  clearAgentSettings,
  readAgentSettings,
  writeAgentSettings,
} from "../lib/agentSettings/api";
import type { AgentProviderPreset, AgentModelConfigPreset } from "../lib/agentSettings/api";
import {
  getDefaultEnabledTools,
  migrateEnabledTools,
} from "../lib/agent/toolDefs";

let initializePromise: Promise<void> | null = null;

export type AgentReasoningEffort = "low" | "medium" | "high" | "xhigh";

export const DEFAULT_REASONING_EFFORT: AgentReasoningEffort = "xhigh";

export function normalizeReasoningEffort(
  value?: string,
): AgentReasoningEffort {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }

  return DEFAULT_REASONING_EFFORT;
}

export type AgentProviderConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  enableReasoningEffort?: boolean;
  reasoningEffort?: AgentReasoningEffort;
  simulateOpencodeBeta?: boolean;
};

export type { AgentProviderPreset, AgentModelConfigPreset };

type AgentSettingsState = {
  config: AgentProviderConfig;
  configFilePath: string | null;
  defaultAgentMarkdown: string;
  enabledTools: Record<string, boolean>;
  errorMessage: string | null;
  modelConfigPresets: AgentModelConfigPreset[];
  providerPresets: AgentProviderPreset[];
  status: "idle" | "loading" | "ready" | "error";
};

type AgentSettingsActions = {
  addModelConfigPreset: (preset: AgentModelConfigPreset) => void;
  addProviderPreset: (preset: AgentProviderPreset) => void;
  deleteModelConfigPreset: (id: string) => void;
  deleteProviderPreset: (id: string) => void;
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
    enableReasoningEffort: false,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    simulateOpencodeBeta: false,
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
    modelConfigPresets: [],
    providerPresets: [],
    status: "idle",
  };
}

function readState(): AgentSettingsState {
  return getDefaultState();
}

function normalizeProviderConfig(
  config?: Partial<AgentProviderConfig>,
): AgentProviderConfig {
  return {
    ...getDefaultConfig(),
    ...config,
    apiKey: config?.apiKey?.trim() ?? "",
    baseURL: config?.baseURL?.trim() ?? "",
    model: config?.model?.trim() ?? "",
    enableReasoningEffort: Boolean(config?.enableReasoningEffort),
    reasoningEffort: normalizeReasoningEffort(config?.reasoningEffort),
    simulateOpencodeBeta: Boolean(config?.simulateOpencodeBeta),
  };
}

function normalizeProviderPreset(preset: AgentProviderPreset): AgentProviderPreset {
  return {
    ...preset,
    apiKey: preset.apiKey ?? "",
    baseURL: preset.baseURL ?? "",
    model: preset.model ?? "",
  };
}

async function loadPersistedAgentSettings() {
  const persisted = await readAgentSettings();
  if (!persisted) {
    return null;
  }

  const defaults = getDefaultState();
  return {
    config: normalizeProviderConfig({ ...defaults.config, ...persisted.config }),
    enabledTools: migrateEnabledTools(persisted.enabledTools),
    providerPresets: (persisted.providerPresets ?? []).map(normalizeProviderPreset),
    modelConfigPresets: persisted.modelConfigPresets ?? [],
  };
}

async function persistAgentSettings(
  state: Pick<AgentSettingsState, "config" | "enabledTools" | "providerPresets" | "modelConfigPresets">,
) {
  await writeAgentSettings({
    config: state.config,
    enabledTools: state.enabledTools,
    providerPresets: state.providerPresets,
    modelConfigPresets: state.modelConfigPresets,
  });
}

function persistAgentSettingsInBackground(
  state: Pick<AgentSettingsState, "config" | "enabledTools" | "providerPresets" | "modelConfigPresets">,
  onError: (message: string) => void,
) {
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
          providerPresets: persisted?.providerPresets ?? state.providerPresets,
          modelConfigPresets: persisted?.modelConfigPresets ?? state.modelConfigPresets,
          configFilePath: typeof doc?.path === "string" ? doc.path : null,
          defaultAgentMarkdown: normalizeMainAgentMarkdown(doc?.markdown),
          errorMessage: null,
          status: "ready",
        }));
      } catch (error) {
        set((state) => ({
          ...state,
          errorMessage: formatSettingsError(
            error,
            "主代理 AGENTS.md 加载失败。",
          ),
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
      const nextState = { config, enabledTools: state.enabledTools, providerPresets: state.providerPresets, modelConfigPresets: state.modelConfigPresets };
      persistAgentSettingsInBackground(nextState, (message) => {
        set((current) => ({ ...current, errorMessage: message }));
      });
      return { config, errorMessage: null };
    }),
  saveConfig: async (config) => {
    const s = get();
    const normalizedConfig = normalizeProviderConfig(config);
    const nextState = { config: normalizedConfig, enabledTools: s.enabledTools, providerPresets: s.providerPresets, modelConfigPresets: s.modelConfigPresets };
    await persistAgentSettings(nextState);
    set((state) => ({
      ...state,
      config: normalizedConfig,
      errorMessage: null,
    }));
  },
  toggleTool: (toolId) =>
    set((state) => {
      const enabledTools = {
        ...state.enabledTools,
        [toolId]: !(state.enabledTools[toolId] ?? true),
      };
      const nextState = { config: state.config, enabledTools, providerPresets: state.providerPresets, modelConfigPresets: state.modelConfigPresets };
      persistAgentSettingsInBackground(nextState, (message) => {
        set((current) => ({ ...current, errorMessage: message }));
      });
      return { enabledTools, errorMessage: null };
    }),
  updateConfig: (nextConfig) =>
    set((state) => {
      const config = normalizeProviderConfig({ ...state.config, ...nextConfig });
      const nextState = { config, enabledTools: state.enabledTools, providerPresets: state.providerPresets, modelConfigPresets: state.modelConfigPresets };
      persistAgentSettingsInBackground(nextState, (message) => {
        set((current) => ({ ...current, errorMessage: message }));
      });
      return { config, errorMessage: null };
    }),
  addProviderPreset: (preset) =>
    set((state) => {
      const providerPresets = [...state.providerPresets.filter((p) => p.id !== preset.id), preset];
      const nextState = { config: state.config, enabledTools: state.enabledTools, providerPresets, modelConfigPresets: state.modelConfigPresets };
      persistAgentSettingsInBackground(nextState, (message) => {
        set((current) => ({ ...current, errorMessage: message }));
      });
      return { providerPresets, errorMessage: null };
    }),
  deleteProviderPreset: (id) =>
    set((state) => {
      const providerPresets = state.providerPresets.filter((p) => p.id !== id);
      const nextState = { config: state.config, enabledTools: state.enabledTools, providerPresets, modelConfigPresets: state.modelConfigPresets };
      persistAgentSettingsInBackground(nextState, (message) => {
        set((current) => ({ ...current, errorMessage: message }));
      });
      return { providerPresets, errorMessage: null };
    }),
  addModelConfigPreset: (preset) =>
    set((state) => {
      const modelConfigPresets = [...state.modelConfigPresets.filter((p) => p.id !== preset.id), preset];
      const nextState = { config: state.config, enabledTools: state.enabledTools, providerPresets: state.providerPresets, modelConfigPresets };
      persistAgentSettingsInBackground(nextState, (message) => {
        set((current) => ({ ...current, errorMessage: message }));
      });
      return { modelConfigPresets, errorMessage: null };
    }),
  deleteModelConfigPreset: (id) =>
    set((state) => {
      const modelConfigPresets = state.modelConfigPresets.filter((p) => p.id !== id);
      const nextState = { config: state.config, enabledTools: state.enabledTools, providerPresets: state.providerPresets, modelConfigPresets };
      persistAgentSettingsInBackground(nextState, (message) => {
        set((current) => ({ ...current, errorMessage: message }));
      });
      return { modelConfigPresets, errorMessage: null };
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
