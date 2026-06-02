// 目标（持续执行直到完成）模式策略。
//
// 参考 pi-codex-goal 的 continuation audit 与 pi-until-done 的 North Star / complete / block
// 协议：每轮由 goal_control 给出 complete / continue / blocked 裁定，runner 在 turn_end
// 根据裁定继续 followUp 或停止。

import {
  formatGoalBudget,
  getGoalControlDataFromPart,
  GOAL_CONTROL_TOOL_ID,
  type GoalRuntimeState,
} from "../domain/goalControl";
import type { AgentPart } from "../types";
import { filterEnabledToolIdsForMode } from "./toolFilter";
import type {
  ContinuationDecision,
  ContinuationInput,
  ModeConfig,
  ToolApprovalDecision,
  ToolApprovalInput,
} from "./types";

// 续轮提示词：系统提示词已含完整目标契约与工作循环，这里只保留差异化信号
//（本轮目标 + 是否进入协议修复）。
export function buildGoalContinuePrompt(
  goal: string,
  iteration: number,
  needsRepair = false,
  state?: GoalRuntimeState,
) {
  const header = state?.status === "budget_limited"
    ? "[目标预算收口] 当前目标已达到 token 预算，本轮不要展开新工作，只总结进展、剩余项和清晰下一步。"
    : needsRepair
    ? "[目标协议修复] 上一轮未调用 `goal_control`,本轮只做目标检查,不要继续执行新任务。"
    : "[目标自动检查] 本轮按目标契约继续推进,完成后调用 `goal_control` 给出本轮裁定。";
  const stateLines = state
    ? [
        "",
        "目标运行状态:",
        `- status:${state.status}`,
        `- goalId:${state.goalId}`,
        `- usage:${state.usage.tokensUsed} tokens / ${state.usage.activeSeconds} 秒`,
        `- budget:${formatGoalBudget(state)}`,
        state.lastControl ? `- 上次裁定:${state.lastControl.action} / ${state.lastControl.reason}` : null,
        state.auditFailures.length > 0 ? `- 待修复审计问题:${state.auditFailures.join("；")}` : null,
        state.blockedCount > 0 ? `- 连续阻塞次数:${state.blockedCount}/3` : null,
      ].filter(Boolean)
    : [];

  return [
    header,
    `当前总目标:${goal}`,
    `当前目标轮次:第 ${iteration} 轮`,
    ...stateLines,
    "",
    "请根据当前对话、计划、工具结果和工作区状态,在本轮结束前必须调用 `goal_control`:",
    '- 已完成:action="complete",仅在目标全部验收、证据充分、状态已回写时使用,audit 逐项映射显式要求,evidence/verification 写明证据,stateUpdated=true。',
    '- 未完成:action="continue",remaining 写剩余任务,nextAction 写下一轮动作。',
    '- 阻塞:action="blocked",requiredUserAction 写明用户要做什么。',
    "",
    "如果任何显式要求尚未验证、目标被缩小、状态未写回、审计失败或证据不足,都必须 continue 或 blocked,不要 complete。",
    "blocked 只有在同一阻塞条件连续 3 轮仍无法推进时才会终止目标；前两轮请先尝试低风险替代路径。",
    "需要读取相关资料、调用 Inspect → Plan → Act → Verify → Report 循环、按需读取 SKILL.md,均按系统提示词中的契约执行。",
  ].join("\n");
}

// 从本轮产出的 parts 提取 goal_control 裁定（无则 null）。
function findGoalControl(parts: readonly AgentPart[]) {
  for (const part of [...parts].reverse()) {
    const data = getGoalControlDataFromPart(part);
    if (data) return data;
  }
  return null;
}

function decideContinuation(input: ContinuationInput<"goal">): ContinuationDecision {
  const goal = input.modeContext?.goal?.trim() || "未指定";
  // iteration 取本轮序号 + 1 作为下一轮展示号；外循环时代靠 modeContext.iteration 传递，
  // 内循环后改由本计数推进（turnCount 即已完成轮数）。
  const nextIteration = input.turnCount + 1;

  const control = findGoalControl(input.turnParts);
  const state = input.goalState;

  if (state?.status === "complete") {
    return { kind: "stop", reason: "goal_completed" };
  }

  if (state?.status === "budget_limited") {
    if (state.budgetLimitNotified) {
      return { kind: "stop", reason: "budget_limited" };
    }
    return {
      kind: "continue",
      followUpPrompt: buildGoalContinuePrompt(goal, nextIteration, false, state),
      reason: "budget_limited",
    };
  }

  if (state?.status === "blocked") {
    return { kind: "stop", reason: "blocked" };
  }

  // 本轮未调用 goal_control（目标检查协议缺失）→ 续轮做结果检查（协议修复版）。
  if (!control) {
    return {
      kind: "continue",
      followUpPrompt: buildGoalContinuePrompt(goal, nextIteration, true, state),
      reason: "write_repair",
    };
  }

  // continue，或裁定未通过硬校验（缺 goal/reason 等）→ 继续推进。
  return {
    kind: "continue",
    followUpPrompt: buildGoalContinuePrompt(goal, nextIteration, false, state),
    reason: "goal_continue",
  };
}

// 当前工作区工具均为创作所需（read/write/edit/json/search/relation/plan），目标模式下全部放行——
// 写文件正是目标执行的本职。预留高风险工具名集合（未来引入 shell/http/批量删除类时在此扩展）。
const HIGH_RISK_TOOL_IDS = new Set<string>([]);

function decideToolCall(input: ToolApprovalInput<"goal">): ToolApprovalDecision {
  if (HIGH_RISK_TOOL_IDS.has(input.toolName)) {
    return { block: true, reason: `工具 ${input.toolName} 属高风险操作，目标模式下需用户授权。` };
  }
  return { block: false };
}

export const goalMode: ModeConfig<"goal"> = {
  id: "goal",
  tools: {
    requiredControlToolId: GOAL_CONTROL_TOOL_ID,
    filterEnabledToolIds: (allEnabled) =>
      filterEnabledToolIdsForMode(allEnabled, GOAL_CONTROL_TOOL_ID, [GOAL_CONTROL_TOOL_ID]),
  },
  // 不设硬性轮数上限：持续运行直到目标完成 / 阻塞 / 用户停止。
  stepLimit: null,
  loop: { decideContinuation },
  approval: { decideToolCall },
};
