import { describe, expect, it } from "vitest";
import { YOLO_CONTROL_KIND, YOLO_CONTROL_TOOL_ID } from "../yoloControl";
import type { AgentPart } from "../types";
import { getModeConfig } from "./index";
import { bookMode, COLLAB_STEP_LIMIT } from "./bookMode";
import { autopilotMode, buildAutopilotContinuePrompt } from "./autopilotMode";

// 构造一个携带 YoloControlData 的 yolo_control tool-result part。
function yoloControlPart(
  action: "complete" | "continue" | "blocked",
  overrides: Partial<Record<string, unknown>> = {},
): AgentPart {
  return {
    type: "tool-result",
    toolName: YOLO_CONTROL_TOOL_ID,
    toolCallId: "yolo-1",
    status: "completed",
    outputSummary: "",
    output: {
      accepted: true,
      action,
      createdAt: "2026-05-10T00:00:00.000Z",
      evidence: action === "complete" ? ["已写回"] : [],
      goal: "完成第一章",
      kind: YOLO_CONTROL_KIND,
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
    expect(getModeConfig("autopilot")).toBe(autopilotMode);
  });

  it("未传/未知模式回退 book", () => {
    expect(getModeConfig(undefined)).toBe(bookMode);
  });
});

describe("step limit", () => {
  it("book 模式 1000 上限", () => {
    expect(bookMode.stepLimit).toBe(COLLAB_STEP_LIMIT);
    expect(bookMode.stepLimit).toBe(1000);
  });

  it("autopilot 模式无上限", () => {
    expect(autopilotMode.stepLimit).toBeNull();
  });
});

describe("tools.filterEnabledToolIds", () => {
  it("book 剔除 yolo_control", () => {
    const result = bookMode.tools.filterEnabledToolIds([
      "workspace_read",
      YOLO_CONTROL_TOOL_ID,
      "update_plan",
    ]);
    expect(result).toEqual(["workspace_read", "update_plan"]);
  });

  it("autopilot 强制带 yolo_control（即便未启用）", () => {
    const result = autopilotMode.tools.filterEnabledToolIds(["workspace_read"]);
    expect(result).toContain(YOLO_CONTROL_TOOL_ID);
    expect(result).toContain("workspace_read");
  });

  it("autopilot 不重复添加已启用的 yolo_control", () => {
    const result = autopilotMode.tools.filterEnabledToolIds([
      YOLO_CONTROL_TOOL_ID,
      "workspace_read",
    ]);
    expect(result.filter((id) => id === YOLO_CONTROL_TOOL_ID)).toHaveLength(1);
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

  it("写入任务却无写入工具调用 → 注入协议修复 followUp", () => {
    const decision = bookMode.loop.decideContinuation(baseInput);
    expect(decision.kind).toBe("continue");
    expect(decision.reason).toBe("write_repair");
    expect(decision.followUpPrompt).toContain("协议修复");
  });

  it("已修复过（repairCount>0）→ 停", () => {
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

describe("autopilot loop.decideContinuation", () => {
  const baseInput = {
    turnCount: 1,
    stepLimit: null,
    finishReason: "stop",
    turnParts: [] as AgentPart[],
    modeContext: { goal: "完成第一章", iteration: 1 },
    enabledToolIds: [YOLO_CONTROL_TOOL_ID],
    userPrompt: "完成第一章",
    repairCount: 0,
  };

  it("本轮无 yolo_control → 续轮（协议修复）", () => {
    const decision = autopilotMode.loop.decideContinuation(baseInput);
    expect(decision.kind).toBe("continue");
    expect(decision.reason).toBe("write_repair");
    expect(decision.followUpPrompt).toContain("协议修复");
  });

  it("yolo_control complete → 停（goal_completed）", () => {
    const decision = autopilotMode.loop.decideContinuation({
      ...baseInput,
      turnParts: [yoloControlPart("complete")],
    });
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toBe("goal_completed");
  });

  it("yolo_control blocked → 停（blocked）", () => {
    const decision = autopilotMode.loop.decideContinuation({
      ...baseInput,
      turnParts: [yoloControlPart("blocked")],
    });
    expect(decision.kind).toBe("stop");
    expect(decision.reason).toBe("blocked");
  });

  it("yolo_control continue → 续轮（yolo_continue），轮次推进", () => {
    const decision = autopilotMode.loop.decideContinuation({
      ...baseInput,
      turnCount: 2,
      turnParts: [yoloControlPart("continue")],
    });
    expect(decision.kind).toBe("continue");
    expect(decision.reason).toBe("yolo_continue");
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

  it("autopilot 放行常规工作区工具", () => {
    expect(autopilotMode.approval.decideToolCall({
      toolName: "workspace_write",
      input: {},
      modeContext: { goal: "g", iteration: 1 },
    })).toEqual({ block: false });
  });
});

describe("buildAutopilotContinuePrompt", () => {
  it("普通续轮含三种 action", () => {
    const prompt = buildAutopilotContinuePrompt("完成第一章", 2);
    expect(prompt).toContain("YOLO 自动检查");
    expect(prompt).toContain("完成第一章");
    expect(prompt).toContain("第 2 轮");
    expect(prompt).toContain('action="complete"');
    expect(prompt).toContain('action="continue"');
    expect(prompt).toContain('action="blocked"');
  });

  it("协议修复模式不同 header", () => {
    const prompt = buildAutopilotContinuePrompt("完成第一章", 3, true);
    expect(prompt).toContain("YOLO 协议修复");
    expect(prompt).toContain("不要继续执行新任务");
  });
});
