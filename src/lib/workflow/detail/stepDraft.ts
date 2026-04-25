/**
 * 工作流节点草稿构造：根据用户切换的 step 类型推断默认字段。
 * 之前以 buildStepDraftForType 内联在 WorkflowDetailPage 中。
 */

import type {
  WorkflowDetail,
  WorkflowStepDefinition,
  WorkflowStepType,
} from "../types";
import { isMemberStep } from "./utils";

/**
 * 切换 step 类型时构造下一份草稿：尽量保留原节点上能继承的字段，
 * 不可继承的字段根据 detail 推断默认值。
 */
export function buildStepDraftForType(
  detail: WorkflowDetail,
  currentStep: WorkflowStepDefinition,
  nextType: WorkflowStepType,
  fallbackMemberId: string,
): WorkflowStepDefinition {
  const fallbackNextStepId =
    currentStep.type === "start"
      ? currentStep.nextStepId
      : currentStep.type === "agent_task"
        ? currentStep.nextStepId
        : currentStep.type === "decision"
          ? (currentStep.trueNextStepId ?? currentStep.falseNextStepId)
          : currentStep.loopTargetStepId;

  if (nextType === "start") {
    return {
      id: currentStep.id,
      workflowId: currentStep.workflowId,
      type: "start",
      name: currentStep.name,
      order: currentStep.order,
      nextStepId: fallbackNextStepId,
    };
  }

  if (nextType === "agent_task") {
    return {
      id: currentStep.id,
      workflowId: currentStep.workflowId,
      type: "agent_task",
      name: currentStep.name,
      order: currentStep.order,
      memberId: isMemberStep(currentStep) ? currentStep.memberId : fallbackMemberId,
      promptTemplate: isMemberStep(currentStep) ? currentStep.promptTemplate : "",
      outputMode: "text",
      nextStepId: fallbackNextStepId,
    };
  }

  if (nextType === "decision") {
    const sourceCandidates =
      detail.steps.filter(
        (item) => item.id !== currentStep.id && item.type === "agent_task",
      ) ?? [];
    return {
      id: currentStep.id,
      workflowId: currentStep.workflowId,
      type: "decision",
      name: currentStep.name,
      order: currentStep.order,
      memberId: isMemberStep(currentStep) ? currentStep.memberId : fallbackMemberId,
      promptTemplate: isMemberStep(currentStep) ? currentStep.promptTemplate : "",
      sourceStepId:
        currentStep.type === "decision"
          ? currentStep.sourceStepId
          : (sourceCandidates[0]?.id ?? ""),
      trueNextStepId:
        currentStep.type === "decision" ? currentStep.trueNextStepId : fallbackNextStepId,
      falseNextStepId: currentStep.type === "decision" ? currentStep.falseNextStepId : null,
    };
  }

  return {
    id: currentStep.id,
    workflowId: currentStep.workflowId,
    type: "end",
    name: currentStep.name,
    order: currentStep.order,
    stopReason: currentStep.type === "end" ? currentStep.stopReason : "completed",
    summaryTemplate: currentStep.type === "end" ? currentStep.summaryTemplate : "",
    loopBehavior: currentStep.type === "end" ? currentStep.loopBehavior : "finish",
    loopTargetStepId:
      currentStep.type === "end"
        ? currentStep.loopTargetStepId
        : (detail.steps[0]?.id ?? null),
  };
}
