import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { AgentTool as WorkspaceTool } from "../session/runtime";
import { createAskUserTool, type AskUserHandler } from "./askUserTool";
import { createPiTool } from "./tool-bridge/builder";
import { ALL_TOOL_SPECS } from "./tool-bridge/schemas";
import type { PiToolInteractive, PiToolRunnerContext } from "./tool-bridge/types";

export type BuildPiToolsParams = {
  workspaceTools: Record<string, WorkspaceTool>;
  enabledToolIds: string[];
  abortSignal?: AbortSignal;
  onToolRequestStateChange?: (event: { requestId: string; status: "start" | "finish" }) => void;
  onAskUser?: AskUserHandler;
};

/**
 * 组装当前启用的 pi AgentTool 列表（取代 buildAiSdkTools 的 ToolSet）。
 * - ask_user 用专用 createAskUserTool（需要 onUpdate 上报 awaiting 态 + 完整 ask 详情）。
 * - 其余工具用 createPiTool 包装对应的 schema-less 工作区工具。
 */
export function buildPiTools(params: BuildPiToolsParams): AgentTool<TSchema>[] {
  const interactive: PiToolInteractive | undefined = params.onAskUser
    ? { askUser: (toolCallId, request) => params.onAskUser!({ request, toolCallId: toolCallId ?? "" }) }
    : undefined;

  const context: PiToolRunnerContext = {
    abortSignal: params.abortSignal,
    interactive,
    onToolRequestStateChange: params.onToolRequestStateChange,
  };

  const tools: AgentTool<TSchema>[] = [];

  for (const toolId of params.enabledToolIds) {
    if (toolId === "ask_user") {
      tools.push(createAskUserTool(params.onAskUser));
      continue;
    }

    const workspaceTool = params.workspaceTools[toolId];
    const spec = ALL_TOOL_SPECS[toolId];
    if (workspaceTool && spec) {
      tools.push(
        createPiTool({
          toolId,
          spec,
          workspaceTool,
          context,
          // pi AgentTool.label 仅用于 UI，直接用 id；真正的中文名由 prompt 层 ALL_TOOL_DEFS 提供。
          label: toolId,
        }),
      );
    }
  }

  return tools;
}
