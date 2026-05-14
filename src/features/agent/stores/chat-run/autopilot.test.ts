import { describe, expect, it } from "vitest";
import {
  MODE_CONTROL_KIND,
  MODE_CONTROL_TOOL_ID,
} from "@features/agent/lib/modeControl";
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
  it("自动续跑提示要求读取资料并执行工作流", () => {
    const prompt = buildAutopilotContinuePrompt("完成第一章", 2);

    expect(prompt).toContain("YOLO 自动检查");
    expect(prompt).toContain("读取相关资料");
    expect(prompt).toContain("Inspect -> Skill Load -> Plan -> Act -> Verify -> State Maintain -> Report");
    expect(prompt).toContain("SKILL.md");
    expect(prompt).toContain("run_control");
    expect(prompt).toContain('action="complete"');
  });

  it("只有 run_control complete 工具结果会判定目标完成", () => {
    const completedPart: AgentPart = {
      type: "tool-call",
      toolName: MODE_CONTROL_TOOL_ID,
      toolCallId: "mode-control-1",
      status: "completed",
      inputSummary: '{"mode":"autopilot","action":"complete"}',
      output: {
        kind: MODE_CONTROL_KIND,
        mode: "autopilot",
        action: "complete",
        createdAt: "2026-05-10T00:00:00.000Z",
      },
    };

    expect(isAutopilotGoalCompleted([assistantWithParts([completedPart])])).toBe(true);
    expect(isAutopilotGoalCompleted([assistant("YOLO目标完成，文件已回写。")])).toBe(false);
    expect(isAutopilotGoalCompleted([assistant("目标未完成，下一轮动作是补状态。")])).toBe(false);
    expect(isAutopilotGoalCompleted([assistantWithParts([{
      ...completedPart,
      output: { ...(completedPart.output as Record<string, unknown>), action: "blocked" },
    }])])).toBe(false);
  });
});
