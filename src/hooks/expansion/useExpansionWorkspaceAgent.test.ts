import { describe, expect, it } from "vitest";
import type { AgentPart } from "../../lib/agent/types";
import {
  buildRequiredToolRetryPrompt,
  hasCompletedRequiredExpansionToolCall,
} from "./useExpansionWorkspaceAgent";

function buildCompletedToolCall(toolName: string): AgentPart {
  return {
    type: "tool-call",
    toolCallId: `${toolName}-1`,
    toolName,
    status: "completed",
    inputSummary: "{}",
  };
}

describe("hasCompletedRequiredExpansionToolCall", () => {
  it("批量生成细纲在缺少必需工具时返回 false", () => {
    expect(
      hasCompletedRequiredExpansionToolCall("project-batch-outline", [
        buildCompletedToolCall("read"),
      ]),
    ).toBe(false);
  });

  it("批量生成细纲在章节批量工具成功后返回 true", () => {
    expect(
      hasCompletedRequiredExpansionToolCall("project-batch-outline", [
        buildCompletedToolCall("expansion_chapter_batch_outline"),
      ]),
    ).toBe(true);
  });

  it("批量生成设定在设定批量工具成功后返回 true", () => {
    expect(
      hasCompletedRequiredExpansionToolCall("project-batch-settings", [
        buildCompletedToolCall("expansion_setting_batch_generate"),
      ]),
    ).toBe(true);
  });

  it("自由输入不强制要求特定写回工具", () => {
    expect(hasCompletedRequiredExpansionToolCall("free-input", [])).toBe(true);
  });

  it("批量细纲重试提示会要求直接分批调用工具", () => {
    const retryPrompt = buildRequiredToolRetryPrompt(
      "project-batch-outline",
      "原始提示",
      [{ type: "text", text: "Now let me batch generate the 60 chapter outlines." }],
    );

    expect(retryPrompt).toContain("每批最多 20 章");
    expect(retryPrompt).toContain("直接开始工具调用");
    expect(retryPrompt).toContain("expansion_chapter_batch_outline");
    expect(retryPrompt).toContain("expansion_chapter_write_content");
  });
});
