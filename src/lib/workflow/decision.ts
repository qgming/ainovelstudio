/**
 * 工作流判断节点：把 LLM 输出的判定结果（pass/issues/revision_brief）解析成结构化对象。
 */

import type { AgentPart } from "../agent/types";
import { WORKFLOW_DECISION_TOOL_ID } from "./runtimeTypes";
import type {
  WorkflowDecisionResult,
  WorkflowReviewIssue,
  WorkflowStepDefinition,
} from "./types";

/** 把任意值规范化为 WorkflowReviewIssue；非法返回 null。 */
function normalizeWorkflowReviewIssue(value: unknown): WorkflowReviewIssue | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;

  const payload = value as Record<string, unknown>;
  const type = typeof payload.type === "string" ? payload.type.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!type || !message) return null;

  const severityValue = typeof payload.severity === "string" ? payload.severity.trim() : "";
  const severity: WorkflowReviewIssue["severity"] =
    severityValue === "low" || severityValue === "medium" || severityValue === "high"
      ? severityValue
      : "medium";

  return { type, severity, message };
}

/** 把 tool 输出规范化为 WorkflowDecisionResult；任何字段不合法返回 null。 */
export function normalizeWorkflowDecisionResult(value: unknown): WorkflowDecisionResult | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (typeof payload.pass !== "boolean") return null;
  if (typeof payload.reason !== "string" || !payload.reason.trim()) return null;
  if (!Array.isArray(payload.issues)) return null;
  if (typeof payload.revision_brief !== "string") return null;

  const issues = payload.issues
    .map((issue) => normalizeWorkflowReviewIssue(issue))
    .filter((issue): issue is WorkflowReviewIssue => Boolean(issue));

  return {
    pass: payload.pass,
    label: payload.pass ? "yes" : "no",
    reason: payload.reason.trim(),
    issues,
    revision_brief: payload.revision_brief.trim(),
  };
}

/** 从 parts 反向扫描 workflow_decision 工具的最近一次完成结果。 */
export function extractWorkflowDecisionResult(parts: AgentPart[]): WorkflowDecisionResult | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (
      (part.type === "tool-call" || part.type === "tool-result") &&
      part.toolName === WORKFLOW_DECISION_TOOL_ID &&
      part.status === "completed"
    ) {
      const result = normalizeWorkflowDecisionResult(part.output);
      if (result) return result;
    }
  }
  return null;
}

/** 强制要求 decision 节点拿到结构化结果，缺失则报错。 */
export function requireWorkflowDecisionResult(
  step: Extract<WorkflowStepDefinition, { type: "decision" }>,
  directResult: WorkflowDecisionResult | null,
  parts: AgentPart[],
): WorkflowDecisionResult {
  const decisionResult = directResult ?? extractWorkflowDecisionResult(parts);
  if (!decisionResult) {
    throw new Error(
      `判断节点《${step.name}》缺少结构化判定结果，请补充通过结论、问题列表和修订摘要后重试。`,
    );
  }
  return decisionResult;
}
