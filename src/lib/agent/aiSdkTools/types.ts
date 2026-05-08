import type { ToolSet } from "ai";
import type { AgentTool, ToolResult } from "../runtime";
import type { AskToolAnswer, AskUserRequest } from "../types";

export type ToolBuilder = (toolName: string, tool: AgentTool) => ToolSet[string];

export type ToolExecutionOptions = {
  toolCallId?: string;
};

export type ToolRequestStateChangeHandler = (event: {
  requestId: string;
  status: "start" | "finish";
}) => void;

export type InteractiveToolHandlers = {
  askUser?: (toolCallId: string | undefined, request: AskUserRequest) => Promise<AskToolAnswer>;
};

export type ToolRunner = (
  toolName: string,
  tool: AgentTool,
  input: Record<string, unknown>,
  options?: ToolExecutionOptions,
) => Promise<ToolResult>;
