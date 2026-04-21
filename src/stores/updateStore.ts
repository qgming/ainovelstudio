import { isTauri } from "@tauri-apps/api/core";
import packageJson from "../../package.json";
import { toast } from "sonner";
import { create } from "zustand";
import {
  checkForAppUpdate,
  relaunchToApplyUpdate,
  type AppUpdateHandle,
  type AppUpdateProgressEvent,
} from "../lib/update/api";
import { isMobileRuntime } from "../lib/platform";
import type { UpdateSummary } from "../lib/update/types";
import { compareVersions, normalizeVersionLabel } from "../lib/update/version";

const AUTO_UPDATE_ENABLED_KEY = "ainovelstudio:auto-update-enabled";
const PENDING_INSTALL_VERSION_KEY = "ainovelstudio:pending-install-version";
const CURRENT_VERSION = packageJson.version;

type UpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "downloaded"
  | "installing"
  | "latest"
  | "error";

type UpdateState = {
  autoUpdateEnabled: boolean;
  errorMessage: string | null;
  initialized: boolean;
  pendingInstallVersion: string | null;
  progress: number | null;
  status: UpdateStatus;
  updateSummary: UpdateSummary | null;
};

type UpdateActions = {
  checkForUpdates: (options?: { silent?: boolean }) => Promise<void>;
  initializePreferences: () => void;
  installDownloadedUpdate: () => Promise<void>;
  runStartupUpdateFlow: () => Promise<void>;
  setAutoUpdateEnabled: (enabled: boolean) => void;
};

export type UpdateStore = UpdateState & UpdateActions;

let stagedUpdate: AppUpdateHandle | null = null;
let startupPromise: Promise<void> | null = null;

function getDefaultState(): UpdateState {
  return {
    autoUpdateEnabled: true,
    errorMessage: null,
    initialized: false,
    pendingInstallVersion: null,
    progress: null,
    status: "idle",
    updateSummary: null,
  };
}

function canUseDesktopUpdater() {
  return isTauri() && !isMobileRuntime();
}

function closeStagedUpdate() {
  const current = stagedUpdate;
  stagedUpdate = null;
  if (!current) {
    return;
  }
  void current.close().catch(() => undefined);
}

function createUpdateSummary(update: AppUpdateHandle): UpdateSummary {
  return {
    currentVersion: update.currentVersion,
    version: update.version,
    notes: update.body?.trim() ?? "",
    publishedAt: update.date ?? null,
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

function readStringStorage(key: string) {
  if (typeof window === "undefined") {
    return null;
  }
  const value = window.localStorage.getItem(key);
  return value?.trim() ? value : null;
}

function writeBooleanStorage(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, String(value));
}

function writePendingInstallVersion(version: string | null) {
  if (typeof window === "undefined") {
    return;
  }
  if (!version) {
    window.localStorage.removeItem(PENDING_INSTALL_VERSION_KEY);
    return;
  }
  window.localStorage.setItem(PENDING_INSTALL_VERSION_KEY, version);
}

function buildProgressHandler(onProgress: (progress: number | null) => void) {
  let downloadedBytes = 0;
  let totalBytes = 0;

  return (event: AppUpdateProgressEvent) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength ?? 0;
      onProgress(0);
      return;
    }

    if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      if (totalBytes > 0) {
        onProgress(Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)));
      }
      return;
    }

    onProgress(100);
  };
}

function showDownloadedToast(summary: UpdateSummary) {
  const versionLabel = formatVersionLabel(summary.version);
  toast.success("新版本已下载完成", {
    description: `${versionLabel} 已准备好。立即安装会重启应用，稍后安装会在下次打开时继续。`,
    duration: 20000,
    action: {
      label: "立即安装",
      onClick: () => {
        void useUpdateStore.getState().installDownloadedUpdate();
      },
    },
    cancel: {
      label: "稍后安装",
      onClick: () => {
        toast("已安排稍后安装", {
          description: `下次打开应用时会继续安装 ${versionLabel}。`,
        });
      },
    },
  });
}

export const useUpdateStore = create<UpdateStore>((set, get) => {
  function initializePreferences() {
    if (get().initialized) {
      return;
    }

    const autoUpdateEnabled = readBooleanStorage(AUTO_UPDATE_ENABLED_KEY, true);
    const pendingInstallVersion = readStringStorage(PENDING_INSTALL_VERSION_KEY);
    const shouldClearPending =
      pendingInstallVersion &&
      compareVersions(CURRENT_VERSION, pendingInstallVersion) >= 0;

    if (shouldClearPending) {
      writePendingInstallVersion(null);
    }

    set((state) => ({
      ...state,
      autoUpdateEnabled,
      initialized: true,
      pendingInstallVersion: shouldClearPending ? null : pendingInstallVersion,
    }));
  }

  async function downloadUpdate(update: AppUpdateHandle) {
    const summary = createUpdateSummary(update);
    closeStagedUpdate();
    set((state) => ({
      ...state,
      errorMessage: null,
      progress: 0,
      status: "downloading",
      updateSummary: summary,
    }));

    try {
      await update.download(
        buildProgressHandler((progress) => {
          set((state) => ({ ...state, progress }));
        }),
      );
      stagedUpdate = update;
      writePendingInstallVersion(summary.version);
      set((state) => ({
        ...state,
        pendingInstallVersion: summary.version,
        progress: 100,
        status: "downloaded",
        updateSummary: summary,
      }));
      showDownloadedToast(summary);
    } catch (error) {
      void update.close().catch(() => undefined);
      set((state) => ({
        ...state,
        errorMessage: formatError(error, "下载更新失败。"),
        progress: null,
        status: "error",
      }));
      toast.error("下载更新失败", {
        description: formatError(error, "请稍后重试。"),
      });
    }
  }

  async function continuePendingInstall(version: string) {
    const versionLabel = formatVersionLabel(version);
    set((state) => ({
      ...state,
      errorMessage: null,
      progress: null,
      status: "installing",
    }));
    toast("继续安装更新", {
      description: `${versionLabel} 将在准备完成后自动应用。`,
    });

    try {
      const update = await checkForAppUpdate();
      if (!update || compareVersions(update.version, version) !== 0) {
        writePendingInstallVersion(null);
        set((state) => ({
          ...state,
          pendingInstallVersion: null,
          progress: null,
          status: "latest",
        }));
        return;
      }

      await update.downloadAndInstall(
        buildProgressHandler((progress) => {
          set((state) => ({ ...state, progress }));
        }),
      );
      await relaunchToApplyUpdate();
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatError(error, "安装更新失败。"),
        progress: null,
        status: "error",
      }));
      toast.error("安装更新失败", {
        description: formatError(error, "请稍后重试。"),
      });
    }
  }

  return {
    ...getDefaultState(),
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
      if (!canUseDesktopUpdater()) {
        return;
      }

      if (get().status === "checking" || get().status === "downloading" || get().status === "installing") {
        return;
      }

      if (get().status === "downloaded" && stagedUpdate) {
        showDownloadedToast(get().updateSummary ?? createUpdateSummary(stagedUpdate));
        return;
      }

      set((state) => ({
        ...state,
        errorMessage: null,
        progress: null,
        status: "checking",
      }));

      try {
        const update = await checkForAppUpdate();
        if (!update) {
          closeStagedUpdate();
          set((state) => ({
            ...state,
            errorMessage: null,
            progress: null,
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

        if (!silent) {
          toast("发现新版本", {
            description: `${formatVersionLabel(update.version)} 正在后台下载。`,
          });
        }
        await downloadUpdate(update);
      } catch (error) {
        set((state) => ({
          ...state,
          errorMessage: formatError(error, "检查更新失败。"),
          progress: null,
          status: "error",
        }));
        if (!silent) {
          toast.error("检查更新失败", {
            description: formatError(error, "请稍后重试。"),
          });
        }
      }
    },
    installDownloadedUpdate: async () => {
      initializePreferences();
      if (!canUseDesktopUpdater()) {
        return;
      }

      const pendingVersion = get().pendingInstallVersion;
      if (stagedUpdate) {
        set((state) => ({
          ...state,
          errorMessage: null,
          progress: 100,
          status: "installing",
        }));

        try {
          await stagedUpdate.install();
          closeStagedUpdate();
          await relaunchToApplyUpdate();
        } catch (error) {
          set((state) => ({
            ...state,
            errorMessage: formatError(error, "安装更新失败。"),
            progress: null,
            status: "error",
          }));
          toast.error("安装更新失败", {
            description: formatError(error, "请稍后重试。"),
          });
        }
        return;
      }

      if (pendingVersion) {
        await continuePendingInstall(pendingVersion);
        return;
      }

      toast("当前没有待安装的更新", {
        description: `当前版本 ${formatVersionLabel(CURRENT_VERSION)}`,
      });
    },
    runStartupUpdateFlow: async () => {
      if (startupPromise) {
        return startupPromise;
      }

      startupPromise = (async () => {
        initializePreferences();
        if (!canUseDesktopUpdater()) {
          return;
        }

        const pendingVersion = get().pendingInstallVersion;
        if (pendingVersion) {
          await continuePendingInstall(pendingVersion);
          return;
        }

        if (get().autoUpdateEnabled) {
          await get().checkForUpdates({ silent: true });
        }
      })().finally(() => {
        startupPromise = null;
      });

      return startupPromise;
    },
  };
});
