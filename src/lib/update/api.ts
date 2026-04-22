import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { UpdatePackageKind } from "./types";

export type DirectUpdateTarget = "windows-x64" | "android-arm64";
export type DirectUpdateRelease = {
  version: string;
  notes: string;
  publishedAt: string | null;
  downloadUrl: string;
  packageKind: UpdatePackageKind;
};

const GITHUB_OWNER = "qgming";
const GITHUB_REPO = "ainovelstudio";
const GITHUB_LATEST_RELEASE_API =
  `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const DIRECT_PACKAGE_METADATA: Record<
  DirectUpdateTarget,
  { fileName: (version: string) => string; packageKind: UpdatePackageKind }
> = {
  "android-arm64": {
    fileName: (version) => `ainovelstudio_${version}_android_arm64.apk`,
    packageKind: "apk",
  },
  "windows-x64": {
    fileName: (version) => `ainovelstudio_${version}_windows_x64.exe`,
    packageKind: "exe",
  },
};

type GitHubLatestReleaseResponse = {
  tag_name?: string;
  body?: string | null;
  published_at?: string | null;
};

function normalizeReleaseVersion(tagName: string) {
  return tagName.trim().replace(/^v/i, "");
}

function buildDirectDownloadUrl(version: string, target: DirectUpdateTarget) {
  const releaseTag = `v${version}`;
  const fileName = DIRECT_PACKAGE_METADATA[target].fileName(version);
  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${releaseTag}/${fileName}`;
}

export async function fetchLatestDirectUpdate(target: DirectUpdateTarget): Promise<DirectUpdateRelease> {
  const response = await fetch(GITHUB_LATEST_RELEASE_API, {
    headers: {
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    throw new Error(`读取最新版本失败（${response.status}）。`);
  }

  const release = (await response.json()) as GitHubLatestReleaseResponse;
  const version = normalizeReleaseVersion(release.tag_name ?? "");
  if (!version) {
    throw new Error("最新版本信息缺少版本号。");
  }

  return {
    version,
    notes: release.body?.trim() ?? "",
    publishedAt: release.published_at ?? null,
    downloadUrl: buildDirectDownloadUrl(version, target),
    packageKind: DIRECT_PACKAGE_METADATA[target].packageKind,
  };
}

export async function openExternalUpdateUrl(url: string) {
  if (isTauri()) {
    await openUrl(url);
    return;
  }

  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
