import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AboutSection } from "./AboutSection";

const updateStoreState = {
  autoUpdateEnabled: true,
  checkForUpdates: vi.fn(),
  initializePreferences: vi.fn(),
  installDownloadedUpdate: vi.fn(),
  pendingInstallVersion: null as string | null,
  progress: null as number | null,
  setAutoUpdateEnabled: vi.fn(),
  status: "idle" as "idle" | "checking" | "downloading" | "downloaded" | "installing" | "latest" | "error",
  updateSummary: null as { version: string } | null,
};

vi.mock("../../stores/updateStore", () => ({
  useUpdateStore: <T,>(selector: (state: typeof updateStoreState) => T) => selector(updateStoreState),
}));

describe("AboutSection", () => {
  beforeEach(() => {
    updateStoreState.autoUpdateEnabled = true;
    updateStoreState.pendingInstallVersion = null;
    updateStoreState.progress = null;
    updateStoreState.status = "idle";
    updateStoreState.updateSummary = null;
    updateStoreState.checkForUpdates.mockReset();
    updateStoreState.initializePreferences.mockReset();
    updateStoreState.installDownloadedUpdate.mockReset();
    updateStoreState.setAutoUpdateEnabled.mockReset();
  });

  it("展示版本信息、自动更新开关和联系入口", () => {
    render(<AboutSection />);

    expect(screen.getByRole("heading", { name: "神笔写作" })).toBeInTheDocument();
    expect(screen.getByText("0.1.6")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "自动更新" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("link", { name: "打开官网" })).toHaveAttribute("href", "https://www.qgming.com");
    expect(screen.getByRole("link", { name: "查看 GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/qgming/ainovelstudio",
    );
  });

  it("点击检查更新会触发更新检查", () => {
    render(<AboutSection />);

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(updateStoreState.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("检测到已下载更新时按钮会切换为立即安装", () => {
    updateStoreState.status = "downloaded";
    updateStoreState.pendingInstallVersion = "0.1.6";
    updateStoreState.updateSummary = { version: "0.1.6" };

    render(<AboutSection />);

    expect(screen.getByRole("button", { name: "立即安装" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "立即安装" }));

    expect(updateStoreState.installDownloadedUpdate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已下载 0.1.6，下次打开应用时会继续安装。")).toBeInTheDocument();
  });

  it("切换自动更新时会写入新的开关状态", () => {
    render(<AboutSection />);

    fireEvent.click(screen.getByRole("switch", { name: "自动更新" }));

    expect(updateStoreState.setAutoUpdateEnabled).toHaveBeenCalledWith(false);
  });
});
