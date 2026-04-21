import { isMobileRuntime } from "../platform";
import type { LatestReleaseInfo, ReleaseAssetSummary } from "./types";

function parseVersion(input: string) {
  const normalized = input.trim().replace(/^[^\d]*/, "");
  const [major = "0", minor = "0", patch = "0"] = normalized.split(/[.-]/);
  return [major, minor, patch].map((value) => Number.parseInt(value, 10) || 0);
}

export function normalizeVersionLabel(input: string) {
  return input.trim().replace(/^v/i, "");
}

export function compareVersions(left: string, right: string) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] === rightParts[index]) {
      continue;
    }
    return leftParts[index] > rightParts[index] ? 1 : -1;
  }

  return 0;
}

function matchAsset(asset: ReleaseAssetSummary, keywords: string[], extensions: string[]) {
  const lowerName = asset.name.toLowerCase();
  return (
    keywords.some((keyword) => lowerName.includes(keyword)) &&
    extensions.some((extension) => lowerName.endsWith(extension))
  );
}

export function getPreferredReleaseAsset(release: LatestReleaseInfo, userAgent?: string) {
  if (isMobileRuntime(userAgent)) {
    return release.assets.find((asset) => asset.name.toLowerCase().endsWith(".apk")) ?? null;
  }

  const windowsAsset =
    release.assets.find((asset) => matchAsset(asset, ["setup", "installer", "nsis"], [".exe"])) ??
    release.assets.find((asset) => asset.name.toLowerCase().endsWith(".msi"));

  return windowsAsset ?? release.assets[0] ?? null;
}
