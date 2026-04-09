import { create } from "zustand";
import {
  createAgent,
  deleteInstalledAgent,
  importAgentZip,
  initializeBuiltinAgents,
  pickAgentArchive,
  scanInstalledAgents,
  type AgentManifest,
  type AgentSourceKind,
} from "../lib/agents/api";

const STORAGE_KEY = "ainovelstudio-agents-preferences";

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
  importAgentPackage: () => Promise<void>;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
  toggleAgent: (agentId: string) => void;
};

export type SubAgentStore = SubAgentState & SubAgentActions;

function readPreferences(): AgentPreferences {
  if (typeof window === "undefined") {
    return { enabledById: {} };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { enabledById: {} };
    }

    const parsed = JSON.parse(raw) as Partial<AgentPreferences>;
    return {
      enabledById: parsed.enabledById && typeof parsed.enabledById === "object" ? parsed.enabledById : {},
    };
  } catch {
    return { enabledById: {} };
  }
}

function persistPreferences(preferences: AgentPreferences) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

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
  return ["AGENTS.md", "TOOLS.md", "MEMORY.md"];
}

function resolveAgents(manifests: AgentManifest[], preferences: AgentPreferences): ResolvedAgent[] {
  return manifests.map((agent) => ({
    ...agent,
    enabled: Boolean(preferences.enabledById[agent.id]),
    files: resolveFiles(),
    sourceLabel: getSourceLabel(agent.sourceKind),
  }));
}

function buildInitialState(): SubAgentState {
  return {
    errorMessage: null,
    lastScannedAt: null,
    manifests: [],
    preferences: readPreferences(),
    status: "idle",
  };
}

async function loadInstalledManifests() {
  return sortManifests(await scanInstalledAgents());
}

export function getResolvedAgents(state: Pick<SubAgentState, "manifests" | "preferences">) {
  return resolveAgents(state.manifests, state.preferences);
}

export function getEnabledAgents(state: Pick<SubAgentState, "manifests" | "preferences">) {
  return getResolvedAgents(state).filter((agent) => agent.enabled);
}

export const useSubAgentStore = create<SubAgentStore>((set) => ({
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
      const manifests = await loadInstalledManifests();
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
        errorMessage: formatAgentsError(error, "代理扫描失败。"),
        manifests: [],
        status: "error",
      }));
    }
  },
  importAgentPackage: async () => {
    const zipPath = await pickAgentArchive();
    if (!zipPath) {
      return;
    }

    set((state) => ({ ...state, status: "loading", errorMessage: null }));
    try {
      const manifests = sortManifests(await importAgentZip(zipPath));
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
      const manifests = await loadInstalledManifests();
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
        errorMessage: formatAgentsError(error, "代理初始化失败。"),
        manifests: [],
        status: "error",
      }));
    }
  },
  refresh: async () => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));
    try {
      const manifests = sortManifests(await scanInstalledAgents());
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
        errorMessage: formatAgentsError(error, "代理刷新失败。"),
        status: "error",
      }));
    }
  },
  reset: () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    set(buildInitialState());
  },
  toggleAgent: (agentId) =>
    set((state) => {
      const nextPreferences = {
        enabledById: {
          ...state.preferences.enabledById,
          [agentId]: !state.preferences.enabledById[agentId],
        },
      };
      persistPreferences(nextPreferences);
      return {
        ...state,
        preferences: nextPreferences,
      };
    }),
}));
