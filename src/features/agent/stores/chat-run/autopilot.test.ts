import { describe, expect, it } from "vitest";
import {
  YOLO_CONTROL_KIND,
  YOLO_CONTROL_TOOL_ID,
} from "@features/agent/lib/yoloControl";
import type { AgentMessage, AgentPart } from "@features/agent/lib/types";
import {
  buildAutopilotContinuePrompt,
  isAutopilotGoalCompleted,
} from "./autopilot";

function assistant(text: string): AgentMessage {
  return assistantWithParts([{ text, type: "text" }]);
}

function assistantWithParts(parts: AgentPart[]): AgentMessage {
  return {
    author: "主代理",
    id: "assistant-1",
    parts,
    role: "assistant",
  };
}

describe("YOLO autopilot", () => {
  it("自动续跑精简提示包含 yolo_control 三种 action", () => {
    const prompt = buildAutopilotContinuePrompt("完成第一章", 2);

    expect(prompt).toContain("YOLO 自动检查");
    expect(prompt).toContain("完成第一章");
    expect(prompt).toContain("第 2 轮");
    expect(prompt).toContain("yolo_control");
    expect(prompt).toContain('action="complete"');
    expect(prompt).toContain('action="continue"');
    expect(prompt).toContain('action="blocked"');
  });

  it("协议修复模式标记不同 header", () => {
    const repairPrompt = buildAutopilotContinuePrompt("完成第一章", 3, true);

    expect(repairPrompt).toContain("YOLO 协议修复");
    expect(repairPrompt).toContain("不要继续执行新任务");
    expect(repairPrompt).toContain("yolo_control");
  });

  it("只有 yolo_control complete 工具结果会判定目标完成", () => {
    const completedPart: AgentPart = {
      type: "tool-call",
      toolName: YOLO_CONTROL_TOOL_ID,
      toolCallId: "mode-control-1",
      status: "completed",
      inputSummary: '{"action":"complete"}',
      output: {
        accepted: true,
        action: "complete",
        createdAt: "2026-05-10T00:00:00.000Z",
        evidence: ["已写回"],
        goal: "完成第一章",
        kind: YOLO_CONTROL_KIND,
        missing: [],
        reason: "完成",
        remaining: [],
        stateUpdated: true,
        verification: ["已读取验证"],
      },
    };

    expect(isAutopilotGoalCompleted([assistantWithParts([completedPart])])).toBe(true);
    expect(isAutopilotGoalCompleted([assistantWithParts([{
      ...completedPart,
      output: {
        data: completedPart.output,
        ok: true,
        summary: "autopilot 模式控制：已标记完成。",
      },
    }])])).toBe(true);
    expect(isAutopilotGoalCompleted([assistant("YOLO目标完成，文件已回写。")])).toBe(false);
    expect(isAutopilotGoalCompleted([assistant("目标未完成，下一轮动作是补状态。")])).toBe(false);
    expect(isAutopilotGoalCompleted([assistantWithParts([{
      ...completedPart,
      output: { ...(completedPart.output as Record<string, unknown>), action: "blocked" },
    }])])).toBe(false);
  });
});
