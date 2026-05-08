import type { ToolSet } from "ai";
import type { AgentTool } from "./runtime";
import { createDataToolBuilders } from "./aiSdkTools/dataBuilders";
import { createInteractionToolBuilders } from "./aiSdkTools/interactionBuilders";
import { createReadToolBuilders } from "./aiSdkTools/readBuilders";
import { createToolRunner } from "./aiSdkTools/runner";
import type { InteractiveToolHandlers, ToolBuilder, ToolRequestStateChangeHandler } from "./aiSdkTools/types";
import { createWriteToolBuilders } from "./aiSdkTools/writeBuilders";

export function buildAiSdkTools(
  workspaceTools: Record<string, AgentTool>,
  enabledToolIds: string[],
  abortSignal?: AbortSignal,
  onToolRequestStateChange?: ToolRequestStateChangeHandler,
  interactive?: InteractiveToolHandlers,
): ToolSet {
  const toolSet: ToolSet = {};
  const runTool = createToolRunner({ abortSignal, interactive, onToolRequestStateChange });
  const builders: Record<string, ToolBuilder> = {
    ...createInteractionToolBuilders(runTool),
    ...createReadToolBuilders(runTool),
    ...createWriteToolBuilders(runTool),
    ...createDataToolBuilders(runTool),
  };

  for (const toolId of enabledToolIds) {
    const workspaceTool = workspaceTools[toolId];
    const buildTool = builders[toolId];
    if (workspaceTool && buildTool) toolSet[toolId] = buildTool(toolId, workspaceTool);
  }

  return toolSet;
}
