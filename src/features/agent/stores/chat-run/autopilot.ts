import type { AgentMessage } from "@features/agent/lib/types";
import type { AgentMode } from "@features/agent/lib/modeRules";
import { extractMessageText } from "@features/agent/chat/sessionRuntime";

export const COACH_PROMPT =
  "你刚才这个节奏明显慢了。原来的剧情、人设、风格都保留，别把问题扩大。现在先说清楚卡点，然后接着断点继续干。网文这东西最怕拖，读者不会等你慢慢找状态，给我把冲突和爽点往前推。";

const AUTOPILOT_COMPLETION_MARK = "目标已完成";

export function buildAutopilotContinuePrompt(goal: string, iteration: number) {
  return [
    "自动检查：请根据当前对话、计划和工作区状态检查总目标是否已经完成。",
    `总目标：${goal}`,
    `当前自动轮次：${iteration}`,
    "",
    "如果目标已经完成，核对关键成果后在最终回复中写出「目标已完成」。",
    "如果目标还没有完成，直接继续执行最重要的下一步，并写回或验证必要文件。",
  ].join("\n");
}

export function isAutopilotGoalCompleted(messages: AgentMessage[]) {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  return assistant ? extractMessageText(assistant).includes(AUTOPILOT_COMPLETION_MARK) : false;
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
