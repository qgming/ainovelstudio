import type { AgentMessage } from "@features/agent/lib/types";
import type { AgentMode } from "@features/agent/lib/modeRules";
import {
  getLatestAssistantYoloControl,
  isYoloControlCompletionPart,
} from "@features/agent/lib/yoloControl";

const MAX_AUTOPILOT_ITERATIONS = 8;

export const COACH_PROMPT =
  "请继续执行刚才未完成的任务，从当前断点往下做即可。不要额外改变任务目标或创作要求。";

export function buildAutopilotContinuePrompt(goal: string, iteration: number) {
  return [
    "YOLO 自动检查：请根据当前对话、计划和工作区状态检查总目标是否已经完成。",
    `YOLO 总目标：${goal}`,
    `当前全自动轮次：${iteration}`,
    "",
    "每轮必须先看项目默认上下文并读取相关资料；缺人物、伏笔、状态、章节或设定证据时，优先用 workspace_search 召回上下文包，再用 workspace_read 精读必要文件。",
    "每轮必须执行：Inspect -> Skill Load -> Plan -> Act -> Verify -> State Maintain -> Report。",
    "Skill Load 阶段：任务明显匹配已启用 skill 时，必须用 skill_read 工具读取对应 SKILL.md，再按需读取 references。",
    "每轮最后必须进入 YOLO 结果检查节，并调用 `yolo_control`；不要用普通回复代替工具调用。",
    '如果目标已经完成，必须核对成果、验证结果和状态回写，然后调用 `yolo_control`，参数为 action="complete"，evidence/verification 写明证据，stateUpdated=true。',
    '如果目标还没有完成，调用 `yolo_control`，参数为 action="continue"，remaining 写剩余任务，nextAction 写下一轮动作。',
    '如果遇到外部授权、高风险操作或缺关键输入，调用 `yolo_control`，参数为 action="blocked"，requiredUserAction 写明用户要做什么。',
  ].join("\n");
}

export function buildAutopilotProtocolRepairPrompt(goal: string, iteration: number) {
  return [
    "YOLO 协议检查：上一轮没有调用 `yolo_control`，因此应用无法判断是否继续或结束。",
    `YOLO 总目标：${goal}`,
    `当前全自动轮次：${iteration}`,
    "",
    "现在只做结果检查，不要继续执行新任务。",
    "请根据当前对话、计划、工具结果和工作区状态，必须调用 `yolo_control`：",
    '- 已完成：action="complete"，并提供 evidence、verification、stateUpdated=true。',
    '- 未完成：action="continue"，并提供 remaining、nextAction。',
    '- 阻塞：action="blocked"，并提供 reason、requiredUserAction。',
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
  const prompt = needsProtocolRepair(params.latestMessages)
    ? buildAutopilotProtocolRepairPrompt(params.autopilotGoal as string, nextIteration)
    : buildAutopilotContinuePrompt(params.autopilotGoal as string, nextIteration);
  await params.runNext(
    prompt,
    nextIteration,
  );
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
  if (params.iteration >= MAX_AUTOPILOT_ITERATIONS) return false;
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
