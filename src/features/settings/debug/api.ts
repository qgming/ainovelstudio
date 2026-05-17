import { invoke } from "@tauri-apps/api/core";
import type { AiCallLogEntry } from "./types";

export function readAiCallLogs() {
  return invoke<AiCallLogEntry[]>("read_ai_call_logs");
}

export function clearAiCallLogs() {
  return invoke<void>("clear_ai_call_logs");
}
