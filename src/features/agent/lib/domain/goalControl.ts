import type { AgentMessage, AgentPart } from "../types";

export const GOAL_CONTROL_TOOL_ID = "goal_control";
export const GOAL_CONTROL_KIND = "goal-control";

export type GoalControlAction = "complete" | "continue" | "blocked";

export type GoalStatus = "active" | "budget_limited" | "blocked" | "complete";

export type GoalUsage = {
  activeSeconds: number;
  tokensUsed: number;
};

export type GoalRuntimeState = {
  auditFailures: string[];
  blockedCount: number;
  blockedSignature?: string;
  budgetLimitNotified: boolean;
  completedAt?: string;
  createdAt: string;
  goalId: string;
  lastControl?: GoalControlData;
  objective: string;
  status: GoalStatus;
  tokenBudget: number | null;
  updatedAt: string;
  usage: GoalUsage;
};

export type GoalControlData = {
  accepted: boolean;
  action: GoalControlAction;
  audit: string[];
  createdAt: string;
  evidence: string[];
  goal: string;
  kind: typeof GOAL_CONTROL_KIND;
  /** 阻断性问题:goal / reason / blocked.requiredUserAction 缺失。 */
  missing: string[];
  /** 软性提醒:complete 缺 evidence/verification/stateUpdated 等。不阻断流程。 */
  warnings: string[];
  nextAction?: string;
  reason: string;
  remaining: string[];
  requiredUserAction?: string;
  stateUpdated: boolean;
  verification: string[];
};

type ToolResultEnvelope = {
  data?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

function normalizeString(value: unknown, fallback = "") {
  return normalizeOptionalString(value) ?? fallback;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function normalizeBoolean(value: unknown) {
  return value === true || value === "true";
}

function normalizeAction(value: unknown): GoalControlAction {
  if (value === "complete" || value === "continue" || value === "blocked") return value;
  return "continue";
}

export function getCompletionAuditFailures(data: Pick<GoalControlData, "action" | "audit" | "evidence" | "remaining" | "stateUpdated" | "verification">) {
  if (data.action !== "complete") return [];
  const failures: string[] = [];
  if (data.audit.length === 0) failures.push("complete 缺少完成审计 audit。");
  if (data.evidence.length === 0) failures.push("complete 缺少完成证据 evidence。");
  if (data.verification.length === 0) failures.push("complete 缺少验证结果 verification。");
  if (!data.stateUpdated) failures.push("complete 未声明 stateUpdated=true。");
  if (data.remaining.length > 0) failures.push("complete 时 remaining 应为空。");
  return failures;
}

function validateGoalControl(data: Omit<GoalControlData, "accepted" | "createdAt" | "kind" | "missing" | "warnings">) {
  const missing: string[] = [];   // 阻断:导致 accepted = false
  const warnings: string[] = [];  // 软提示:不阻断,前端可展示但仍接受

  // 任何 action 都必填的最小硬约束
  if (!data.goal.trim()) missing.push("goal 不能为空。");
  if (!data.reason.trim()) missing.push("reason 不能为空。");

  // complete 的字段校验保持为软警告，避免整轮被工具拒绝后丢失已有证据；
  // 续轮提示词会把这些 warning 重新带回完成审计。
  if (data.action === "complete") {
    warnings.push(...getCompletionAuditFailures(data));
  }

  // continue 的辅助字段降级为软警告
  if (data.action === "continue") {
    if (data.remaining.length === 0) warnings.push("continue 缺少 remaining。");
    if (!data.nextAction?.trim()) warnings.push("continue 缺少 nextAction。");
  }

  // blocked 的 requiredUserAction 保持硬约束(否则用户不知道要做什么)
  if (data.action === "blocked") {
    if (!data.requiredUserAction?.trim()) missing.push("blocked.requiredUserAction 不能为空。");
  }

  return { missing, warnings };
}

export function createGoalControlData(input: Record<string, unknown>): GoalControlData {
  const action = normalizeAction(input.action);
  const data = {
    action,
    audit: normalizeStringArray(input.audit),
    evidence: normalizeStringArray(input.evidence),
    goal: normalizeString(input.goal, "未指定"),
    nextAction: normalizeOptionalString(input.nextAction),
    reason: normalizeString(input.reason),
    remaining: normalizeStringArray(input.remaining),
    requiredUserAction: normalizeOptionalString(input.requiredUserAction),
    stateUpdated: normalizeBoolean(input.stateUpdated),
    verification: normalizeStringArray(input.verification),
  };
  const { missing, warnings } = validateGoalControl(data);

  return {
    ...data,
    accepted: missing.length === 0,
    createdAt: new Date().toISOString(),
    kind: GOAL_CONTROL_KIND,
    missing,
    warnings,
  };
}

function createGoalId() {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createGoalRuntimeState(objective: string, tokenBudget: number | null = null): GoalRuntimeState {
  const now = new Date().toISOString();
  return {
    auditFailures: [],
    blockedCount: 0,
    budgetLimitNotified: false,
    createdAt: now,
    goalId: createGoalId(),
    objective: objective.trim() || "未指定",
    status: "active",
    tokenBudget,
    updatedAt: now,
    usage: { activeSeconds: 0, tokensUsed: 0 },
  };
}

export function formatGoalBudget(state: Pick<GoalRuntimeState, "tokenBudget" | "usage">) {
  if (state.tokenBudget === null) return "无限制";
  return `${state.usage.tokensUsed}/${state.tokenBudget} tokens，剩余 ${Math.max(0, state.tokenBudget - state.usage.tokensUsed)}`;
}

export function applyGoalUsage(
  state: GoalRuntimeState,
  tokensDelta: number,
  activeSecondsDelta: number,
): { crossedBudget: boolean; state: GoalRuntimeState } {
  const tokens = Math.max(0, Math.trunc(tokensDelta));
  const seconds = Math.max(0, Math.trunc(activeSecondsDelta));
  const wasUnderBudget = state.tokenBudget === null || state.usage.tokensUsed < state.tokenBudget;
  const usage = {
    activeSeconds: state.usage.activeSeconds + seconds,
    tokensUsed: state.usage.tokensUsed + tokens,
  };
  const crossedBudget = state.status === "active"
    && state.tokenBudget !== null
    && wasUnderBudget
    && usage.tokensUsed >= state.tokenBudget;
  return {
    crossedBudget,
    state: {
      ...state,
      budgetLimitNotified: crossedBudget ? false : state.budgetLimitNotified,
      status: crossedBudget ? "budget_limited" : state.status,
      updatedAt: new Date().toISOString(),
      usage,
    },
  };
}

export function markGoalBudgetLimitNotified(state: GoalRuntimeState): GoalRuntimeState {
  return {
    ...state,
    budgetLimitNotified: true,
    updatedAt: new Date().toISOString(),
  };
}

export function applyGoalControl(
  state: GoalRuntimeState,
  control: GoalControlData | null,
): GoalRuntimeState {
  if (!control) {
    return {
      ...state,
      auditFailures: ["本轮未调用 goal_control，目标协议缺失。"],
      updatedAt: new Date().toISOString(),
    };
  }

  const auditFailures = getCompletionAuditFailures(control);
  const now = new Date().toISOString();
  const blockedSignature = control.accepted && control.action === "blocked"
    ? `${control.reason}\n${control.requiredUserAction ?? ""}`.trim()
    : undefined;
  const blockedCount = blockedSignature
    ? state.blockedSignature === blockedSignature ? state.blockedCount + 1 : 1
    : 0;
  const next: GoalRuntimeState = {
    ...state,
    auditFailures,
    blockedCount,
    blockedSignature,
    lastControl: control,
    updatedAt: now,
  };

  if (control.accepted && control.action === "complete" && auditFailures.length === 0) {
    return { ...next, completedAt: now, status: "complete" };
  }
  if (control.accepted && control.action === "blocked") {
    return { ...next, status: next.blockedCount >= 3 ? "blocked" : "active" };
  }
  if (state.status === "budget_limited") return next;
  return { ...next, status: "active" };
}

export function summarizeGoalControl(data: GoalControlData) {
  if (!data.accepted) return `目标检查未通过：${data.missing.join("；")}`;
  const suffix = data.warnings.length > 0 ? `（提示：${data.warnings.join("；")}）` : "";
  if (data.action === "complete") return `目标已完成：${data.reason}${suffix}`;
  if (data.action === "blocked") return `目标已阻塞：${data.reason}${suffix}`;
  return `目标继续执行：${data.nextAction ?? data.reason}${suffix}`;
}

export function isGoalControlData(value: unknown): value is GoalControlData {
  if (!isRecord(value)) return false;
  return value.kind === GOAL_CONTROL_KIND
    && typeof value.action === "string"
    && typeof value.accepted === "boolean"
    && typeof value.createdAt === "string";
}

/** 兼容旧版本(无 warnings 字段)持久化数据,返回时补齐空数组。 */
function ensureWarnings(value: GoalControlData): GoalControlData {
  if (Array.isArray((value as { warnings?: unknown }).warnings)) return value;
  return { ...value, warnings: [] };
}

export function extractGoalControlData(output: unknown): GoalControlData | null {
  if (isGoalControlData(output)) return ensureWarnings(output);
  if (!isRecord(output)) return null;
  const envelope = output as ToolResultEnvelope;
  return isGoalControlData(envelope.data) ? ensureWarnings(envelope.data) : null;
}

export function isGoalControlCompletionPart(part: AgentPart) {
  if (part.type !== "tool-call" && part.type !== "tool-result") return false;
  return part.toolName === GOAL_CONTROL_TOOL_ID
    && part.status === "completed"
    && Boolean(extractGoalControlData(part.output)?.accepted)
    && extractGoalControlData(part.output)?.action === "complete";
}

export function getGoalControlDataFromPart(part: AgentPart) {
  if ((part.type !== "tool-call" && part.type !== "tool-result") || part.toolName !== GOAL_CONTROL_TOOL_ID) {
    return null;
  }
  return extractGoalControlData(part.output);
}

export function deriveLatestGoalControl(messages: AgentMessage[]) {
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      const data = getGoalControlDataFromPart(part);
      if (data) return data;
    }
  }
  return null;
}

export function getLatestAssistantGoalControl(messages: AgentMessage[]) {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistant) return null;
  for (const part of [...assistant.parts].reverse()) {
    const data = getGoalControlDataFromPart(part);
    if (data) return data;
  }
  return null;
}
