import type { AskToolAnswer, AskUserRequest } from "./types";

export type ToolResult = {
  ok: boolean;
  summary: string;
  data?: unknown;
};

export type AgentToolInteractiveContext = {
  askUser?: (request: AskUserRequest) => Promise<AskToolAnswer>;
};

export type AgentToolExecutionContext = {
  abortSignal?: AbortSignal;
  requestId?: string;
  toolCallId?: string;
  interactive?: AgentToolInteractiveContext;
};

export type AgentTool = {
  description: string;
  execute: (input: Record<string, unknown>, context?: AgentToolExecutionContext) => Promise<ToolResult>;
};

export type AgentRuntimeConfig = {
  tools: Record<string, AgentTool>;
};

export function createAgentRuntime(config: AgentRuntimeConfig) {
  return {
    async runTool(toolName: string, input: Record<string, unknown>, context?: AgentToolExecutionContext) {
      const tool = config.tools[toolName];
      if (!tool) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      return tool.execute(input, context);
    },
  };
}
