import type { AgentTool } from "../runtime";
import { createWorkspaceWordCountTools } from "./workspaceWordCountToolset";
import { createWorkspaceStructureTools } from "./workspaceStructureToolset";
import { createWorkspaceTextTools } from "./workspaceTextToolset";
import type { WorkspaceToolContext } from "./shared";

export function createWorkspaceToolset(
  context: WorkspaceToolContext,
): Record<string, AgentTool> {
  return {
    ...createWorkspaceStructureTools(context),
    ...createWorkspaceTextTools(context),
    ...createWorkspaceWordCountTools(context),
  };
}
