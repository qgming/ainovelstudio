import { describe, expect, it } from "vitest";
import { getRunStatusTone, isToolLikePart } from "./types";
import type { AgentPart } from "./types";

describe("agent domain", () => {
  it("识别工具相关 part", () => {
    const toolPart: AgentPart = {
      type: "tool-call",
      toolName: "read_file",
      toolCallId: "call-1",
      status: "completed",
      inputSummary: "读取当前活动章节",
    };
    const textPart: AgentPart = { type: "text", text: "一段文本" };

    expect(isToolLikePart(toolPart)).toBe(true);
    expect(isToolLikePart(textPart)).toBe(false);
  });

  it("为运行状态映射 UI tone", () => {
    expect(getRunStatusTone("running")).toBe("warning");
    expect(getRunStatusTone("completed")).toBe("success");
    expect(getRunStatusTone("failed")).toBe("danger");
    expect(getRunStatusTone("idle")).toBe("neutral");
  });
});
