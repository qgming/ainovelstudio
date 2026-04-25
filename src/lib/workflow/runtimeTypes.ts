/**
 * 工作流引擎共用的运行时类型与小工具：
 * - WorkflowRuntimeState：单次运行的循环状态
 * - WorkflowCursor：游标
 * - createId / getNow：ID 与时间戳生成
 * - WORKFLOW_DECISION_TOOL_ID：判断节点工具名
 *
 * 这些定义被 selectors / decision / runtime / engine 多处共用，集中维护避免重复。
 */

import type {
  WorkflowDecisionResult,
  WorkflowMessagePayload,
  WorkflowReviewResult,
  WorkflowStepDefinition,
  WorkflowStepRun,
} from "./types";

export const WORKFLOW_DECISION_TOOL_ID = "workflow_decision";

export type StepMessage = {
  messageType: string;
  messageJson: WorkflowMessagePayload;
};

export type WorkflowRuntimeState = {
  loopIndex: number;
  attemptIndex: number;
  latestStepRunsByStepId: Map<string, WorkflowStepRun>;
  latestMessageByType: Map<string, WorkflowMessagePayload>;
  lastReviewResult: WorkflowReviewResult | null;
  lastDecision: WorkflowStepRun["decision"];
};

export type WorkflowRunMode = "resume" | "start";

export type WorkflowCursor = {
  currentStep: WorkflowStepDefinition | null;
  previousAgentStepRun: WorkflowStepRun | null;
};

export type ChapterWriteMode = "new_chapter" | "rework_current_chapter";

/** 生成带前缀的唯一 ID，优先使用 crypto.randomUUID。 */
export function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 当前时间戳。包装一层便于测试 mock。 */
export function getNow(): number {
  return Date.now();
}

/** 是否为 abort 异常。 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** 是否仍有可执行轮次。null = 无上限。 */
export function hasRemainingLoops(maxLoops: number | null, nextLoopIndex: number): boolean {
  return maxLoops === null || nextLoopIndex <= maxLoops;
}

// 重新导出 WorkflowDecisionResult 以方便消费者按层导入。
export type { WorkflowDecisionResult };
