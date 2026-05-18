import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataManagementSection } from "./DataManagementSection";
import { useDataManagementStore } from "@features/settings/stores/useDataManagementStore";

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

const { applyAppClientStateAndReloadMock } = vi.hoisted(() => ({
  applyAppClientStateAndReloadMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("@features/settings/data-sync/clientState", () => ({
  applyAppClientStateAndReload: applyAppClientStateAndReloadMock,
}));

vi.mock("@shared/hooks/useMobile", () => ({
  useIsMobile: () => false,
}));

describe("DataManagementSection", () => {
  const downloadCloudBackupMock = vi.fn();
  const initializeMock = vi.fn();
  const uploadCloudBackupMock = vi.fn();

  beforeEach(() => {
    downloadCloudBackupMock.mockReset();
    downloadCloudBackupMock.mockResolvedValue({
      clientState: { entries: {}, updatedAt: 123 },
      restoredAt: 123,
    });
    initializeMock.mockReset();
    initializeMock.mockResolvedValue(undefined);
    uploadCloudBackupMock.mockReset();
    uploadCloudBackupMock.mockResolvedValue({
      localUpdatedAt: 123,
      remoteUpdatedAt: 120,
    });
    toastMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    applyAppClientStateAndReloadMock.mockReset();

    useDataManagementStore.setState({
      config: {
        enabled: false,
        password: "",
        remotePath: "ainovelstudio",
        serverUrl: "",
        username: "",
      },
      downloadCloudBackup: downloadCloudBackupMock,
      errorMessage: null,
      exportBackup: vi.fn(),
      importBackup: vi.fn(),
      initialize: initializeMock,
      saveConfig: vi.fn(),
      status: "ready",
      uploadCloudBackup: uploadCloudBackupMock,
    });
  });

  it("只展示云备份和本地备份卡片", () => {
    render(<DataManagementSection />);

    expect(screen.getByText("云备份")).toBeInTheDocument();
    expect(screen.getByText("本地备份")).toBeInTheDocument();
    expect(screen.queryByText("初始化")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重写技能" })).not.toBeInTheDocument();
  });

  it("展示上传和下载云备份按钮", () => {
    useDataManagementStore.setState((state) => ({
      ...state,
      config: {
        ...state.config,
        serverUrl: "https://dav.example.com",
      },
    }));

    render(<DataManagementSection />);

    expect(screen.getByText("云备份")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传云备份" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载云备份" })).toBeInTheDocument();
  });

  it("确认后会下载云备份并提示刷新", async () => {
    useDataManagementStore.setState((state) => ({
      ...state,
      config: {
        ...state.config,
        serverUrl: "https://dav.example.com",
      },
    }));

    render(<DataManagementSection />);

    fireEvent.click(screen.getByRole("button", { name: "下载云备份" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("下载后会用云端备份覆盖当前本地数据，包括模型配置与页面偏好，并在完成后刷新应用。请确认本地数据已经完成备份。")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "覆盖并下载" }));

    await waitFor(() => {
      expect(downloadCloudBackupMock).toHaveBeenCalledTimes(1);
      expect(toastMock.success).toHaveBeenCalledWith("云备份已下载", {
        description: "应用将刷新为云端备份内容，模型配置也会一并恢复。",
      });
      expect(applyAppClientStateAndReloadMock).toHaveBeenCalledWith({ entries: {}, updatedAt: 123 });
    });
  });

});
