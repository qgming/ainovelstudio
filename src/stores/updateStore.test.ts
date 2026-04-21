import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateStore } from "./updateStore";

const { checkForAppUpdateMock, relaunchToApplyUpdateMock, toastMock } = vi.hoisted(() => ({
  checkForAppUpdateMock: vi.fn(),
  relaunchToApplyUpdateMock: vi.fn(),
  toastMock: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("../lib/update/api", () => ({
  checkForAppUpdate: checkForAppUpdateMock,
  relaunchToApplyUpdate: relaunchToApplyUpdateMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

function createDownloadableUpdate(version = "0.1.6") {
  return {
    body: "修复若干问题",
    close: vi.fn().mockResolvedValue(undefined),
    currentVersion: "0.1.6",
    date: "2026-04-21T00:00:00Z",
    download: vi.fn().mockImplementation(async (onEvent?: (event: unknown) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 50 } });
      onEvent?.({ event: "Finished" });
    }),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
    version,
  };
}

function resetStore() {
  useUpdateStore.setState({
    autoUpdateEnabled: true,
    errorMessage: null,
    initialized: false,
    pendingInstallVersion: null,
    progress: null,
    status: "idle",
    updateSummary: null,
  });
}

describe("updateStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetStore();
    checkForAppUpdateMock.mockReset();
    relaunchToApplyUpdateMock.mockReset();
    toastMock.mockReset();
    toastMock.error.mockReset();
    toastMock.success.mockReset();
  });

  it("默认开启自动更新并持久化开关", () => {
    const store = useUpdateStore.getState();
    store.initializePreferences();

    expect(useUpdateStore.getState().autoUpdateEnabled).toBe(true);

    store.setAutoUpdateEnabled(false);

    expect(window.localStorage.getItem("ainovelstudio:auto-update-enabled")).toBe("false");
    expect(useUpdateStore.getState().autoUpdateEnabled).toBe(false);
  });

  it("检查到新版本后会下载并记录待安装版本", async () => {
    const update = createDownloadableUpdate("0.1.7");
    checkForAppUpdateMock.mockResolvedValue(update);

    await useUpdateStore.getState().checkForUpdates();

    expect(update.download).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().status).toBe("downloaded");
    expect(useUpdateStore.getState().progress).toBe(100);
    expect(useUpdateStore.getState().pendingInstallVersion).toBe("0.1.7");
    expect(window.localStorage.getItem("ainovelstudio:pending-install-version")).toBe("0.1.7");
  });

  it("启动时遇到待安装版本会继续执行安装流程", async () => {
    window.localStorage.setItem("ainovelstudio:pending-install-version", "0.1.7");
    const update = createDownloadableUpdate("0.1.7");
    checkForAppUpdateMock.mockResolvedValue(update);

    await useUpdateStore.getState().runStartupUpdateFlow();

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunchToApplyUpdateMock).toHaveBeenCalledTimes(1);
  });
});
