import type { AgentToolInteractiveContext } from "../runtime";
import { createToolRequestId, withAbort } from "../asyncUtils";
import type { InteractiveToolHandlers, ToolRequestStateChangeHandler, ToolRunner } from "./types";

export function createToolRunner(params: {
  abortSignal?: AbortSignal;
  interactive?: InteractiveToolHandlers;
  onToolRequestStateChange?: ToolRequestStateChangeHandler;
}): ToolRunner {
  return async (toolName, tool, input, options) => {
    const requestId = createToolRequestId(toolName);
    const interactiveContext = createInteractiveContext(params.interactive, options?.toolCallId);
    params.onToolRequestStateChange?.({ requestId, status: "start" });
    try {
      return await withAbort(params.abortSignal, () =>
        tool.execute(input, {
          abortSignal: params.abortSignal,
          requestId,
          toolCallId: options?.toolCallId,
          interactive: interactiveContext,
        }),
      );
    } finally {
      params.onToolRequestStateChange?.({ requestId, status: "finish" });
    }
  };
}

function createInteractiveContext(
  interactive: InteractiveToolHandlers | undefined,
  toolCallId: string | undefined,
): AgentToolInteractiveContext | undefined {
  return interactive?.askUser
    ? { askUser: (request) => interactive.askUser!(toolCallId, request) }
    : undefined;
}
