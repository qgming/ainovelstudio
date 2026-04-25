/**
 * 工作流引擎纯查询函数：基于 detail / stepRun 做不变查询。
 * 拆出避免 engine.ts 既存数据获取又含主流程。
 */

import { useAgentSettingsStore } from "../../stores/agentSettingsStore";
import { getResolvedAgents, useSubAgentStore } from "../../stores/subAgentStore";
import { createId, getNow } from "./runtimeTypes";
import type {
  WorkflowDetail,
  WorkflowRun,
  WorkflowStartStepDefinition,
  WorkflowStepDefinition,
  WorkflowStepRun,
  WorkflowTeamMember,
} from "./types";

/** 按 ID 取步骤定义。 */
export function getStepById(detail: WorkflowDetail, stepId: string | null): WorkflowStepDefinition | null {
  if (!stepId) return null;
  return detail.steps.find((item) => item.id === stepId) ?? null;
}

/** 按 ID 取团队成员。 */
export function getTeamMemberById(
  detail: WorkflowDetail,
  memberId: string | null,
): WorkflowTeamMember | null {
  if (!memberId) return null;
  return detail.teamMembers.find((item) => item.id === memberId) ?? null;
}

/** 按 agentId 取已校验通过的代理。 */
export function resolveWorkflowAgent(agentId: string) {
  return (
    getResolvedAgents(useSubAgentStore.getState()).find(
      (item) => item.id === agentId && item.validation.isValid,
    ) ?? null
  );
}

/** 找到工作流的初始步骤；若无 start 节点退化为 steps[0]。 */
export function resolveInitialStep(detail: WorkflowDetail): WorkflowStepDefinition | null {
  return (
    detail.steps.find(
      (step): step is WorkflowStartStepDefinition => step.type === "start",
    ) ??
    detail.steps[0] ??
    null
  );
}

/** 构造一次新的 run 初始结构。 */
export function buildInitialRun(detail: WorkflowDetail): WorkflowRun {
  const workflow = detail.workflow;
  if (!workflow.workspaceBinding) {
    throw new Error("工作流尚未绑定书籍工作区。");
  }
  return {
    id: createId("workflow-run"),
    workflowId: workflow.id,
    status: "running",
    startedAt: getNow(),
    finishedAt: null,
    workspaceBinding: workflow.workspaceBinding,
    loopConfigSnapshot: workflow.loopConfig,
    currentLoopIndex: 1,
    maxLoops: workflow.loopConfig.maxLoops,
    currentStepRunId: null,
    stopReason: null,
    summary: null,
    errorMessage: null,
  };
}

/**
 * 计算当前成员真正可用的工具 ID 列表：
 *   - 全局启用的工具集合
 *   - 与成员 allowedToolIds 求交集（成员未声明则等同全局集合）
 *   - 强制叠加 forcedToolIds（如 decision 节点强行加 workflow_decision）
 */
export function getEnabledToolIds(
  member: WorkflowTeamMember,
  forcedToolIds: string[] = [],
): string[] {
  const enabledToolsMap = useAgentSettingsStore.getState().enabledTools;
  const globallyEnabledToolIds = Object.entries(enabledToolsMap)
    .filter(([, enabled]) => enabled)
    .map(([toolId]) => toolId);

  const baseToolIds =
    !member.allowedToolIds || member.allowedToolIds.length === 0
      ? globallyEnabledToolIds
      : globallyEnabledToolIds.filter((toolId) => member.allowedToolIds?.includes(toolId));

  return Array.from(new Set([...baseToolIds, ...forcedToolIds]));
}

/** 找到下一个可继续运行（paused / failed）的 run。 */
export function findResumableRun(detail: WorkflowDetail, runId?: string | null): WorkflowRun | null {
  if (runId) {
    const run = detail.runs.find((item) => item.id === runId);
    if (run?.status === "paused" || run?.status === "failed") {
      return run;
    }
  }
  return detail.runs.find((run) => run.status === "paused" || run.status === "failed") ?? null;
}

/** 是否已完成的 step run。 */
export function isCompletedStepRun(stepRun: WorkflowStepRun): boolean {
  return stepRun.status === "completed";
}

/** 按 loopIndex / attemptIndex / startedAt / id 顺序排序，便于回放推断。 */
export function sortStepRunsForReplay(stepRuns: WorkflowStepRun[]): WorkflowStepRun[] {
  return [...stepRuns].sort(
    (left, right) =>
      left.loopIndex - right.loopIndex ||
      left.attemptIndex - right.attemptIndex ||
      (left.startedAt ?? 0) - (right.startedAt ?? 0) ||
      left.id.localeCompare(right.id),
  );
}
