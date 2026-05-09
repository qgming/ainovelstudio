import type { AgentTool } from "../runtime";
import { createFanqieLeaderboardTools } from "./fanqieLeaderboardToolset";
import { createWebFetchTools } from "./webFetchToolset";
import { createWebSearchTools } from "./webSearchToolset";

export function createGlobalToolset(): Record<string, AgentTool> {
  return {
    ...createFanqieLeaderboardTools(),
    ...createWebFetchTools(),
    ...createWebSearchTools(),
  };
}
