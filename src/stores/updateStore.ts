import packageJson from "../../package.json";
import { toast } from "sonner";
import { create } from "zustand";
import {
  fetchLatestDirectUpdate,
  openExternalUpdateUrl,
  type DirectUpdateTarget,
} from "../lib/update/api";
import { isMobileRuntime } from "../lib/platform";
import type { UpdateSummary } from "../lib/update/types";
import { compareVersions, normalizeVersionLabel } from "../lib/update/version";

const AUTO_UPDATE_ENABLED_KEY = "ainovelstudio:auto-update-enabled";
const CURRENT_VERSION = packageJson.version;

type UpdateStatus = "idle" | "available" | "checking" | "latest" | "error";

type UpdateState = {
  autoUpdateEnabled: boolean;
  errorMessage: string | null;
  initialized: boolean;
  status: UpdateStatus;
  updateSummary: UpdateSummary | null;
};

type UpdateActions = {
  checkForUpdates: (options?: { silent?: boolean }) => Promise<void>;
  downloadAvailableUpdate: () => Promise<void>;
  initializePreferences: () => void;
  runStartupUpdateFlow: () => Promise<void>;
  setAutoUpdateEnabled: (enabled: boolean) => void;
};

export type UpdateStore = UpdateState & UpdateActions;

let startupPromise: Promise<void> | null = null;

function getDefaultState(): UpdateState {
  return {
    autoUpdateEnabled: true,
    errorMessage: null,
    initialized: false,
    status: "idle",
    updateSummary: null,
  };
}

function resolveDirectUpdateTarget(): DirectUpdateTarget {
  return isMobileRuntime() ? "android-arm64" : "windows-x64";
}

function createUpdateSummary(summary: Awaited<ReturnType<typeof fetchLatestDirectUpdate>>): UpdateSummary {
  return {
    currentVersion: CURRENT_VERSION,
    version: summary.version,
    notes: summary.notes,
    publishedAt: summary.publishedAt,
    downloadUrl: summary.downloadUrl,
    packageKind: summary.packageKind,
  };
}

function formatVersionLabel(version: string) {
  return normalizeVersionLabel(version);
}

function formatError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallbackMessage;
}

function readBooleanStorage(key: string, fallbackValue: boolean) {
  if (typeof window === "undefined") {
    return fallbackValue;
  }
  const rawValue = window.localStorage.getItem(key);
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }
  return fallbackValue;
}

function writeBooleanStorage(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, String(value));
}

export const useUpdateStore = create<UpdateStore>((set, get) => {
  function initializePreferences() {
    if (get().initialized) {
      return;
    }

    const autoUpdateEnabled = readBooleanStorage(AUTO_UPDATE_ENABLED_KEY, true);
    set((state) => ({
      ...state,
      autoUpdateEnabled,
      initialized: true,
    }));
  }

  async function openAvailableUpdate(summary: UpdateSummary) {
    if (!summary.downloadUrl) {
      return;
    }

    await openExternalUpdateUrl(summary.downloadUrl);
    toast.success("已打开更新下载链接", {
      description: `${formatVersionLabel(summary.version)} 将通过浏览器继续下载。`,
    });
  }

  async function performDirectUpdateCheck(silent: boolean) {
    set((state) => ({
      ...state,
      errorMessage: null,
      status: "checking",
    }));

    try {
      const release = await fetchLatestDirectUpdate(resolveDirectUpdateTarget());
      if (compareVersions(release.version, CURRENT_VERSION) <= 0) {
        set((state) => ({
          ...state,
          errorMessage: null,
          status: "latest",
          updateSummary: null,
        }));
        if (!silent) {
          toast.success("当前已是最新版本", {
            description: `当前版本 ${formatVersionLabel(CURRENT_VERSION)}`,
          });
        }
        return;
      }

      set((state) => ({
        ...state,
        errorMessage: null,
        status: "available",
        updateSummary: createUpdateSummary(release),
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatError(error, "检查更新失败。"),
        status: "error",
      }));
      if (!silent) {
        toast.error("检查更新失败", {
          description: formatError(error, "请稍后重试。"),
        });
      }
    }
  }

  return {
    ...getDefaultState(),
    downloadAvailableUpdate: async () => {
      initializePreferences();
      const currentSummary = get().updateSummary;
      if (!currentSummary) {
        return;
      }

      set((state) => ({
        ...state,
        errorMessage: null,
      }));

      try {
        await openAvailableUpdate(currentSummary);
      } catch (error) {
        set((state) => ({
          ...state,
          errorMessage: formatError(error, "打开下载链接失败。"),
          status: "error",
        }));
        toast.error("打开下载链接失败", {
          description: formatError(error, "请稍后重试。"),
        });
      }
    },
    initializePreferences,
    setAutoUpdateEnabled: (enabled) => {
      writeBooleanStorage(AUTO_UPDATE_ENABLED_KEY, enabled);
      set((state) => ({
        ...state,
        autoUpdateEnabled: enabled,
      }));
    },
    checkForUpdates: async ({ silent = false } = {}) => {
      initializePreferences();
      if (get().status === "checking") {
        return;
      }
      await performDirectUpdateCheck(silent);
    },
    runStartupUpdateFlow: async () => {
      if (startupPromise) {
        return startupPromise;
      }

      startupPromise = (async () => {
        initializePreferences();
        if (!get().autoUpdateEnabled) {
          return;
        }

        await get().checkForUpdates({ silent: true });
      })().finally(() => {
        startupPromise = null;
      });

      return startupPromise;
    },
  };
});
