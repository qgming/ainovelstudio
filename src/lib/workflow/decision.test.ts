import { describe, expect, it } from "vitest";
import {
  extractWorkflowDecisionResult,
  normalizeWorkflowDecisionResult,
  requireWorkflowDecisionResult,
} from "./decision";
import type { AgentPart } from "../agent/types";
import type { WorkflowDecisionStepDefinition } from "./types";

describe("normalizeWorkflowDecisionResult", () => {
  it("接受合法对象", () => {
    const result = normalizeWorkflowDecisionResult({
      pass: false,
      reason: "  内容雷同  ",
      issues: [
        { type: "continuity", severity: "high", message: "时间线断裂" },
        { type: "logic", severity: "weird", message: "" }, // 非法 severity / 空 message
      ],
      revision_brief: "  补足铺垫  ",
    });
    expect(result).not.toBeNull();
    expect(result?.pass).toBe(false);
    expect(result?.label).toBe("no");
    expect(result?.reason).toBe("内容雷同");
    expect(result?.revision_brief).toBe("补足铺垫");
    expect(result?.issues).toHaveLength(1); // 第二条因 message 空被丢弃
    expect(result?.issues[0].severity).toBe("high");
  });

  it("非对象 / 缺字段时返回 null", () => {
    expect(normalizeWorkflowDecisionResult(null)).toBeNull();
    expect(normalizeWorkflowDecisionResult([])).toBeNull();
    expect(normalizeWorkflowDecisionResult({ pass: "yes" })).toBeNull();
    expect(normalizeWorkflowDecisionResult({ pass: true, reason: "", issues: [], revision_brief: "" })).toBeNull();
  });

  it("severity 缺省值兜底为 medium", () => {
    const result = normalizeWorkflowDecisionResult({
      pass: true,
      reason: "ok",
      issues: [{ type: "x", message: "y" }],
      revision_brief: "",
    });
    expect(result?.issues[0].severity).toBe("medium");
  });
});

describe("extractWorkflowDecisionResult", () => {
  it("从 parts 反向找到最近的 workflow_decision tool-result", () => {
    const parts: AgentPart[] = [
      {
        type: "tool-result",
        toolName: "workflow_decision",
        toolCallId: "old",
        status: "completed",
        output: { pass: true, reason: "ok", issues: [], revision_brief: "" },
        result: {},
      } as unknown as AgentPart,
      {
        type: "tool-result",
        toolName: "workflow_decision",
        toolCallId: "latest",
        status: "completed",
        output: { pass: false, reason: "fail", issues: [], revision_brief: "redo" },
        result: {},
      } as unknown as AgentPart,
    ];
    const found = extractWorkflowDecisionResult(parts);
    expect(found?.pass).toBe(false);
    expect(found?.revision_brief).toBe("redo");
  });

  it("无任何符合的 tool-result 时返回 null", () => {
    expect(extractWorkflowDecisionResult([])).toBeNull();
  });
});

describe("requireWorkflowDecisionResult", () => {
  const decisionStep = { name: "质检" } as WorkflowDecisionStepDefinition;

  it("有结果时直接返回", () => {
    const direct = {
      pass: true,
      label: "yes" as const,
      reason: "ok",
      issues: [],
      revision_brief: "",
    };
    expect(requireWorkflowDecisionResult(decisionStep, direct, [])).toBe(direct);
  });

  it("缺失时抛中文错误", () => {
    expect(() => requireWorkflowDecisionResult(decisionStep, null, [])).toThrow(
      /判断节点《质检》缺少结构化判定结果/,
    );
  });
});
