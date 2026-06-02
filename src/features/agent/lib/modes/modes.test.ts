import { describe, expect, it } from "vitest";
import {
  applyGoalControl,
  createGoalRuntimeState,
  GOAL_CONTROL_KIND,
  GOAL_CONTROL_TOOL_ID,
  type GoalRuntimeState,
} from "../domain/goalControl";
import type { AgentPart } from "../types";
import { getModeConfig } from "./index";
import { bookMode, COLLAB_STEP_LIMIT } from "./bookMode";
import { buildGoalContinuePrompt, goalMode } from "./goalMode";

function goalControlPart(
  action: "complete" | "continue" | "blocked",
  overrides: Partial<Record<string, unknown>> = {},
): Extract<AgentPart, { type: "tool-result" }> {
  return {
    type: "tool-result",
    toolName: GOAL_CONTROL_TOOL_ID,
    toolCallId: "goal-1",
    status: "completed",
    outputSummary: "",
    output: {
      accepted: true,
      action,
      audit: action === "complete" ? ["目标要求已逐项核对"] : [],
      createdAt: "2026-05-10T00:00:00.000Z",
      evidence: action === "complete" ? ["已写回"] : [],
      goal: "完成第一章",
      kind: GOAL_CONTROL_KIND,
      missing: [],
      warnings: [],
      reason: "测试",
      remaining: action === "continue" ? ["继续审校"] : [],
      requiredUserAction: action === "blocked" ? "请提供授权" : undefined,
      stateUpdated: action === "complete",
      verification: action === "complete" ? ["已验证"] : [],
      ...overrides,
    },
  };
}

describe("getModeConfig", () => {
  it("已知模式返回对应配置", () => {
    expect(getModeConfig("book")).toBe(bookMode);
    expect(getModeConfig("goal")).toBe(goalMode);
  });

  it("未传模式回退 book", () => {
    expect(getModeConfig(undefined)).toBe(bookMode);
  });
});

describe("step limit", () => {
  it("book 模式 1000 上限", () => {
    expect(bookMode.stepLimit).toBe(COLLAB_STEP_LIMIT);
    expect(bookMode.stepLimit).toBe(1000);
  });

  it("goal 模式无轮数上限", () => {
    expect(goalMode.stepLimit).toBeNull();
  });
});

describe("tools.filterEnabledToolIds", () => {
  it("book 剔除 goal_control", () => {
    const result = bookMode.tools.filterEnabledToolIds([
      "workspace_read",
      GOAL_CONTROL_TOOL_ID,
      "update_plan",
    ]);
    expect(result).toEqual(["workspace_read", "update_plan"]);
  });

  it("goal 强制带 goal_control（即便未启用）", () => {
    const result = goalMode.tools.filterEnabledToolIds(["workspace_read"]);
    expect(result).toContain(GOAL_CONTROL_TOOL_ID);
    expect(result).toContain("workspace_read");
  });

  it("goal 不重复添加已启用的 goal_control", () => {
    const result = goalMode.tools.filterEnabledToolIds([
      GOAL_CONTROL_TOOL_ID,
      "workspace_read",
    ]);
    expect(result.filter((id: string) => id === GOAL_CONTROL_TOOL_ID)).toHaveLength(1);
  });
});

describe("book loop.decideContinuation", () => {
  const baseInput = {
    turnCount: 1,
    stepLimit: COLLAB_STEP_LIMIT,
    finishReason: "stop",
    turnParts: [] as AgentPart[],
    modeContext: {} as Record<string, never>,
    enabledToolIds: ["workspace_write"],
    userPrompt: "帮我写第一章正文并保存",
    repairCount: 0,
  };

  it("协作模式不做写入协议修复或目标模板检查", () => {
    const decision = bookMode.loop.decideContinuation(baseInput);
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toBeUndefined();
  });

  it("协作模式即使 repairCount>0 也不触发后台续轮", () => {
    const decision = bookMode.loop.decideContinuation({ ...baseInput, repairCount: 1 });
    expect(decision.kind).toBe("stop");
  });

  it("已调用写入工具 → 停", () => {
    const decision = bookMode.loop.decideContinuation({
      ...baseInput,
      turnParts: [
        { type: "tool-call", toolName: "workspace_write", toolCallId: "w1", status: "completed", inputSummary: "" },
      ],
    });
    expect(decision.kind).toBe("stop");
  });
});

describe("goal loop.decideContinuation", () => {
  function stateWithControl(action: "complete" | "continue" | "blocked", overrides: Partial<Record<string, unknown>> = {}) {
    return applyGoalControl(createGoalRuntimeState("完成第一章"), goalControlPart(action, overrides).output as never);
  }

  const baseInput = {
    turnCount: 1,
    stepLimit: null,
    finishReason: "stop",
    turnParts: [] as AgentPart[],
    modeContext: { goal: "完成第一章", iteration: 1 },
    enabledToolIds: [GOAL_CONTROL_TOOL_ID],
    userPrompt: "完成第一章",
    repairCount: 0,
  };

  it("本轮无 goal_control → 续轮（协议修复）", () => {
    const decision = goalMode.loop.decideContinuation(baseInput);
    expect(decision.kind).toBe("continue");
    expect(decision.reason).toBe("write_repair");
    expect(decision.followUpPrompt).toContain("协议修复");
  });

  it("目标状态已完成 → 停（goal_completed）", () => {
    const completeState = stateWithControl("complete");
    const decision = goalMode.loop.decideContinuation({
      ...baseInput,
      goalState: completeState,
      turnParts: [goalControlPart("complete")],
    });
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toBe("goal_completed");
  });

  it("complete 审计不完整 → 继续而不是误判完成", () => {
    const weakComplete = stateWithControl("complete", {
      audit: [],
      evidence: [],
      stateUpdated: false,
      verification: [],
    });
    const decision = goalMode.loop.decideContinuation({
      ...baseInput,
      goalState: weakComplete,
      turnParts: [goalControlPart("complete", {
        audit: [],
        evidence: [],
        stateUpdated: false,
        verification: [],
      })],
    });
    expect(decision.kind).toBe("continue");
    expect(decision.reason).toBe("goal_continue");
    expect(decision.followUpPrompt).toContain("待修复审计问题");
  });

  it("blocked 未连续 3 次 → 继续尝试替代路径", () => {
    const blockedOnce = stateWithControl("blocked");
    const decision = goalMode.loop.decideContinuation({
      ...baseInput,
      goalState: blockedOnce,
      turnParts: [goalControlPart("blocked")],
    });
    expect(decision.kind).toBe("continue");
    expect(decision.reason).toBe("goal_continue");
    expect(decision.followUpPrompt).toContain("连续阻塞次数:1/3");
  });

  it("blocked 连续 3 次 → 停（blocked）", () => {
    const blockedState: GoalRuntimeState = {
      ...createGoalRuntimeState("完成第一章"),
      blockedCount: 3,
      status: "blocked",
    };
    const decision = goalMode.loop.decideContinuation({
      ...baseInput,
      goalState: blockedState,
      turnParts: [goalControlPart("blocked")],
    });
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toBe("blocked");
  });

  it("预算触顶时先注入一次收口提示，已收口后停止", () => {
    const budgetState: GoalRuntimeState = {
      ...createGoalRuntimeState("完成第一章", 10),
      status: "budget_limited",
      usage: { activeSeconds: 12, tokensUsed: 10 },
    };
    const wrapUp = goalMode.loop.decideContinuation({
      ...baseInput,
      goalState: budgetState,
      turnParts: [goalControlPart("continue")],
    });
    expect(wrapUp.kind).toBe("continue");
    expect(wrapUp.reason).toBe("budget_limited");
    expect(wrapUp.followUpPrompt).toContain("目标预算收口");

    const stop = goalMode.loop.decideContinuation({
      ...baseInput,
      goalState: { ...budgetState, budgetLimitNotified: true },
      turnParts: [goalControlPart("continue")],
    });
    expect(stop.kind).toBe("stop");
    expect(stop.reason).toBe("budget_limited");
  });

  it("goal_control continue → 续轮（goal_continue），轮次推进", () => {
    const decision = goalMode.loop.decideContinuation({
      ...baseInput,
      turnCount: 2,
      turnParts: [goalControlPart("continue")],
    });
    expect(decision.kind).toBe("continue");
    expect(decision.reason).toBe("goal_continue");
    expect(decision.followUpPrompt).toContain("第 3 轮");
    expect(decision.followUpPrompt).toContain("自动检查");
  });
});

describe("approval.decideToolCall", () => {
  it("book 全部放行", () => {
    expect(bookMode.approval.decideToolCall({
      toolName: "workspace_write",
      input: {},
      modeContext: {},
    })).toEqual({ block: false });
  });

  it("goal 放行常规工作区工具", () => {
    expect(goalMode.approval.decideToolCall({
      toolName: "workspace_write",
      input: {},
      modeContext: { goal: "g", iteration: 1 },
    })).toEqual({ block: false });
  });
});

describe("buildGoalContinuePrompt", () => {
  it("普通续轮含三种 action 和完成审计要求", () => {
    const prompt = buildGoalContinuePrompt("完成第一章", 2);
    expect(prompt).toContain("目标自动检查");
    expect(prompt).toContain("完成第一章");
    expect(prompt).toContain("第 2 轮");
    expect(prompt).toContain('action="complete"');
    expect(prompt).toContain('action="continue"');
    expect(prompt).toContain('action="blocked"');
    expect(prompt).toContain("证据不足");
  });

  it("协议修复模式不同 header", () => {
    const prompt = buildGoalContinuePrompt("完成第一章", 3, true);
    expect(prompt).toContain("目标协议修复");
    expect(prompt).toContain("不要继续执行新任务");
  });
});
