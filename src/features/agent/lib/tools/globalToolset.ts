import type { AgentTool } from "../runtime";
import type { FlowWorkflowState } from "../workflowControl";
import { createFanqieLeaderboardTools } from "./fanqieLeaderboardToolset";
import { createModeControlTools } from "./modeControlToolset";
import { createWebFetchTools } from "./webFetchToolset";
import { createWebSearchTools } from "./webSearchToolset";

export function createGlobalToolset(options?: {
  flowWorkflowState?: FlowWorkflowState;
}): Record<string, AgentTool> {
  return {
    ...createModeControlTools({ flowWorkflowState: options?.flowWorkflowState }),
    ...createFanqieLeaderboardTools(),
    ...createWebFetchTools(),
    ...createWebSearchTools(),
  };
}
