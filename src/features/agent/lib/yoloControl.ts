import type { AgentMessage, AgentPart } from "./types";

export const YOLO_CONTROL_TOOL_ID = "yolo_control";
export const YOLO_CONTROL_KIND = "yolo-control";

export type YoloControlAction = "complete" | "continue" | "blocked";

export type YoloControlData = {
  accepted: boolean;
  action: YoloControlAction;
  createdAt: string;
  evidence: string[];
  goal: string;
  kind: typeof YOLO_CONTROL_KIND;
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

function normalizeAction(value: unknown): YoloControlAction {
  if (value === "complete" || value === "continue" || value === "blocked") return value;
  return "continue";
}

function validateYoloControl(data: Omit<YoloControlData, "accepted" | "createdAt" | "kind" | "missing" | "warnings">) {
  const missing: string[] = [];   // 阻断:导致 accepted = false
  const warnings: string[] = [];  // 软提示:不阻断,前端可展示但仍接受

  // 任何 action 都必填的最小硬约束
  if (!data.goal.trim()) missing.push("goal 不能为空。");
  if (!data.reason.trim()) missing.push("reason 不能为空。");

  // complete 的字段校验降级为软警告
  // 原因:LLM 经常漏填 evidence/verification/stateUpdated,被反复 reject 浪费整轮
  if (data.action === "complete") {
    if (data.evidence.length === 0) warnings.push("complete 缺少完成证据 evidence。");
    if (data.verification.length === 0) warnings.push("complete 缺少验证结果 verification。");
    if (!data.stateUpdated) warnings.push("complete 未声明 stateUpdated=true。");
    if (data.remaining.length > 0) warnings.push("complete 时 remaining 应为空。");
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

export function createYoloControlData(input: Record<string, unknown>): YoloControlData {
  const action = normalizeAction(input.action);
  const data = {
    action,
    evidence: normalizeStringArray(input.evidence),
    goal: normalizeString(input.goal, "未指定"),
    nextAction: normalizeOptionalString(input.nextAction),
    reason: normalizeString(input.reason),
    remaining: normalizeStringArray(input.remaining),
    requiredUserAction: normalizeOptionalString(input.requiredUserAction),
    stateUpdated: normalizeBoolean(input.stateUpdated),
    verification: normalizeStringArray(input.verification),
  };
  const { missing, warnings } = validateYoloControl(data);

  return {
    ...data,
    accepted: missing.length === 0,
    createdAt: new Date().toISOString(),
    kind: YOLO_CONTROL_KIND,
    missing,
    warnings,
  };
}

export function summarizeYoloControl(data: YoloControlData) {
  if (!data.accepted) return `YOLO 检查未通过：${data.missing.join("；")}`;
  const suffix = data.warnings.length > 0 ? `（提示：${data.warnings.join("；")}）` : "";
  if (data.action === "complete") return `YOLO 目标完成：${data.reason}${suffix}`;
  if (data.action === "blocked") return `YOLO 已阻塞：${data.reason}${suffix}`;
  return `YOLO 继续执行：${data.nextAction ?? data.reason}${suffix}`;
}

export function isYoloControlData(value: unknown): value is YoloControlData {
  if (!isRecord(value)) return false;
  return value.kind === YOLO_CONTROL_KIND
    && typeof value.action === "string"
    && typeof value.accepted === "boolean"
    && typeof value.createdAt === "string";
}

/** 兼容旧版本(无 warnings 字段)持久化数据,返回时补齐空数组。 */
function ensureWarnings(value: YoloControlData): YoloControlData {
  if (Array.isArray((value as { warnings?: unknown }).warnings)) return value;
  return { ...value, warnings: [] };
}

export function extractYoloControlData(output: unknown): YoloControlData | null {
  if (isYoloControlData(output)) return ensureWarnings(output);
  if (!isRecord(output)) return null;
  const envelope = output as ToolResultEnvelope;
  return isYoloControlData(envelope.data) ? ensureWarnings(envelope.data) : null;
}

export function isYoloControlCompletionPart(part: AgentPart) {
  if (part.type !== "tool-call" && part.type !== "tool-result") return false;
  return part.toolName === YOLO_CONTROL_TOOL_ID
    && part.status === "completed"
    && Boolean(extractYoloControlData(part.output)?.accepted)
    && extractYoloControlData(part.output)?.action === "complete";
}

export function getYoloControlDataFromPart(part: AgentPart) {
  if ((part.type !== "tool-call" && part.type !== "tool-result") || part.toolName !== YOLO_CONTROL_TOOL_ID) {
    return null;
  }
  return extractYoloControlData(part.output);
}

export function deriveLatestYoloControl(messages: AgentMessage[]) {
  for (const message of [...messages].reverse()) {
    for (const part of [...message.parts].reverse()) {
      const data = getYoloControlDataFromPart(part);
      if (data) return data;
    }
  }
  return null;
}

export function getLatestAssistantYoloControl(messages: AgentMessage[]) {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistant) return null;
  for (const part of [...assistant.parts].reverse()) {
    const data = getYoloControlDataFromPart(part);
    if (data) return data;
  }
  return null;
}
