import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type AppUpdateHandle = Update;
export type AppUpdateProgressEvent = DownloadEvent;

export function checkForAppUpdate() {
  return check();
}

export function relaunchToApplyUpdate() {
  return relaunch();
}
