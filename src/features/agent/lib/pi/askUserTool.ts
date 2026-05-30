import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import { withAbort } from "../asyncUtils";
import { normalizeAskAnswer, normalizeAskRequest, summarizeAskAnswer } from "../tools/resourceToolset";
import type { AskToolAnswer, AskUserRequest } from "../types";
import { INTERACTION_TOOL_SPECS } from "./tools/schemas";
import type { AskUserToolDetails } from "./eventAdapter";

// 通过 declaration merging 给 pi 扩展自定义消息类型：ask_user 交互留痕（仅 UI/审计，convertToLlm 会过滤）。
declare module "@earendil-works/pi-agent-core" {
  interface CustomAgentMessages {
    askUser: {
      role: "askUser";
      toolCallId: string;
      request: AskUserRequest;
      answer?: AskToolAnswer;
      timestamp: number;
    };
  }
}

export type AskUserHandler = (event: {
  request: AskUserRequest;
  toolCallId: string;
}) => Promise<AskToolAnswer>;

const askParameters = INTERACTION_TOOL_SPECS.ask_user.parameters as TSchema;

/**
 * ask_user 的 pi 原生实现。与普通工作区工具不同，它需要把"等待用户"中间态和最终答案
 * 都以完整的 ask 详情（request + status + answer）形式暴露，供 eventAdapter 构造 ask-user part。
 *
 * - 起始：tool_execution_start.args 已含 title/selectionMode/options（eventAdapter 据此先出 awaiting 卡片）。
 * - 等待：onUpdate 上报 { details: {...request, status:"awaiting_user"} }（兜底刷新 awaiting 态）。
 * - 完成：返回 AgentToolResult.details = {...request, answer, status:"completed"}，content 为答案文本（进 LLM）。
 * 失败：throw（pi 工具契约），由上层标记 failed。
 */
export function createAskUserTool(onAskUser: AskUserHandler | undefined): AgentTool<TSchema, AskUserToolDetails> {
  return {
    name: "ask_user",
    label: "向用户提问",
    description: INTERACTION_TOOL_SPECS.ask_user.description,
    parameters: askParameters,
    async execute(toolCallId, params, signal, onUpdate): Promise<AgentToolResult<AskUserToolDetails>> {
      if (!onAskUser) {
        throw new Error("当前运行环境不支持 ask_user 交互。");
      }
      if (!toolCallId?.trim()) {
        throw new Error("ask_user 工具缺少 toolCallId，无法建立交互。");
      }

      // 规范化请求（补"用户输入"自定义选项、校验单/多选约束）。
      const request = normalizeAskRequest(params as Record<string, unknown>);

      // 上报等待态，供 UI 兜底刷新 awaiting 卡片。
      onUpdate?.({ content: [], details: { ...request, status: "awaiting_user" } });

      const answer = normalizeAskAnswer(
        await withAbort(signal, () => onAskUser({ request, toolCallId })),
      );

      return {
        content: [{ type: "text", text: `已收到用户回答：${summarizeAskAnswer(answer)}` }],
        details: { ...request, answer, status: "completed" },
      };
    },
  };
}

export type { Static };
