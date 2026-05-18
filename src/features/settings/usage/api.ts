import { invoke } from "@tauri-apps/api/core";
import type { UsageLogEntry } from "./types";

export function readUsageLogs() {
  return invoke<UsageLogEntry[]>("read_usage_logs");
}
