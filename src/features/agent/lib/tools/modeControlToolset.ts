import type { AgentTool } from "../runtime";
import {
  createModeControlData,
  MODE_CONTROL_DEFAULT_MODE,
  MODE_CONTROL_TOOL_ID,
  type ModeControlAction,
} from "../modeControl";
import {
  createFlowWorkflowController,
  createInitialFlowWorkflowState,
  type FlowWorkflowState,
} from "../workflowControl";
import { ok } from "./shared";

const MODE_CONTROL_ACTIONS = new Set<ModeControlAction>([
  "complete",
  "blocked",
  "continue",
  "complete_stage",
  "complete_workflow",
]);

function normalizeOptionalString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function normalizeAction(value: unknown): ModeControlAction {
  if (typeof value === "string" && MODE_CONTROL_ACTIONS.has(value as ModeControlAction)) {
    return value as ModeControlAction;
  }
  throw new Error("mode_control.action 必须是 complete、blocked、continue、complete_stage 或 complete_workflow。");
}

function buildSummary(action: ModeControlAction, mode: string, reason?: string) {
  const actionLabel = action === "complete"
    ? "已标记完成"
    : action === "blocked"
      ? "已标记阻塞"
      : "已记录继续";
  return [`${mode} 模式控制：${actionLabel}。`, reason].filter(Boolean).join(" ");
}

export function createModeControlTools(options?: {
  flowWorkflowState?: FlowWorkflowState;
}): Record<string, AgentTool> {
  const flowController = createFlowWorkflowController(
    options?.flowWorkflowState ?? createInitialFlowWorkflowState(),
  );
  return {
    [MODE_CONTROL_TOOL_ID]: {
      description:
        "向应用提交当前模式的流程控制信号。YOLO 目标完成时调用 action=complete；flow 模式用 complete_stage、blocked、complete_workflow 由程序校验推进。",
      execute: async (input) => {
        const action = normalizeAction(input.action);
        const mode = normalizeOptionalString(input.mode) ?? MODE_CONTROL_DEFAULT_MODE;
        const reason = normalizeOptionalString(input.reason);
        const nextAction = normalizeOptionalString(input.nextAction);
        if (mode === "flow") {
          const workflow = flowController.process(input);
          return ok(workflow.message, createModeControlData({
            action,
            mode,
            nextAction,
            reason,
            workflow,
          }));
        }
        return ok(
          buildSummary(action, mode, reason),
          createModeControlData({ action, mode, nextAction, reason }),
        );
      },
    },
  };
}
