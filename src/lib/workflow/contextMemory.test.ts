import { describe, expect, it } from "vitest";
import { buildWorkflowDeltaMemory } from "./contextMemory";

describe("workflow context memory", () => {
  it("会把上一结果、审查结果和结构化消息裁成预算内的 delta memory", () => {
    const memory = buildWorkflowDeltaMemory({
      incomingMessages: [
        {
          type: "revision_brief",
          payload: {
            revision_brief: "加强主角犹豫与章末钩子。",
            issues: [{ severity: "high", type: "hook", message: "章末吸引力不足" }],
          },
        },
        {
          type: "scene_plan",
          payload: {
            beats: Array.from({ length: 10 }, (_, index) => `beat-${index}`).join(", "),
          },
        },
      ],
      previousResult: `上一章结果\n${"正文结果 ".repeat(300)}`,
      reviewResult: {
        pass: false,
        revision_brief: "压缩解释段，补强动作反应。",
        issues: [
          { message: "解释过多", severity: "high", type: "pacing" },
          { message: "动作反应偏弱", severity: "medium", type: "scene" },
        ],
      },
    });

    expect(memory.usedChars).toBeLessThanOrEqual(3200);
    expect(memory.text).toContain("## 上一步增量记忆");
    expect(memory.text).toContain("## 返修与审查增量");
    expect(memory.text).toContain("## 结构化协作增量");
    expect(memory.text).toContain("revision_brief");
  });

  it("会优先保留 revision_brief 等高价值消息", () => {
    const memory = buildWorkflowDeltaMemory({
      incomingMessages: [
        { type: "misc_2", payload: { note: "后置消息" } },
        { type: "review_result", payload: { pass: false, issues: [] } },
        { type: "revision_brief", payload: { revision_brief: "先修钩子" } },
      ],
      maxChars: 800,
    });

    const revisionIndex = memory.text.indexOf("revision_brief");
    const miscIndex = memory.text.indexOf("misc_2");
    expect(revisionIndex).toBeGreaterThanOrEqual(0);
    expect(miscIndex).toBeGreaterThanOrEqual(0);
    expect(revisionIndex).toBeLessThan(miscIndex);
  });
});
