import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { UpdatePackageKind } from "../types";

export type DirectUpdateTarget = "windows-x64" | "android-arm64";
export type DirectUpdateRelease = {
  version: string;
  notes: string;
  publishedAt: string | null;
  downloadUrl: string;
  packageKind: UpdatePackageKind;
};

const UPDATE_MANIFEST_URL = "https://pages.qgming.com/shenbi/app.json";
const DIRECT_PACKAGE_METADATA: Record<
  DirectUpdateTarget,
  { packageKind: UpdatePackageKind; tauriPlatform: string }
> = {
  "android-arm64": {
    packageKind: "apk",
    tauriPlatform: "android-aarch64",
  },
  "windows-x64": {
    packageKind: "exe",
    tauriPlatform: "windows-x86_64",
  },
};

type UpdateManifestDownload = {
  packageKind?: UpdatePackageKind | null;
  url?: string | null;
};

type UpdateManifest = {
  version?: string;
  notes?: string | null;
  publishedAt?: string | null;
  pub_date?: string | null;
  downloadUrl?: string | null;
  downloads?: Partial<Record<DirectUpdateTarget, UpdateManifestDownload | string>>;
  platforms?: Record<string, UpdateManifestDownload | string | undefined>;
  tauri?: {
    platforms?: Record<string, UpdateManifestDownload | string | undefined>;
  };
};

function normalizeReleaseVersion(tagName: string) {
  return tagName.trim().replace(/^v/i, "");
}

function resolveDownloadUrl(manifest: UpdateManifest, target: DirectUpdateTarget) {
  const directDownload = manifest.downloads?.[target];
  if (typeof directDownload === "string") {
    return directDownload.trim();
  }
  if (directDownload?.url) {
    return directDownload.url.trim();
  }

  const platformKey = DIRECT_PACKAGE_METADATA[target].tauriPlatform;
  const platformDownload =
    manifest.platforms?.[platformKey] ?? manifest.tauri?.platforms?.[platformKey];
  if (typeof platformDownload === "string") {
    return platformDownload.trim();
  }
  if (platformDownload?.url) {
    return platformDownload.url.trim();
  }

  return manifest.downloadUrl?.trim() ?? "";
}

function resolvePackageKind(manifest: UpdateManifest, target: DirectUpdateTarget) {
  const packageKind = manifest.downloads?.[target];
  if (typeof packageKind !== "string" && packageKind?.packageKind) {
    return packageKind.packageKind;
  }

  return DIRECT_PACKAGE_METADATA[target].packageKind;
}

async function fetchUpdateManifestText() {
  if (isTauri()) {
    return invoke<string>("fetch_update_manifest");
  }

  const response = await fetch(UPDATE_MANIFEST_URL, {
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`读取最新版本失败（${response.status}）。`);
  }

  return response.text();
}

export async function fetchLatestDirectUpdate(target: DirectUpdateTarget): Promise<DirectUpdateRelease> {
  const manifest = JSON.parse(await fetchUpdateManifestText()) as UpdateManifest;
  const version = normalizeReleaseVersion(manifest.version ?? "");
  if (!version) {
    throw new Error("最新版本信息缺少版本号。");
  }

  const downloadUrl = resolveDownloadUrl(manifest, target);
  if (!downloadUrl) {
    throw new Error("最新版本信息缺少当前平台下载地址。");
  }

  return {
    version,
    notes: manifest.notes?.trim() ?? "",
    publishedAt: manifest.publishedAt ?? manifest.pub_date ?? null,
    downloadUrl,
    packageKind: resolvePackageKind(manifest, target),
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
