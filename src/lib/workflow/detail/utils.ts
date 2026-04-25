/**
 * 工作流详情页公共纯函数：日期格式、loop 草稿、绑定对比、step 节点格式化等。
 *
 * 之前内联在 WorkflowDetailPage 顶部 ~100 行，与组件状态混杂。
 */

import type {
  WorkflowLoopConfig,
  WorkflowStepDefinition,
  WorkflowTeamMember,
  WorkflowWorkspaceBinding,
} from "../types";

/** 把任意错误转成中文用户文本。 */
export function getReadableError(error: unknown, fallback = "操作失败，请重试。"): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

/** 把毫秒时间戳格式化为 zh-CN 简短形式；空值显示 "—"。 */
export function formatDateTime(value: number | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/** 把 loopConfig 转成草稿对象（区分有限/无限模式）。 */
export function buildLoopDraft(loopConfig: WorkflowLoopConfig) {
  return {
    maxLoopsMode: loopConfig.maxLoops === null ? "infinite" : "finite",
    maxLoopsValue: loopConfig.maxLoops === null ? "1" : String(loopConfig.maxLoops),
  } as const;
}

/** 把 binding 简化为 dirty 比对友好的形状；null 仍返回 null。 */
export function stripWorkspaceBinding(binding: WorkflowWorkspaceBinding | null) {
  if (!binding) return null;
  return {
    bookId: binding.bookId,
    rootPath: binding.rootPath,
    bookName: binding.bookName,
  };
}

/** 比对两个简化绑定是否等价。 */
export function isSameWorkspaceBinding(
  left: ReturnType<typeof stripWorkspaceBinding>,
  right: ReturnType<typeof stripWorkspaceBinding>,
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return (
    left.bookId === right.bookId &&
    left.rootPath === right.rootPath &&
    left.bookName === right.bookName
  );
}

/** 把 loop 草稿值规范化：infinite → null，否则取 >0 整数（默认 1）。 */
export function normalizeLoopValue(mode: "finite" | "infinite", value: string): number | null {
  if (mode === "infinite") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** 类型守卫：是否为带成员的 step（agent_task / decision）。 */
export function isMemberStep(
  step: WorkflowStepDefinition,
): step is Extract<WorkflowStepDefinition, { type: "agent_task" | "decision" }> {
  return step.type === "agent_task" || step.type === "decision";
}

/** 在成员列表中按 id 查找；空 id 返回 null。 */
export function getMemberById(
  members: WorkflowTeamMember[],
  memberId: string | null,
): WorkflowTeamMember | null {
  if (!memberId) return null;
  return members.find((item) => item.id === memberId) ?? null;
}

/** 为隐藏成员构造默认名："{agentName} 节点"，重复时追加序号。 */
export function buildHiddenMemberName(
  agentName: string,
  members: WorkflowTeamMember[],
): string {
  const count = members.filter((item) => item.name.startsWith(`${agentName} 节点`)).length + 1;
  return count === 1 ? `${agentName} 节点` : `${agentName} 节点 ${count}`;
}

/** 格式化节点连线提示文本（用于工作流构建器列表中显示）。 */
export function formatStepLinks(
  step: WorkflowStepDefinition,
  steps: WorkflowStepDefinition[],
): string {
  const nameById = new Map(steps.map((item) => [item.id, item.name]));
  if (step.type === "start") {
    return `下一步：${step.nextStepId ? (nameById.get(step.nextStepId) ?? "未命名节点") : "结束"}`;
  }
  if (step.type === "agent_task") {
    return `下一步：${step.nextStepId ? (nameById.get(step.nextStepId) ?? "未命名节点") : "结束"}`;
  }
  if (step.type === "decision") {
    const trueLabel = step.trueNextStepId
      ? (nameById.get(step.trueNextStepId) ?? "未命名节点")
      : "结束";
    const falseLabel = step.falseNextStepId
      ? (nameById.get(step.falseNextStepId) ?? "未命名节点")
      : "结束";
    return `通过/是 → ${trueLabel} / 不通过/否 → ${falseLabel}`;
  }
  const loopLabel =
    step.loopBehavior === "continue_if_possible"
      ? ` / 有下一轮时回到 ${step.loopTargetStepId ? (nameById.get(step.loopTargetStepId) ?? "未命名节点") : "未设置"}`
      : "";
  return `结束：${step.stopReason}${loopLabel}`;
}
