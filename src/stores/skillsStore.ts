import { create } from "zustand";
import {
  createSkill,
  createSkillReferenceFile,
  deleteInstalledSkill,
  importSkillZip,
  initializeBuiltinSkills,
  pickSkillArchive,
  scanInstalledSkills,
  type SkillManifest,
  type SkillSourceKind,
} from "../lib/skills/api";

const STORAGE_KEY = "ainovelstudio-skills-preferences";

export type SkillReferenceEntry = SkillManifest["references"][number];
export type SkillValidation = SkillManifest["validation"];
export type SkillSource = SkillSourceKind;

export type ResolvedSkill = SkillManifest & {
  enabled: boolean;
  effectivePrompt: string;
  sourceLabel: string;
};

type SkillPreferences = {
  enabledById: Record<string, boolean>;
};

type SkillsState = {
  errorMessage: string | null;
  lastScannedAt: number | null;
  manifests: SkillManifest[];
  preferences: SkillPreferences;
  status: "idle" | "loading" | "ready" | "error";
};

type SkillsActions = {
  createReferenceFile: (skillId: string, name: string) => Promise<string>;
  createSkill: (name: string, description: string) => Promise<string>;
  deleteInstalledSkillById: (skillId: string) => Promise<void>;
  hydrate: () => Promise<void>;
  initialize: () => Promise<void>;
  importSkillPackage: () => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => void;
  toggleSkill: (skillId: string) => void;
};

export type SkillsStore = SkillsState & SkillsActions;

function readPreferences(): SkillPreferences {
  if (typeof window === "undefined") {
    return { enabledById: {} };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { enabledById: {} };
    }

    const parsed = JSON.parse(raw) as Partial<SkillPreferences>;
    return {
      enabledById: parsed.enabledById && typeof parsed.enabledById === "object" ? parsed.enabledById : {},
    };
  } catch {
    return { enabledById: {} };
  }
}

function persistPreferences(preferences: SkillPreferences) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function formatSkillsError(error: unknown, fallbackMessage: string) {
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

function getSourceLabel(sourceKind: SkillSourceKind) {
  switch (sourceKind) {
    case "builtin-package":
      return "内置";
    case "installed-package":
      return "已安装";
    default:
      return "技能";
  }
}

function sortManifests(manifests: SkillManifest[]) {
  return [...manifests].sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

function resolveSkills(manifests: SkillManifest[], preferences: SkillPreferences): ResolvedSkill[] {
  return manifests.map((skill) => ({
    ...skill,
    enabled: Boolean(preferences.enabledById[skill.id]),
    effectivePrompt: skill.body,
    sourceLabel: getSourceLabel(skill.sourceKind),
  }));
}

function buildInitialState(): SkillsState {
  return {
    errorMessage: null,
    lastScannedAt: null,
    manifests: [],
    preferences: readPreferences(),
    status: "idle",
  };
}

async function loadInstalledManifests() {
  return sortManifests(await scanInstalledSkills());
}

export function getResolvedSkills(state: Pick<SkillsState, "manifests" | "preferences">) {
  return resolveSkills(state.manifests, state.preferences);
}

export function getEnabledSkills(state: Pick<SkillsState, "manifests" | "preferences">) {
  return getResolvedSkills(state).filter((skill) => skill.enabled);
}

export const useSkillsStore = create<SkillsStore>((set) => ({
  ...buildInitialState(),
  createReferenceFile: async (skillId, name) => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));

    try {
      const manifests = sortManifests(await createSkillReferenceFile(skillId, name));
      const updatedSkill = manifests.find((item) => item.id === skillId);
      const createdReference = updatedSkill?.references.find((entry) => entry.name === `${name}.md` || entry.path === `references/${name}.md`);
      set((state) => ({
        ...state,
        errorMessage: null,
        lastScannedAt: Date.now(),
        manifests,
        status: "ready",
      }));
      return createdReference?.path ?? `references/${name}.md`;
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatSkillsError(error, "创建参考文献失败。"),
        status: "error",
      }));
      throw error;
    }
  },
  createSkill: async (name, description) => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));

    try {
      const manifests = sortManifests(await createSkill(name, description));
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
        errorMessage: formatSkillsError(error, "创建技能失败。"),
        status: "error",
      }));
      throw error;
    }
  },
  deleteInstalledSkillById: async (skillId) => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));

    try {
      const manifests = sortManifests(await deleteInstalledSkill(skillId));
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
        errorMessage: formatSkillsError(error, "删除技能失败。"),
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
        errorMessage: formatSkillsError(error, "技能扫描失败。"),
        manifests: [],
        status: "error",
      }));
    }
  },
  initialize: async () => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));

    try {
      await initializeBuiltinSkills();
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
        errorMessage: formatSkillsError(error, "技能初始化失败。"),
        manifests: [],
        status: "error",
      }));
    }
  },
  importSkillPackage: async () => {
    const zipPath = await pickSkillArchive();
    if (!zipPath) {
      return;
    }

    set((state) => ({ ...state, status: "loading", errorMessage: null }));

    try {
      const manifests = sortManifests(await importSkillZip(zipPath));
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
        errorMessage: formatSkillsError(error, "技能导入失败。"),
        status: "error",
      }));
    }
  },
  refresh: async () => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));

    try {
      const manifests = sortManifests(await scanInstalledSkills());
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
        errorMessage: formatSkillsError(error, "技能刷新失败。"),
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
  toggleSkill: (skillId) =>
    set((state) => {
      const nextPreferences = {
        enabledById: {
          ...state.preferences.enabledById,
          [skillId]: !state.preferences.enabledById[skillId],
        },
      };
      persistPreferences(nextPreferences);
      return {
        ...state,
        preferences: nextPreferences,
      };
    }),
}));
