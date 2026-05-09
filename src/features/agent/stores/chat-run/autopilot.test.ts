import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@features/agent/lib/types";
import {
  buildAutopilotContinuePrompt,
  isAutopilotGoalCompleted,
} from "./autopilot";

function assistant(text: string): AgentMessage {
  return {
    author: "主代理",
    id: "assistant-1",
    parts: [{ text, type: "text" }],
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
    expect(prompt).toContain("YOLO目标完成");
  });

  it("只有完成标记且没有未完成信号时判定目标完成", () => {
    expect(isAutopilotGoalCompleted([assistant("YOLO目标完成，文件已回写。")])).toBe(true);
    expect(isAutopilotGoalCompleted([assistant("目标已完成，文件已回写。")])).toBe(true);
    expect(isAutopilotGoalCompleted([assistant("目标未完成，下一轮动作是补状态。")])).toBe(false);
    expect(isAutopilotGoalCompleted([assistant("YOLO目标完成前，还需要继续执行。")])).toBe(false);
  });
});
