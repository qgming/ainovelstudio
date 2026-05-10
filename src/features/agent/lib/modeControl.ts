import type { AgentPart } from "./types";

export const MODE_CONTROL_TOOL_ID = "mode_control";
export const MODE_CONTROL_KIND = "mode-control";
export const MODE_CONTROL_DEFAULT_MODE = "autopilot";
export const MODE_CONTROL_COMPLETE_ACTION = "complete";

export type ModeControlAction =
  | "complete"
  | "blocked"
  | "continue"
  | "complete_stage"
  | "complete_workflow";

export type ModeControlData = {
  kind: typeof MODE_CONTROL_KIND;
  mode: string;
  action: ModeControlAction;
  reason?: string;
  nextAction?: string;
  workflow?: unknown;
  createdAt: string;
};

export function createModeControlData(input: {
  action: ModeControlAction;
  mode: string;
  nextAction?: string;
  reason?: string;
  workflow?: unknown;
}): ModeControlData {
  return {
    kind: MODE_CONTROL_KIND,
    mode: input.mode,
    action: input.action,
    reason: input.reason,
    nextAction: input.nextAction,
    workflow: input.workflow,
    createdAt: new Date().toISOString(),
  };
}

export function isModeControlCompletionOutput(output: unknown, mode: string) {
  if (!isRecord(output)) return false;
  return output.kind === MODE_CONTROL_KIND
    && output.mode === mode
    && output.action === MODE_CONTROL_COMPLETE_ACTION;
}

export function isModeControlCompletionPart(part: AgentPart, mode: string) {
  if (part.type !== "tool-call" && part.type !== "tool-result") return false;
  return part.toolName === MODE_CONTROL_TOOL_ID
    && part.status === "completed"
    && isModeControlCompletionOutput(part.output, mode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isModeControlData(value: unknown): value is ModeControlData {
  if (!isRecord(value)) return false;
  return value.kind === MODE_CONTROL_KIND
    && typeof value.mode === "string"
    && typeof value.action === "string"
    && typeof value.createdAt === "string";
}
