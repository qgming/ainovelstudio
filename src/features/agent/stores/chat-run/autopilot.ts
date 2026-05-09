import type { AgentMessage } from "@features/agent/lib/types";
import type { AgentMode } from "@features/agent/lib/modeRules";
import { extractMessageText } from "@features/agent/chat/sessionRuntime";

export const COACH_PROMPT =
  "你刚才这个节奏明显慢了。原来的剧情、人设、风格都保留，别把问题扩大。现在先说清楚卡点，然后接着断点继续干。网文这东西最怕拖，读者不会等你慢慢找状态，给我把冲突和爽点往前推。";

const AUTOPILOT_COMPLETION_MARKS = [
  "YOLO目标完成",
  "目标已完成",
  "流程已完成",
  "工作流已完成",
];
const AUTOPILOT_INCOMPLETE_MARKS = [
  "目标未完成",
  "尚未完成",
  "未完成",
  "下一轮动作",
  "继续执行",
];

export function buildAutopilotContinuePrompt(goal: string, iteration: number) {
  return [
    "YOLO 自动检查：请根据当前对话、计划和工作区状态检查总目标是否已经完成。",
    `YOLO 总目标：${goal}`,
    `当前全自动轮次：${iteration}`,
    "",
    "每轮必须先读取相关资料：项目默认上下文、当前 run、状态 JSON、canon、style、chapters；缺证据时用 read / search / canon_query 补证据。",
    "每轮必须执行工作流：Inspect -> Skill Load -> Plan -> Act -> Verify -> State Maintain -> Report。",
    "Skill Load 阶段：任务明显匹配已启用 skill 时，必须用 skill 工具读取对应 SKILL.md，再按需读取 references。",
    "如果目标已经完成，必须核对成果、验证结果和状态回写，然后在最终回复中写出「YOLO目标完成」。",
    "如果目标还没有完成，直接继续执行最重要的下一步，并写回、验证、维护必要文件；不要写「YOLO目标完成」。",
  ].join("\n");
}

export function isAutopilotGoalCompleted(messages: AgentMessage[]) {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistant) return false;
  const text = extractMessageText(assistant);
  const hasCompletionMark = AUTOPILOT_COMPLETION_MARKS.some((mark) => text.includes(mark));
  const hasIncompleteMark = AUTOPILOT_INCOMPLETE_MARKS.some((mark) => text.includes(mark));
  return hasCompletionMark && !hasIncompleteMark;
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
  await params.runNext(
    buildAutopilotContinuePrompt(params.autopilotGoal as string, params.iteration + 1),
    params.iteration + 1,
  );
}

function shouldContinueAutopilot(params: {
  activeModeId: AgentMode;
  activeSessionId: string | null;
  autopilotGoal: string | null;
  latestMessages: AgentMessage[];
  sessionId: string | null;
  storeModeId: AgentMode;
}) {
  return params.activeModeId === "autopilot"
    && Boolean(params.autopilotGoal)
    && params.storeModeId === "autopilot"
    && params.activeSessionId === params.sessionId
    && !isAutopilotGoalCompleted(params.latestMessages);
}
