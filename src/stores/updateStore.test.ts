import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUpdateStore } from "./updateStore";

const {
  fetchLatestDirectUpdateMock,
  openExternalUpdateUrlMock,
  toastMock,
} = vi.hoisted(() => ({
  fetchLatestDirectUpdateMock: vi.fn(),
  openExternalUpdateUrlMock: vi.fn(),
  toastMock: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("../lib/update/api", () => ({
  fetchLatestDirectUpdate: fetchLatestDirectUpdateMock,
  openExternalUpdateUrl: openExternalUpdateUrlMock,
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

function resetStore() {
  useUpdateStore.setState({
    autoUpdateEnabled: true,
    errorMessage: null,
    initialized: false,
    status: "idle",
    updateSummary: null,
  });
}

describe("updateStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetStore();
    fetchLatestDirectUpdateMock.mockReset();
    openExternalUpdateUrlMock.mockReset();
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

  it("检测到新版本后会保存更新摘要", async () => {
    fetchLatestDirectUpdateMock.mockResolvedValue({
      downloadUrl: "https://example.com/ainovelstudio_0.1.9_windows_x64.exe",
      notes: "修复若干问题",
      packageKind: "exe",
      publishedAt: "2026-04-21T00:00:00Z",
      version: "0.1.9",
    });

    await useUpdateStore.getState().checkForUpdates();

    expect(useUpdateStore.getState().status).toBe("available");
    expect(useUpdateStore.getState().updateSummary).toMatchObject({
      currentVersion: "0.1.8",
      version: "0.1.9",
    });
  });

  it("下载更新会直接打开外部安装包链接", async () => {
    useUpdateStore.setState({
      autoUpdateEnabled: true,
      errorMessage: null,
      initialized: true,
      status: "available",
      updateSummary: {
        currentVersion: "0.1.8",
        downloadUrl: "https://example.com/ainovelstudio_0.1.8_windows_x64.exe",
        notes: "修复若干问题",
        packageKind: "exe",
        publishedAt: "2026-04-21T00:00:00Z",
        version: "0.1.8",
      },
    });

    await useUpdateStore.getState().downloadAvailableUpdate();

    expect(openExternalUpdateUrlMock).toHaveBeenCalledWith(
      "https://example.com/ainovelstudio_0.1.8_windows_x64.exe",
    );
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("启动时静默检查更新并保留可用版本", async () => {
    fetchLatestDirectUpdateMock.mockResolvedValue({
      downloadUrl: "https://example.com/ainovelstudio_0.1.9_windows_x64.exe",
      notes: "修复若干问题",
      packageKind: "exe",
      publishedAt: "2026-04-21T00:00:00Z",
      version: "0.1.9",
    });

    await useUpdateStore.getState().runStartupUpdateFlow();

    expect(fetchLatestDirectUpdateMock).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().status).toBe("available");
    expect(useUpdateStore.getState().updateSummary?.version).toBe("0.1.9");
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
