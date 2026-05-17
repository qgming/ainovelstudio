import type { AgentTool } from "../runtime";
import type { WorkflowState } from "../workflowControl";
import { createControlTools } from "./controlToolset";
import { createFanqieLeaderboardTools } from "./fanqieLeaderboardToolset";
import { createWebFetchTools } from "./webFetchToolset";
import { createWebSearchTools } from "./webSearchToolset";

export function createGlobalToolset(options?: {
  workflowState?: WorkflowState;
}): Record<string, AgentTool> {
  return {
    ...createControlTools({ workflowState: options?.workflowState }),
    ...createFanqieLeaderboardTools(),
    ...createWebFetchTools(),
    ...createWebSearchTools(),
  };
}
