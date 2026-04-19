import { create } from "zustand";
import {
  exportAppDataBackup,
  getDefaultDataSyncSettings,
  importAppDataBackup,
  readDataSyncSettings,
  syncAppDataViaWebdav,
  writeDataSyncSettings,
  type BackupRestoreResult,
  type DataSyncResult,
  type DataSyncSettingsDocument,
} from "../lib/dataManagement/api";
import { collectAppClientState } from "../lib/dataManagement/clientState";

type DataManagementState = {
  config: DataSyncSettingsDocument;
  errorMessage: string | null;
  status: "idle" | "loading" | "ready" | "saving" | "syncing" | "error";
};

type DataManagementActions = {
  exportBackup: () => Promise<string | null>;
  importBackup: (fileName: string, archiveBytes: number[]) => Promise<BackupRestoreResult>;
  initialize: () => Promise<void>;
  saveConfig: (config: DataSyncSettingsDocument) => Promise<DataSyncSettingsDocument>;
  syncNow: () => Promise<DataSyncResult>;
};

export type DataManagementStore = DataManagementState & DataManagementActions;

function formatError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallbackMessage;
}

async function ensureLoaded(state: DataManagementStore) {
  if (state.status === "ready" || state.status === "saving" || state.status === "syncing") {
    return state.config;
  }
  return readDataSyncSettings();
}

export const useDataManagementStore = create<DataManagementStore>((set, get) => ({
  config: getDefaultDataSyncSettings(),
  errorMessage: null,
  status: "idle",
  exportBackup: async () => {
    try {
      const savedPath = await exportAppDataBackup(collectAppClientState());
      set((state) => ({ ...state, errorMessage: null }));
      return savedPath;
    } catch (error) {
      const message = formatError(error, "导出备份失败。");
      set((state) => ({ ...state, errorMessage: message, status: "error" }));
      throw error;
    }
  },
  importBackup: async (fileName, archiveBytes) => {
    try {
      const result = await importAppDataBackup(fileName, archiveBytes);
      set((state) => ({ ...state, errorMessage: null }));
      return result;
    } catch (error) {
      const message = formatError(error, "导入备份失败。");
      set((state) => ({ ...state, errorMessage: message, status: "error" }));
      throw error;
    }
  },
  initialize: async () => {
    if (get().status === "loading" || get().status === "ready") {
      return;
    }
    set((state) => ({ ...state, errorMessage: null, status: "loading" }));
    try {
      const config = await readDataSyncSettings();
      set((state) => ({ ...state, config, errorMessage: null, status: "ready" }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatError(error, "读取云同步配置失败。"),
        status: "error",
      }));
    }
  },
  saveConfig: async (config) => {
    set((state) => ({ ...state, errorMessage: null, status: "saving" }));
    try {
      const saved = await writeDataSyncSettings(config);
      set((state) => ({ ...state, config: saved, errorMessage: null, status: "ready" }));
      return saved;
    } catch (error) {
      const message = formatError(error, "保存云同步配置失败。");
      set((state) => ({ ...state, errorMessage: message, status: "error" }));
      throw error;
    }
  },
  syncNow: async () => {
    set((state) => ({ ...state, errorMessage: null, status: "syncing" }));
    try {
      const config = await ensureLoaded(get());
      if (get().status !== "ready" && get().status !== "syncing") {
        set((state) => ({ ...state, config }));
      }
      const result = await syncAppDataViaWebdav(collectAppClientState());
      set((state) => ({ ...state, config, errorMessage: null, status: "ready" }));
      return result;
    } catch (error) {
      const message = formatError(error, "同步失败。");
      set((state) => ({ ...state, errorMessage: message, status: "error" }));
      throw error;
    }
  },
}));
