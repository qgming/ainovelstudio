import { invoke } from "@tauri-apps/api/core";
import type { UsageDailyStat, UsageLogEntry, UsageSummary } from "./types";

export function readUsageLogs() {
  return invoke<UsageLogEntry[]>("read_usage_logs");
}

export function readUsageSummary() {
  return invoke<UsageSummary>("read_usage_summary");
}

export function readUsageDailyStats() {
  return invoke<UsageDailyStat[]>("read_usage_daily_stats");
}
