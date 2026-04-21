import { invoke } from "@tauri-apps/api/core";
import type { LatestReleaseInfo } from "./types";

export function fetchLatestReleaseInfo() {
  return invoke<LatestReleaseInfo>("fetch_latest_release_info");
}
