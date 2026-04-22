import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AboutSection } from "./AboutSection";

const { toastMock } = vi.hoisted(() => ({
  toastMock: vi.fn(),
}));

const updateStoreState = {
  autoUpdateEnabled: true,
  checkForUpdates: vi.fn(),
  downloadAvailableUpdate: vi.fn(),
  errorMessage: null as string | null,
  initializePreferences: vi.fn(),
  setAutoUpdateEnabled: vi.fn(),
  status: "idle" as "idle" | "available" | "checking" | "latest" | "error",
  updateSummary: null as {
    version: string;
    notes?: string;
    packageKind?: "exe" | "apk" | null;
    publishedAt?: string | null;
  } | null,
};

vi.mock("../../stores/updateStore", () => ({
  useUpdateStore: <T,>(selector: (state: typeof updateStoreState) => T) => selector(updateStoreState),
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

describe("AboutSection", () => {
  beforeEach(() => {
    updateStoreState.autoUpdateEnabled = true;
    updateStoreState.errorMessage = null;
    updateStoreState.status = "idle";
    updateStoreState.updateSummary = null;
    updateStoreState.checkForUpdates.mockReset();
    updateStoreState.downloadAvailableUpdate.mockReset();
    updateStoreState.initializePreferences.mockReset();
    updateStoreState.setAutoUpdateEnabled.mockReset();
    toastMock.mockReset();
  });

  it("展示版本信息、自动更新开关和联系入口", () => {
    render(<AboutSection />);

    expect(screen.getByRole("heading", { name: "神笔写作" })).toBeInTheDocument();
    expect(screen.getByText("0.1.8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "自动更新" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("link", { name: "打开官网" })).toHaveAttribute("href", "https://www.qgming.com");
    expect(screen.getByRole("link", { name: "查看 GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/qgming/ainovelstudio",
    );
    expect(screen.queryByText("桌面端会自动下载并安装对应的 EXE，移动端会打开对应的 APK 下载链接。")).not.toBeInTheDocument();
  });

  it("点击检查更新会触发更新检查", () => {
    render(<AboutSection />);

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(updateStoreState.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("检测到新版本后会直接展示更新日志弹窗", () => {
    updateStoreState.status = "available";
    updateStoreState.updateSummary = { version: "0.1.8" };

    render(<AboutSection />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("发现 0.1.8")).toBeInTheDocument();
  });

  it("有更新时会弹出更新日志对话框，并通过按钮触发下载", () => {
    updateStoreState.status = "available";
    updateStoreState.updateSummary = {
      version: "0.1.9",
      notes: "修复更新流程\n补齐工作流统计",
      packageKind: "exe",
      publishedAt: "2026-04-22T06:30:00Z",
    };

    render(<AboutSection />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("发现 0.1.9")).toBeInTheDocument();
    expect(screen.getByText(/修复更新流程[\s\S]*补齐工作流统计/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下载更新" }));

    expect(updateStoreState.downloadAvailableUpdate).toHaveBeenCalledTimes(1);
  });

  it("切换自动更新时会写入新的开关状态", () => {
    render(<AboutSection />);

    fireEvent.click(screen.getByRole("switch", { name: "自动更新" }));

    expect(updateStoreState.setAutoUpdateEnabled).toHaveBeenCalledWith(false);
  });
});
