import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLatestDirectUpdate } from "./updateApi";

const { invokeMock, isTauriMock, openUrlMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  isTauriMock: vi.fn(() => true),
  openUrlMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

describe("updateApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(true);
    openUrlMock.mockReset();
  });

  it("通过 Tauri 后端读取自建 app.json 的 Windows 下载地址", async () => {
    invokeMock.mockResolvedValue(JSON.stringify({
      version: "0.2.8",
      notes: "修复若干问题",
      publishedAt: "2026-05-12",
      downloads: {
        "windows-x64": {
          packageKind: "exe",
          url: "https://github.com/qgming/ainovelstudio/releases/download/v0.2.8/ainovelstudio_0.2.8_windows_x64.exe",
        },
      },
    }));

    await expect(fetchLatestDirectUpdate("windows-x64")).resolves.toEqual({
      downloadUrl: "https://github.com/qgming/ainovelstudio/releases/download/v0.2.8/ainovelstudio_0.2.8_windows_x64.exe",
      notes: "修复若干问题",
      packageKind: "exe",
      publishedAt: "2026-05-12",
      version: "0.2.8",
    });
    expect(invokeMock).toHaveBeenCalledWith("fetch_update_manifest");
  });

  it("从自建 app.json 读取 Android 下载地址", async () => {
    invokeMock.mockResolvedValue(JSON.stringify({
      version: "v0.2.8",
      notes: "",
      publishedAt: "2026-05-12",
      downloads: {
        "android-arm64": {
          packageKind: "apk",
          url: "https://github.com/qgming/ainovelstudio/releases/download/v0.2.8/ainovelstudio_0.2.8_android_arm64.apk",
        },
      },
    }));

    await expect(fetchLatestDirectUpdate("android-arm64")).resolves.toMatchObject({
      downloadUrl: "https://github.com/qgming/ainovelstudio/releases/download/v0.2.8/ainovelstudio_0.2.8_android_arm64.apk",
      packageKind: "apk",
      version: "0.2.8",
    });
  });

  it("当前平台没有下载地址时抛出清晰错误", async () => {
    invokeMock.mockResolvedValue(JSON.stringify({
      version: "0.2.8",
      downloads: {},
    }));

    await expect(fetchLatestDirectUpdate("windows-x64")).rejects.toThrow(
      "最新版本信息缺少当前平台下载地址。",
    );
  });

  it("非 Tauri 环境回退到浏览器 fetch", async () => {
    isTauriMock.mockReturnValue(false);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      text: async () => JSON.stringify({
        version: "0.2.8",
        downloads: {
          "windows-x64": "https://github.com/qgming/ainovelstudio/releases/download/v0.2.8/ainovelstudio_0.2.8_windows_x64.exe",
        },
      }),
      ok: true,
    } as Response);

    await expect(fetchLatestDirectUpdate("windows-x64")).resolves.toMatchObject({
      downloadUrl: "https://github.com/qgming/ainovelstudio/releases/download/v0.2.8/ainovelstudio_0.2.8_windows_x64.exe",
      version: "0.2.8",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://pages.qgming.com/shenbi/app.json", {
      headers: {
        Accept: "application/json",
      },
    });
  });
});
