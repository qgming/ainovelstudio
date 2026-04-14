import { create } from "zustand";
import {
  clearSkillPreferences,
  createSkill,
  createSkillReferenceFile,
  deleteInstalledSkill,
  importSkillZip,
  initializeBuiltinSkills,
  readSkillPreferences,
  scanInstalledSkills,
  writeSkillPreferences,
  type SkillManifest,
  type SkillSourceKind,
  type TogglePreferences,
} from "../lib/skills/api";

export type ResolvedSkill = SkillManifest & {
  enabled: boolean;
  effectivePrompt: string;
  sourceLabel: string;
};

type SkillPreferences = {
  enabledById: Record<string, boolean>;
};

function emptyPreferences(): SkillPreferences {
  return { enabledById: {} };
}

function normalizePreferences(preferences?: Partial<TogglePreferences> | null): SkillPreferences {
  return {
    enabledById:
      preferences?.enabledById && typeof preferences.enabledById === "object" ? preferences.enabledById : {},
  };
}

function getSkillDefaultEnabled(skill: SkillManifest) {
  return Boolean(skill.defaultEnabled && skill.validation.isValid);
}

function isSkillEnabled(skill: SkillManifest, preferences: SkillPreferences) {
  const explicit = preferences.enabledById[skill.id];
  return typeof explicit === "boolean" ? explicit : getSkillDefaultEnabled(skill);
}

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
  importSkillPackage: (fileName: string, archiveBytes: number[]) => Promise<void>;
  refresh: () => Promise<void>;
  reset: () => Promise<void>;
  toggleSkill: (skillId: string) => Promise<void>;
};

export type SkillsStore = SkillsState & SkillsActions;

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
    enabled: isSkillEnabled(skill, preferences),
    effectivePrompt: skill.body,
    sourceLabel: getSourceLabel(skill.sourceKind),
  }));
}

function buildInitialState(): SkillsState {
  return {
    errorMessage: null,
    lastScannedAt: null,
    manifests: [],
    preferences: emptyPreferences(),
    status: "idle",
  };
}

async function loadInstalledManifests() {
  return sortManifests(await scanInstalledSkills());
}

async function loadPreferences() {
  return normalizePreferences(await readSkillPreferences());
}

export function getResolvedSkills(state: Pick<SkillsState, "manifests" | "preferences">) {
  return resolveSkills(state.manifests, state.preferences);
}

export function getEnabledSkills(state: Pick<SkillsState, "manifests" | "preferences">) {
  return getResolvedSkills(state).filter((skill) => skill.enabled);
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  ...buildInitialState(),
  createReferenceFile: async (skillId, name) => {
    set((state) => ({ ...state, status: "loading", errorMessage: null }));

    try {
      const manifests = sortManifests(await createSkillReferenceFile(skillId, name));
      const updatedSkill = manifests.find((item) => item.id === skillId);
      const createdReference = updatedSkill?.references.find(
        (entry) => entry.name === `${name}.md` || entry.path === `references/${name}.md`,
      );
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
        errorMessage: formatSkillsError(error, "技能初始化失败。"),
        manifests: [],
        status: "error",
      }));
    }
  },
  importSkillPackage: async (fileName, archiveBytes) => {
    if (!fileName.trim() || archiveBytes.length === 0) {
      return;
    }

    set((state) => ({ ...state, status: "loading", errorMessage: null }));

    try {
      const manifests = sortManifests(await importSkillZip(fileName, archiveBytes));
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
        errorMessage: formatSkillsError(error, "技能刷新失败。"),
        status: "error",
      }));
    }
  },
  reset: async () => {
    const current = get();
    try {
      await clearSkillPreferences();
      set((state) => ({
        ...state,
        errorMessage: null,
        preferences: emptyPreferences(),
        status: current.manifests.length > 0 ? "ready" : "idle",
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatSkillsError(error, "重置技能启用状态失败。"),
        status: "error",
      }));
    }
  },
  toggleSkill: async (skillId) => {
    const state = get();
    const skill = state.manifests.find((item) => item.id === skillId);
    const current = isSkillEnabled(
      skill ??
        ({
          id: skillId,
          body: "",
          defaultEnabled: false,
          description: "",
          discoveredAt: 0,
          isBuiltin: false,
          name: skillId,
          rawMarkdown: "",
          references: [],
          sourceKind: "installed-package",
          suggestedTools: [],
          tags: [],
          validation: { errors: [], isValid: true, warnings: [] },
        } as SkillManifest),
      state.preferences,
    );
    const nextPreferences = {
      enabledById: {
        ...state.preferences.enabledById,
        [skillId]: !current,
      },
    };

    try {
      await writeSkillPreferences(nextPreferences);
      set((currentState) => ({
        ...currentState,
        errorMessage: null,
        preferences: nextPreferences,
        status: "ready",
      }));
    } catch (error) {
      set((currentState) => ({
        ...currentState,
        errorMessage: formatSkillsError(error, `保存技能 ${skillId} 的启用状态失败。`),
        status: "error",
      }));
    }
  },
}));
