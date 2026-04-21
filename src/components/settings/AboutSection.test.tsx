import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AboutSection } from "./AboutSection";

const { fetchLatestReleaseInfoMock, openUrlMock, toastMock } = vi.hoisted(() => ({
  fetchLatestReleaseInfoMock: vi.fn(),
  openUrlMock: vi.fn(),
  toastMock: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("../../lib/update/api", () => ({
  fetchLatestReleaseInfo: fetchLatestReleaseInfoMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

vi.mock("sonner", () => ({
  toast: toastMock,
}));

vi.mock("../../hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

describe("AboutSection", () => {
  beforeEach(() => {
    fetchLatestReleaseInfoMock.mockReset();
    openUrlMock.mockReset();
    toastMock.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it("展示当前版本和检查更新按钮", () => {
    render(<AboutSection />);

    expect(screen.getByRole("heading", { name: "神笔写作" })).toBeInTheDocument();
    expect(screen.getByText("0.1.5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开官网" })).toHaveAttribute("href", "https://www.qgming.com");
    expect(screen.getByRole("link", { name: "查看 GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/qgming/ainovelstudio",
    );
  });

  it("发现新版本后展示下载和 release 入口", async () => {
    fetchLatestReleaseInfoMock.mockResolvedValue({
      assets: [
        {
          contentType: "application/octet-stream",
          downloadUrl: "https://example.com/ainovelstudio-setup.exe",
          name: "ainovelstudio-setup.exe",
          size: 123,
        },
      ],
      body: "修复若干问题",
      draft: false,
      htmlUrl: "https://github.com/qgming/ainovelstudio/releases/tag/v0.1.6",
      name: "v0.1.6",
      prerelease: false,
      publishedAt: "2026-04-21T00:00:00Z",
      tagName: "v0.1.6",
    });

    render(<AboutSection />);

    fireEvent.click(screen.getByRole("button", { name: "检查更新" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith("发现新版本", {
        description: "0.1.6 已可下载。",
      });
    });

    expect(await screen.findByRole("heading", { name: "v0.1.6" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载更新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看 Release" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下载更新" }));

    await waitFor(() => {
      expect(openUrlMock).toHaveBeenCalledWith("https://example.com/ainovelstudio-setup.exe");
    });
  });
});
