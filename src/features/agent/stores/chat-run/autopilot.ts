import type { AgentMessage } from "@features/agent/lib/types";
import type { AgentMode } from "@features/agent/lib/modeRules";
import { isModeControlCompletionPart } from "@features/agent/lib/modeControl";

export const COACH_PROMPT =
  "请继续执行刚才未完成的任务，从当前断点往下做即可。不要额外改变任务目标或创作要求。";

export function buildAutopilotContinuePrompt(goal: string, iteration: number) {
  return [
    "YOLO 自动检查：请根据当前对话、计划和工作区状态检查总目标是否已经完成。",
    `YOLO 总目标：${goal}`,
    `当前全自动轮次：${iteration}`,
    "",
    "每轮必须先读取相关资料：项目默认上下文、当前 run、状态 JSON、canon、style、chapters；缺证据时用 read / search / canon_query 补证据。",
    "每轮必须执行工作流：Inspect -> Skill Load -> Plan -> Act -> Verify -> State Maintain -> Report。",
    "Skill Load 阶段：任务明显匹配已启用 skill 时，必须用 skill 工具读取对应 SKILL.md，再按需读取 references。",
    '如果目标已经完成，必须核对成果、验证结果和状态回写，然后调用 `mode_control`，参数为 mode="autopilot"、action="complete"，reason 写明验收证据。',
    "如果目标还没有完成，直接继续执行最重要的下一步，并写回、验证、维护必要文件；不要调用 `mode_control` 的 complete 动作。",
  ].join("\n");
}

export function isAutopilotGoalCompleted(messages: AgentMessage[]) {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistant) return false;
  return assistant.parts.some((part) => isModeControlCompletionPart(part, "autopilot"));
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
