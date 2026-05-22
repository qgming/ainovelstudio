import type { AgentMessage } from "@features/agent/lib/types";
import type { AgentMode } from "@features/agent/lib/modeRules";
import {
  getLatestAssistantYoloControl,
  isYoloControlCompletionPart,
} from "@features/agent/lib/yoloControl";

// 不设置硬性轮数上限:autopilot 持续运行直到目标完成或被用户/工具显式 blocked。
// 用户随时可以手动停止;运行成本由模型方计费控制,而非这里截断。

export const COACH_PROMPT =
  "请继续执行刚才未完成的任务，从当前断点往下做即可。不要额外改变任务目标或创作要求。";

// continue 与 repair 合并为单一精简 prompt。
// 系统提示词中已包含完整的 YOLO 契约、Inspect → Plan → Act → Verify → Report 循环、
// SKILL.md 读取要求等,这里只保留差异化信号:本轮目标 + 是否进入协议修复。
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

export function isAutopilotGoalCompleted(messages: AgentMessage[]) {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistant) return false;
  return assistant.parts.some((part) => isYoloControlCompletionPart(part));
}

export async function continueAutopilotRun(params: {
  activeModeId: AgentMode;
  activeSessionId: string | null;
  autopilotGoal: string | null;
  iteration: number;
  latestMessages: AgentMessage[];
  runNext: (prompt: string, iteration: number) => Promise<void>;
  sessionId: string | null;
  storeModeId: AgentMode;
}) {
  if (!shouldContinueAutopilot(params)) return;
  const nextIteration = params.iteration + 1;
  const prompt = buildAutopilotContinuePrompt(
    params.autopilotGoal as string,
    nextIteration,
    needsProtocolRepair(params.latestMessages),
  );
  await params.runNext(prompt, nextIteration);
}

function shouldContinueAutopilot(params: {
  activeModeId: AgentMode;
  activeSessionId: string | null;
  autopilotGoal: string | null;
  iteration: number;
  latestMessages: AgentMessage[];
  sessionId: string | null;
  storeModeId: AgentMode;
}) {
  if (
    !(params.activeModeId === "autopilot"
    && Boolean(params.autopilotGoal)
    && params.storeModeId === "autopilot"
    && params.activeSessionId === params.sessionId
    && params.latestMessages.length > 0)
  ) {
    return false;
  }
  if (isAutopilotGoalCompleted(params.latestMessages)) return false;
  const latestControl = getLatestAssistantYoloControl(params.latestMessages);
  if (latestControl?.accepted && latestControl.action === "blocked") return false;
  return true;
}

function needsProtocolRepair(messages: AgentMessage[]) {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistant) return false;
  return !getLatestAssistantYoloControl([assistant]);
}
