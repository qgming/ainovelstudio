import { describe, expect, it } from "vitest";
import { MODE_CONTROL_KIND, MODE_CONTROL_TOOL_ID } from "./modeControl";
import type { AgentMessage } from "./types";
import {
  createInitialFlowWorkflowState,
  deriveFlowWorkflowState,
  processFlowWorkflowControl,
} from "./workflowControl";

describe("workflowControl", () => {
  it("拒绝跳过当前 flow 阶段", () => {
    const result = processFlowWorkflowControl(createInitialFlowWorkflowState(), {
      mode: "flow",
      action: "complete_stage",
      stage: "plan",
      evidence: ["已有计划"],
    });

    expect(result.accepted).toBe(false);
    expect(result.state.currentStage).toBe("inspect");
    expect(result.missing).toContain("当前阶段是 inspect，不能提交 plan。");
  });

  it("拒绝未知 workflowId", () => {
    const result = processFlowWorkflowControl(createInitialFlowWorkflowState(), {
      mode: "flow",
      workflowId: "custom",
      action: "complete_stage",
      stage: "inspect",
      evidence: ["已读取上下文"],
    });

    expect(result.accepted).toBe(false);
    expect(result.missing).toContain("当前只支持 workflowId=chapter-harness。");
  });

  it("接受当前阶段证据并推进到下一阶段", () => {
    const result = processFlowWorkflowControl(createInitialFlowWorkflowState(), {
      mode: "flow",
      action: "complete_stage",
      stage: "inspect",
      evidence: ["已读取 .project/AGENTS.md"],
    });

    expect(result.accepted).toBe(true);
    expect(result.state.completedStages).toEqual(["inspect"]);
    expect(result.state.currentStage).toBe("skill_load");
  });

  it("从历史 run_control 工具结果恢复 flow 状态", () => {
    const state = processFlowWorkflowControl(createInitialFlowWorkflowState(), {
      mode: "flow",
      action: "complete_stage",
      stage: "inspect",
      evidence: ["已读取上下文"],
    }).state;
    const flowPart = {
      type: "tool-call" as const,
      toolName: MODE_CONTROL_TOOL_ID,
      toolCallId: "flow-control-1",
      status: "completed" as const,
      inputSummary: "{}",
      output: {
        kind: MODE_CONTROL_KIND,
        mode: "flow",
        action: "complete_stage",
        createdAt: "2026-05-10T00:00:00.000Z",
        workflow: { accepted: true, missing: [], message: "ok", state },
      },
    };
    const messages: AgentMessage[] = [{
      author: "主代理",
      id: "assistant-1",
      role: "assistant",
      parts: [flowPart],
    }];

    expect(deriveFlowWorkflowState(messages).currentStage).toBe("skill_load");
    expect(deriveFlowWorkflowState([{
      ...messages[0],
      parts: [{
        ...flowPart,
        output: {
          data: flowPart.output,
          ok: true,
          summary: "flow 阶段已推进。",
        },
      }],
    }]).currentStage).toBe("skill_load");
  });
});
