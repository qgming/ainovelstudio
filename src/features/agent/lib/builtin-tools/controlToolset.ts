import type { AgentTool } from "../session/runtime";
import {
  createGoalControlData,
  GOAL_CONTROL_TOOL_ID,
  summarizeGoalControl,
} from "../domain/goalControl";
import { ok } from "./shared";

export function createControlTools(): Record<string, AgentTool> {
  return {
    [GOAL_CONTROL_TOOL_ID]: {
      description:
        "目标模式每轮结果检查专用工具。每轮必须调用一次；complete 只在成果写回、验证通过、状态维护完成时使用。",
      execute: async (input) => {
        const data = createGoalControlData(input);
        return ok(summarizeGoalControl(data), data);
      },
    },
  };
}
