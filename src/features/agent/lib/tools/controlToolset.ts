import type { AgentTool } from "../runtime";
import {
  createYoloControlData,
  summarizeYoloControl,
  YOLO_CONTROL_TOOL_ID,
} from "../yoloControl";
import {
  createInitialWorkflowState,
  createWorkflowController,
  type WorkflowState,
  WORKFLOW_CONTROL_TOOL_ID,
} from "../workflowControl";
import { ok } from "./shared";

export function createControlTools(options?: {
  workflowState?: WorkflowState;
}): Record<string, AgentTool> {
  const workflowController = createWorkflowController(
    options?.workflowState ?? createInitialWorkflowState(),
  );

  return {
    [YOLO_CONTROL_TOOL_ID]: {
      description:
        "YOLO 模式每轮结果检查专用工具。每轮必须调用一次；complete 只在成果写回、验证通过、状态维护完成时使用。",
      execute: async (input) => {
        const data = createYoloControlData(input);
        return ok(summarizeYoloControl(data), data);
      },
    },
    [WORKFLOW_CONTROL_TOOL_ID]: {
      description:
        "工作流模式专用控制工具。用于提交流程草案、请求确认、启动执行、完成节点、选择分支、循环、阻塞或完成整个工作流。",
      execute: async (input) => {
        const result = workflowController.process(input);
        return ok(result.message, result);
      },
    },
  };
}
