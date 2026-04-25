/**
 * 工作流运行态变更：在 step 完成后把结果写回 runtime；在切换轮次/恢复时重置或修复运行态。
 */

import { normalizeRecoveredMessageParts } from "../chat/sessionRuntime";
import { getNow, type WorkflowRuntimeState } from "./runtimeTypes";
import type {
  WorkflowMessagePayload,
  WorkflowReviewResult,
  WorkflowStepRun,
} from "./types";

/** 进入下一轮循环前清理运行态：保留 loopIndex，重置 attempt 与上次累积的消息/结果。 */
export function resetRuntimeForNextLoop(runtime: WorkflowRuntimeState): void {
  runtime.attemptIndex = 1;
  runtime.latestStepRunsByStepId.clear();
  runtime.latestMessageByType.clear();
  runtime.lastReviewResult = null;
  runtime.lastDecision = null;
}

/**
 * 把一次 step 完成的结果合并进 runtime：
 *   - 记录最近的同步结构化结果（review_result / decision）
 *   - 提取 revision_brief 作为下一步可消费的消息
 *   - 把自定义 messageType 写入 latestMessageByType
 */
export function updateRuntimeFromStepRun(
  runtime: WorkflowRuntimeState,
  stepRun: WorkflowStepRun,
): void {
  runtime.latestStepRunsByStepId.set(stepRun.stepId, stepRun);
  runtime.lastDecision = stepRun.decision;

  if (stepRun.resultJson) {
    runtime.lastReviewResult = stepRun.resultJson;
    runtime.latestMessageByType.set(
      "review_result",
      stepRun.resultJson as unknown as WorkflowMessagePayload,
    );
    if (stepRun.resultJson.revision_brief.trim()) {
      runtime.latestMessageByType.set("revision_brief", {
        revision_brief: stepRun.resultJson.revision_brief,
        issues: stepRun.resultJson.issues,
      });
    }
  }

  if (stepRun.decisionResultJson) {
    if (
      stepRun.decisionResultJson.issues.length > 0 ||
      stepRun.decisionResultJson.revision_brief.trim()
    ) {
      const reviewResult: WorkflowReviewResult = {
        pass: stepRun.decisionResultJson.pass,
        issues: stepRun.decisionResultJson.issues,
        revision_brief: stepRun.decisionResultJson.revision_brief,
      };
      runtime.lastReviewResult = reviewResult;
      runtime.latestMessageByType.set(
        "review_result",
        reviewResult as unknown as WorkflowMessagePayload,
      );
      runtime.latestMessageByType.set("revision_brief", {
        revision_brief: reviewResult.revision_brief,
        issues: reviewResult.issues,
      });
    }
  }

  if (stepRun.messageType && stepRun.messageJson) {
    runtime.latestMessageByType.set(stepRun.messageType, stepRun.messageJson);
  }
}

/**
 * 恢复运行时把仍处于 running 状态的 step run 修复为 failed，
 * 否则会被误认为仍在执行。
 */
export function normalizeInterruptedStepRun(stepRun: WorkflowStepRun): WorkflowStepRun {
  if (stepRun.status !== "running") return stepRun;
  return {
    ...stepRun,
    errorMessage: stepRun.errorMessage ?? "执行被中断，继续时会重新执行该步骤。",
    finishedAt: stepRun.finishedAt ?? getNow(),
    parts: normalizeRecoveredMessageParts(stepRun.parts),
    status: "failed",
  };
}
