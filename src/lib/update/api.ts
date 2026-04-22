import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { UpdatePackageKind } from "./types";

export type AppUpdateHandle = Update;
export type AppUpdateProgressEvent = DownloadEvent;
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
const DIRECT_DOWNLOAD_URLS: Record<DirectUpdateTarget, string> = {
  "android-arm64":
    `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/ainovelstudio_android_arm64.apk`,
  "windows-x64":
    `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest/download/ainovelstudio_windows_x64.exe`,
};

type GitHubLatestReleaseResponse = {
  tag_name?: string;
  body?: string | null;
  published_at?: string | null;
};

function normalizeReleaseVersion(tagName: string) {
  return tagName.trim().replace(/^v/i, "");
}

export function checkForAppUpdate() {
  return check();
}

export function relaunchToApplyUpdate() {
  return relaunch();
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
    downloadUrl: DIRECT_DOWNLOAD_URLS[target],
    packageKind: target === "android-arm64" ? "apk" : "exe",
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
