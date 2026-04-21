import { describe, expect, it } from "vitest";
import { compareVersions, getPreferredReleaseAsset, normalizeVersionLabel } from "./version";

describe("update version helpers", () => {
  it("支持比较带 v 前缀的版本号", () => {
    expect(compareVersions("v0.1.6", "0.1.5")).toBe(1);
    expect(compareVersions("0.1.5", "v0.1.5")).toBe(0);
    expect(compareVersions("0.1.4", "0.1.5")).toBe(-1);
  });

  it("会去掉版本号前缀", () => {
    expect(normalizeVersionLabel("v0.1.6")).toBe("0.1.6");
  });

  it("桌面端优先选择 exe 安装包", () => {
    const asset = getPreferredReleaseAsset(
      {
        assets: [
          { contentType: "", downloadUrl: "https://example.com/app.apk", name: "app.apk", size: 1 },
          { contentType: "", downloadUrl: "https://example.com/app-setup.exe", name: "app-setup.exe", size: 2 },
        ],
        body: "",
        draft: false,
        htmlUrl: "https://github.com/qgming/ainovelstudio/releases/tag/v0.1.6",
        name: "v0.1.6",
        prerelease: false,
        publishedAt: "2026-04-21T00:00:00Z",
        tagName: "v0.1.6",
      },
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );

    expect(asset?.name).toBe("app-setup.exe");
  });

  it("Android 优先选择 apk 安装包", () => {
    const asset = getPreferredReleaseAsset(
      {
        assets: [
          { contentType: "", downloadUrl: "https://example.com/app-setup.exe", name: "app-setup.exe", size: 2 },
          { contentType: "", downloadUrl: "https://example.com/app.apk", name: "app.apk", size: 1 },
        ],
        body: "",
        draft: false,
        htmlUrl: "https://github.com/qgming/ainovelstudio/releases/tag/v0.1.6",
        name: "v0.1.6",
        prerelease: false,
        publishedAt: "2026-04-21T00:00:00Z",
        tagName: "v0.1.6",
      },
      "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
    );

    expect(asset?.name).toBe("app.apk");
  });
});
