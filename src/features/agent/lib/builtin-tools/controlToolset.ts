import type { AgentTool } from "../runtime";
import {
  createYoloControlData,
  summarizeYoloControl,
  YOLO_CONTROL_TOOL_ID,
} from "../yoloControl";
import { ok } from "./shared";

export function createControlTools(): Record<string, AgentTool> {
  return {
    [YOLO_CONTROL_TOOL_ID]: {
      description:
        "YOLO 模式每轮结果检查专用工具。每轮必须调用一次；complete 只在成果写回、验证通过、状态维护完成时使用。",
      execute: async (input) => {
        const data = createYoloControlData(input);
        return ok(summarizeYoloControl(data), data);
      },
    },
  };
}
