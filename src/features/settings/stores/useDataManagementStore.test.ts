import { beforeEach, describe, expect, it, vi } from "vitest";

const { clientStateSnapshot, defaultConfig } = vi.hoisted(() => ({
  clientStateSnapshot: { sidebarOpen: true },
  defaultConfig: {
    enabled: false,
    password: "",
    remotePath: "ainovelstudio",
    serverUrl: "",
    username: "",
  },
}));

vi.mock("@features/settings/data-sync/dataSyncApi", () => ({
  downloadAppDataBackupViaWebdav: vi.fn(),
  exportAppDataBackup: vi.fn(),
  getDefaultDataSyncSettings: vi.fn(() => defaultConfig),
  importAppDataBackup: vi.fn(),
  readDataSyncSettings: vi.fn(),
  uploadAppDataBackupViaWebdav: vi.fn(),
  writeDataSyncSettings: vi.fn(),
}));

vi.mock("@features/settings/data-sync/clientState", () => ({
  collectAppClientState: vi.fn(() => clientStateSnapshot),
}));

import {
  readDataSyncSettings,
  uploadAppDataBackupViaWebdav,
} from "@features/settings/data-sync/dataSyncApi";
import { collectAppClientState } from "@features/settings/data-sync/clientState";
import { useDataManagementStore } from "./useDataManagementStore";

describe("dataManagementStore", () => {
  beforeEach(() => {
    vi.mocked(readDataSyncSettings).mockReset();
    vi.mocked(uploadAppDataBackupViaWebdav).mockReset();
    vi.mocked(collectAppClientState).mockClear();
    useDataManagementStore.setState({
      config: defaultConfig,
      errorMessage: null,
      status: "idle",
    });
  });

  it("initialize 会读取云备份配置", async () => {
    const savedConfig = {
      ...defaultConfig,
      enabled: true,
      serverUrl: "https://dav.example.com",
      username: "writer",
    };
    vi.mocked(readDataSyncSettings).mockResolvedValue(savedConfig);

    await useDataManagementStore.getState().initialize();

    expect(vi.mocked(readDataSyncSettings)).toHaveBeenCalledTimes(1);
    expect(useDataManagementStore.getState().config).toEqual(savedConfig);
    expect(useDataManagementStore.getState().status).toBe("ready");
  });

  it("uploadCloudBackup 会携带客户端状态上传", async () => {
    vi.mocked(uploadAppDataBackupViaWebdav).mockResolvedValue({
      localUpdatedAt: 123,
      remoteUpdatedAt: 120,
    });
    useDataManagementStore.setState({
      config: { ...defaultConfig, serverUrl: "https://dav.example.com" },
      status: "ready",
    });

    await useDataManagementStore.getState().uploadCloudBackup();

    expect(vi.mocked(collectAppClientState)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(uploadAppDataBackupViaWebdav)).toHaveBeenCalledWith(clientStateSnapshot);
    expect(useDataManagementStore.getState().status).toBe("ready");
  });

  it("不再暴露手动重写技能入口", () => {
    expect("reinitializeSkills" in useDataManagementStore.getState()).toBe(false);
  });
});
