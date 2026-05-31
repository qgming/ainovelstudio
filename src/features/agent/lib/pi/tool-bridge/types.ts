import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import type { AgentTool as WorkspaceTool, AgentToolInteractiveContext } from "../../session/runtime";

// pi 工具的提示词/参数规格：description + TypeBox 参数 schema。
// 取代旧的 AgentToolPromptSpec（zod inputSchema）。
export type PiToolSpec = {
  description: string;
  parameters: TSchema;
  // 可选的入参预处理（pi 原生 prepareArguments，在 schema 校验之前运行）。
  // 用于复刻旧 zod z.preprocess 的归一化（如 update_plan 的 normalizeTodoToolInput）。
  prepareArguments?: (args: unknown) => unknown;
};

// 把工具名解析成可选执行参数（如 ask_user/yolo_control 需要 toolCallId）。
export type ResolvePiToolOptions = (toolCallId: string) => { toolCallId?: string } | undefined;

// 运行期交互句柄（ask_user 用）。
export type PiToolInteractive = {
  askUser?: (toolCallId: string | undefined, request: import("../../types").AskUserRequest) => Promise<import("../../types").AskToolAnswer>;
};

export type PiToolRunnerContext = {
  abortSignal?: AbortSignal;
  interactive?: PiToolInteractive;
  onToolRequestStateChange?: (event: { requestId: string; status: "start" | "finish" }) => void;
};

export type BuildPiToolParams = {
  toolId: string;
  spec: PiToolSpec;
  workspaceTool: WorkspaceTool;
  context: PiToolRunnerContext;
  label: string;
};

export type { AgentTool, AgentToolResult, WorkspaceTool, AgentToolInteractiveContext };
