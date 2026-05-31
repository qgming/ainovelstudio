// CP-F：YOLO（全自动目标执行）模式策略。
//
// 内聚原 stores/chat-run/autopilot.ts 的全部续轮逻辑（shouldContinueAutopilot /
// isAutopilotGoalCompleted / buildAutopilotContinuePrompt / needsProtocolRepair），
// 改为基于「本轮 turnParts」判定，由 runner 在 turn_end 调用并以 harness.followUp 续轮。

import { buildModeRules } from "../modeRules";
import { getYoloControlDataFromPart, YOLO_CONTROL_TOOL_ID } from "../yoloControl";
import type { AgentPart } from "../types";
import { filterEnabledToolIdsForMode } from "./toolFilter";
import type {
  ContinuationDecision,
  ContinuationInput,
  ModeConfig,
  ToolApprovalDecision,
  ToolApprovalInput,
} from "./types";

// 续轮提示词：系统提示词已含完整 YOLO 契约与工作循环，这里只保留差异化信号
//（本轮目标 + 是否进入协议修复）。
export function buildAutopilotContinuePrompt(
  goal: string,
  iteration: number,
  needsRepair = false,
) {
  const header = needsRepair
    ? "[YOLO 协议修复] 上一轮未调用 `yolo_control`,本轮只做结果检查,不要继续执行新任务。"
    : "[YOLO 自动检查] 本轮按 YOLO 契约继续推进,完成后调用 `yolo_control` 给出本轮裁定。";

  return [
    header,
    `YOLO 总目标:${goal}`,
    `当前全自动轮次:第 ${iteration} 轮`,
    "",
    "请根据当前对话、计划、工具结果和工作区状态,在本轮结束前必须调用 `yolo_control`:",
    '- 已完成:action="complete",evidence/verification 写明证据,stateUpdated=true。',
    '- 未完成:action="continue",remaining 写剩余任务,nextAction 写下一轮动作。',
    '- 阻塞:action="blocked",requiredUserAction 写明用户要做什么。',
    "",
    "需要读取相关资料、调用 Inspect → Plan → Act → Verify → Report 循环、按需读取 SKILL.md,均按系统提示词中的契约执行。",
  ].join("\n");
}

// 从本轮产出的 parts 提取 yolo_control 裁定（无则 null）。
function findYoloControl(parts: readonly AgentPart[]) {
  for (const part of [...parts].reverse()) {
    const data = getYoloControlDataFromPart(part);
    if (data) return data;
  }
  return null;
}

function decideContinuation(input: ContinuationInput<"autopilot">): ContinuationDecision {
  const goal = input.modeContext?.goal?.trim() || "未指定";
  // iteration 取本轮序号 + 1 作为下一轮展示号；外循环时代靠 modeContext.iteration 传递，
  // 内循环后改由本计数推进（turnCount 即已完成轮数）。
  const nextIteration = input.turnCount + 1;

  const control = findYoloControl(input.turnParts);

  // 本轮未调用 yolo_control（协议缺失）→ 续轮做结果检查（协议修复版）。
  if (!control) {
    return {
      kind: "continue",
      followUpPrompt: buildAutopilotContinuePrompt(goal, nextIteration, true),
      reason: "write_repair",
    };
  }

  // 已验收完成 → 停。
  if (control.accepted && control.action === "complete") {
    return { kind: "stop", reason: "goal_completed" };
  }
  // 阻塞（已通过硬校验）→ 停，等用户处理。
  if (control.accepted && control.action === "blocked") {
    return { kind: "stop", reason: "blocked" };
  }

  // continue，或裁定未通过硬校验（缺 goal/reason 等）→ 继续推进。
  return {
    kind: "continue",
    followUpPrompt: buildAutopilotContinuePrompt(goal, nextIteration, false),
    reason: "yolo_continue",
  };
}

// 当前工作区工具均为创作所需（read/write/edit/json/search/relation/plan），YOLO 下全部放行——
// 写文件正是 YOLO 的本职。预留高风险工具名集合（未来引入 shell/http/批量删除类时在此扩展）。
const HIGH_RISK_TOOL_IDS = new Set<string>([]);

function decideToolCall(input: ToolApprovalInput<"autopilot">): ToolApprovalDecision {
  if (HIGH_RISK_TOOL_IDS.has(input.toolName)) {
    return { block: true, reason: `工具 ${input.toolName} 属高风险操作，YOLO 模式下需用户授权。` };
  }
  return { block: false };
}

export const autopilotMode: ModeConfig<"autopilot"> = {
  id: "autopilot",
  tools: {
    requiredControlToolId: YOLO_CONTROL_TOOL_ID,
    filterEnabledToolIds: (allEnabled) =>
      filterEnabledToolIdsForMode(allEnabled, YOLO_CONTROL_TOOL_ID, [YOLO_CONTROL_TOOL_ID]),
  },
  // 不设硬性轮数上限：持续运行直到目标完成 / 阻塞 / 用户停止。
  stepLimit: null,
  buildRules: (context) => buildModeRules("autopilot", context ?? { goal: "未指定", iteration: 1 }),
  loop: { decideContinuation },
  approval: { decideToolCall },
};
