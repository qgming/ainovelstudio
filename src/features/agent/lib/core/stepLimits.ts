import type { AgentMode } from "../modeRules";

export const COLLAB_AGENT_STEP_LIMIT = 100;
export const INFINITE_AGENT_STEP_LIMIT = null;

export function resolveAgentStepLimit(mode: AgentMode | undefined): number | null {
  if (mode === "autopilot" || mode === "flow") return INFINITE_AGENT_STEP_LIMIT;
  return COLLAB_AGENT_STEP_LIMIT;
}
