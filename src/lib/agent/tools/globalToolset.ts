import type { AgentTool } from "../runtime";
import { createWebFetchTools } from "./webFetchToolset";
import { createWebSearchTools } from "./webSearchToolset";

export function createGlobalToolset(): Record<string, AgentTool> {
  return {
    ...createWebFetchTools(),
    ...createWebSearchTools(),
  };
}
