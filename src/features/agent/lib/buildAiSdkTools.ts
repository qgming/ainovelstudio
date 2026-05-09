import type { ToolSet } from "ai";
import type { AgentTool } from "./runtime";
import { createDataToolBuilders } from "./ai-sdk-tools/dataBuilders";
import { createInteractionToolBuilders } from "./ai-sdk-tools/interactionBuilders";
import { createReadToolBuilders } from "./ai-sdk-tools/readBuilders";
import { createToolRunner } from "./ai-sdk-tools/runner";
import type { InteractiveToolHandlers, ToolBuilder, ToolRequestStateChangeHandler } from "./ai-sdk-tools/types";
import { createWriteToolBuilders } from "./ai-sdk-tools/writeBuilders";

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
