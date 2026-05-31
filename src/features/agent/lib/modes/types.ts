// CP-F：模式策略的单一事实源（ModeConfig）。
//
// 把原本分散在多处的模式差异收进一处定义，runner / factory / systemPrompt 都从它读：
// - 工具白名单过滤      ← 原 messageSessionFactory.getEnabledToolIds / getRequiredControlToolId
// - 步数上限           ← 原 core/stepLimits.resolveAgentStepLimit
// - 模式规则文本        ← 原 modeRules.buildModeRules
// - 循环续轮策略        ← 原 stores/chat-run/autopilot.ts（外循环整体内聚）
// - tool_call 审批策略  ← 新增，驱动 harness.on("tool_call")
//
// 续轮契约（pi 推荐方式）：runner 在 turn_end 调用 loop.decideContinuation，
// 返回 continue 时由 runner 调 harness.followUp(prompt) 在同一 prompt() 流内续轮；
// 返回 stop 时不再 followUp，pi loop 自然走向 agent_end。

import type { AgentMode, ModeContextMap } from "../modeRules";
import type { AgentPart } from "../types";

/** turn_end 时供 decideContinuation 判定的输入。 */
export type ContinuationInput<M extends AgentMode = AgentMode> = {
  /** 已完成的 turn 数（含本轮），从 1 起。 */
  turnCount: number;
  /** 本模式的步数上限；null 表示不限。 */
  stepLimit: number | null;
  /** 本轮 turn_end 的 finishReason（pi stopReason 映射后）。 */
  finishReason?: string;
  /** 本轮累积的 AgentPart（含 text/reasoning/tool-call/tool-result）。 */
  turnParts: readonly AgentPart[];
  /** 模式专属上下文（autopilot 含 goal/iteration）。 */
  modeContext: ModeContextMap[M] | undefined;
  /** 本次 run 启用的工具 id。 */
  enabledToolIds: readonly string[];
  /** 触发本次 run 的用户 prompt。 */
  userPrompt: string;
  /** 已注入的协议修复次数（writeProtocolRepair 单次约束用）。 */
  repairCount: number;
};

/** decideContinuation 的判定结果。 */
export type ContinuationDecision = {
  kind: "stop" | "continue";
  /** continue 时注入 harness.followUp 的文本。 */
  followUpPrompt?: string;
  /** 判定理由，便于调试/日志。 */
  reason?:
    | "goal_completed"
    | "blocked"
    | "step_limit"
    | "yolo_continue"
    | "write_repair";
};

/** tool_call 审批输入。 */
export type ToolApprovalInput<M extends AgentMode = AgentMode> = {
  toolName: string;
  input: Record<string, unknown>;
  modeContext: ModeContextMap[M] | undefined;
};

/** tool_call 审批结果（对应 pi ToolCallResult）。 */
export type ToolApprovalDecision = {
  block: boolean;
  reason?: string;
};

/** 单个模式的完整策略定义。 */
export type ModeConfig<M extends AgentMode = AgentMode> = {
  id: M;
  tools: {
    /** 本模式必须启用的控制工具 id（autopilot=yolo_control；book=null）。 */
    requiredControlToolId: string | null;
    /** 从全部已启用工具 id 过滤出本模式应使用的集合。 */
    filterEnabledToolIds(allEnabled: readonly string[]): string[];
  };
  /** 步数上限；null 表示不限。 */
  stepLimit: number | null;
  /** 渲染本模式的系统规则文本。 */
  buildRules(context: ModeContextMap[M] | undefined): string;
  loop: {
    /** turn_end 续轮判定（pi followUp 内循环驱动）。 */
    decideContinuation(input: ContinuationInput<M>): ContinuationDecision;
  };
  approval: {
    /** tool_call 审批（驱动 harness.on("tool_call")）。 */
    decideToolCall(input: ToolApprovalInput<M>): ToolApprovalDecision;
  };
};
