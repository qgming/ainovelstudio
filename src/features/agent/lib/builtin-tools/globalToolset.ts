import type { AgentTool } from "../session/runtime";
import { createControlTools } from "./controlToolset";
import { createFanqieLeaderboardTools } from "./fanqieLeaderboardToolset";
import { createWebFetchTools } from "./webFetchToolset";
import { createWebSearchTools } from "./webSearchToolset";

export function createGlobalToolset(): Record<string, AgentTool> {
  return {
    ...createControlTools(),
    ...createFanqieLeaderboardTools(),
    ...createWebFetchTools(),
    ...createWebSearchTools(),
  };
}
