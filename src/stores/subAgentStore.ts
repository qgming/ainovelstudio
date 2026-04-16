import { create } from "zustand";
import {
  clearAgentPreferences,
  createAgent,
  deleteInstalledAgent,
  importAgentZip,
  initializeBuiltinAgents,
  readAgentPreferences,
  scanInstalledAgents,
  writeAgentPreferences,
  type AgentManifest,
  type AgentSourceKind,
  type TogglePreferences,
} from "../lib/agents/api";

export type AgentValidation = AgentManifest["validation"];
export type AgentSource = AgentSourceKind;

export type ResolvedAgent = AgentManifest & {
  enabled: boolean;
  files: string[];
  sourceLabel: string;
};

type AgentPreferences = {
  enabledById: Record<string, boolean>;
};

function emptyPreferences(): AgentPreferences {
  return { enabledById: {} };
}

function normalizePreferences(preferences?: Partial<TogglePreferences> | null): AgentPreferences {
  return {
    enabledById:
      preferences?.enabledById && typeof preferences.enabledById === "object" ? preferences.enabledById : {},
  };
}

function getAgentDefaultEnabled(agent: AgentManifest) {
  return Boolean(agent.defaultEnabled && agent.validation.isValid);
}

function isAgentEnabled(agent: AgentManifest, preferences: AgentPreferences) {
  const explicit = preferences.enabledById[agent.id];
  return typeof explicit === "boolean" ? explicit : getAgentDefaultEnabled(agent);
}

type SubAgentState = {
  errorMessage: string | null;
  lastScannedAt: number | null;
  manifests: AgentManifest[];
  preferences: AgentPreferences;
  status: "idle" | "loading" | "ready" | "error";
};

type SubAgentActions = {
  createAgent: (name: string, description: string) => Promise<string>;
  deleteInstalledAgentById: (agentId: string) => Promise<void>;
  hydrate: () => Promise<void>;
  importAgentPackage: (fileName: string, archiveBytes: number[]) => Promise<void>;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => Promise<void>;
  toggleAgent: (agentId: string) => Promise<void>;
};

export type SubAgentStore = SubAgentState & SubAgentActions;

function formatAgentsError(error: unknown, fallbackMessage: string) {
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
    try {
      return JSON.stringify(error);
    } catch {
      return fallbackMessage;
    }
  }
  return fallbackMessage;
}

function getSourceLabel(sourceKind: AgentSourceKind) {
  switch (sourceKind) {
    case "builtin-package":
      return "内置";
    case "installed-package":
      return "已安装";
    default:
      return "代理";
  }
}

function sortManifests(manifests: AgentManifest[]) {
  return [...manifests].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

function resolveFiles() {
  return ["manifest.json", "AGENTS.md", "TOOLS.md", "MEMORY.md"];
}

function resolveAgents(manifests: AgentManifest[], preferences: AgentPreferences): ResolvedAgent[] {
  return manifests.map((agent) => ({
    ...agent,
    enabled: isAgentEnabled(agent, preferences),
    files: resolveFiles(),
    sourceLabel: getSourceLabel(agent.sourceKind),
  }));
}

function buildInitialState(): SubAgentState {
  return {
    errorMessage: null,
    lastScannedAt: null,
    manifests: [],
    preferences: emptyPreferences(),
    status: "idle",
  };
}

async function loadInstalledManifests() {
  return sortManifests(await scanInstalledAgents());
}

async function loadPreferences() {
  return normalizePreferences(await readAgentPreferences());
}

export function getResolvedAgents(state: Pick<SubAgentState, "manifests" | "preferences">) {
  return resolveAgents(state.manifests, state.preferences);
}

export function getEnabledAgents(state: Pick<SubAgentState, "manifests" | "preferences">) {
  return getResolvedAgents(state).filter((agent) => agent.enabled);
}

export const useSubAgentStore = create<SubAgentStore>((set, get) => ({
  ...buildInitialState(),
  createAgent: async (name, description) => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));
    try {
      const manifests = sortManifests(await createAgent(name, description));
      set((state) => ({
        ...state,
        errorMessage: null,
        lastScannedAt: Date.now(),
        manifests,
        status: "ready",
      }));
      return name;
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatAgentsError(error, "创建代理失败。"),
        status: "error",
      }));
      throw error;
    }
  },
  deleteInstalledAgentById: async (agentId) => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));
    try {
      const manifests = sortManifests(await deleteInstalledAgent(agentId));
      set((state) => ({
        ...state,
        errorMessage: null,
        lastScannedAt: Date.now(),
        manifests,
        status: "ready",
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatAgentsError(error, "删除代理失败。"),
        status: "error",
      }));
      throw error;
    }
  },
  hydrate: async () => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));
    try {
      const [manifests, preferences] = await Promise.all([loadInstalledManifests(), loadPreferences()]);
      set((state) => ({
        ...state,
        errorMessage: null,
        lastScannedAt: Date.now(),
        manifests,
        preferences,
        status: "ready",
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatAgentsError(error, "代理扫描失败。"),
        manifests: [],
        status: "error",
      }));
    }
  },
  importAgentPackage: async (fileName, archiveBytes) => {
    if (!fileName.trim() || archiveBytes.length === 0) {
      return;
    }

    set((state) => ({ ...state, status: "loading", errorMessage: null }));
    try {
      const manifests = sortManifests(await importAgentZip(fileName, archiveBytes));
      set((state) => ({
        ...state,
        errorMessage: null,
        lastScannedAt: Date.now(),
        manifests,
        status: "ready",
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatAgentsError(error, "代理导入失败。"),
        status: "error",
      }));
    }
  },
  initialize: async () => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));
    try {
      await initializeBuiltinAgents();
      const [manifests, preferences] = await Promise.all([loadInstalledManifests(), loadPreferences()]);
      set((state) => ({
        ...state,
        errorMessage: null,
        lastScannedAt: Date.now(),
        manifests,
        preferences,
        status: "ready",
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatAgentsError(error, "代理初始化失败。"),
        manifests: [],
        status: "error",
      }));
    }
  },
  refresh: async () => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));
    try {
      const [manifests, preferences] = await Promise.all([loadInstalledManifests(), loadPreferences()]);
      set((state) => ({
        ...state,
        errorMessage: null,
        lastScannedAt: Date.now(),
        manifests,
        preferences,
        status: "ready",
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatAgentsError(error, "代理刷新失败。"),
        status: "error",
      }));
    }
  },
  reset: async () => {
    const current = get();
    try {
      await clearAgentPreferences();
      set((state) => ({
        ...state,
        errorMessage: null,
        preferences: emptyPreferences(),
        status: current.manifests.length > 0 ? "ready" : "idle",
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatAgentsError(error, "重置代理启用状态失败。"),
        status: "error",
      }));
    }
  },
  toggleAgent: async (agentId) => {
    const state = get();
    const agent = state.manifests.find((item) => item.id === agentId);
    const current = isAgentEnabled(
      agent ??
        ({
          id: agentId,
          body: "",
          defaultEnabled: false,
          description: "",
          discoveredAt: 0,
          isBuiltin: false,
          manifestFilePath: undefined,
          name: agentId,
          sourceKind: "installed-package",
          suggestedTools: [],
          tags: [],
          validation: { errors: [], isValid: true, warnings: [] },
        } as AgentManifest),
      state.preferences,
    );
    const nextPreferences = {
      enabledById: {
        ...state.preferences.enabledById,
        [agentId]: !current,
      },
    };

    try {
      await writeAgentPreferences(nextPreferences);
      set((currentState) => ({
        ...currentState,
        errorMessage: null,
        preferences: nextPreferences,
        status: "ready",
      }));
    } catch (error) {
      set((currentState) => ({
        ...currentState,
        errorMessage: formatAgentsError(error, `保存代理 ${agentId} 的启用状态失败。`),
        status: "error",
      }));
    }
  },
}));
