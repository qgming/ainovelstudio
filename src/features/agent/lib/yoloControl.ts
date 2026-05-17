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
  missing: string[];
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

function validateYoloControl(data: Omit<YoloControlData, "accepted" | "createdAt" | "kind" | "missing">) {
  const missing: string[] = [];

  if (!data.goal.trim()) missing.push("goal 不能为空。");
  if (!data.reason.trim()) missing.push("reason 不能为空。");

  if (data.action === "complete") {
    if (data.evidence.length === 0) missing.push("complete.evidence 至少需要 1 条完成证据。");
    if (data.verification.length === 0) missing.push("complete.verification 至少需要 1 条验证结果。");
    if (!data.stateUpdated) missing.push("complete.stateUpdated 必须为 true。");
    if (data.remaining.length > 0) missing.push("complete.remaining 必须为空。");
  }

  if (data.action === "continue") {
    if (data.remaining.length === 0) missing.push("continue.remaining 至少需要 1 条剩余任务。");
    if (!data.nextAction?.trim()) missing.push("continue.nextAction 不能为空。");
  }

  if (data.action === "blocked") {
    if (!data.reason.trim()) missing.push("blocked.reason 不能为空。");
    if (!data.requiredUserAction?.trim()) missing.push("blocked.requiredUserAction 不能为空。");
  }

  return missing;
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
  const missing = validateYoloControl(data);

  return {
    ...data,
    accepted: missing.length === 0,
    createdAt: new Date().toISOString(),
    kind: YOLO_CONTROL_KIND,
    missing,
  };
}

export function summarizeYoloControl(data: YoloControlData) {
  if (!data.accepted) return `YOLO 检查未通过：${data.missing.join("；")}`;
  if (data.action === "complete") return `YOLO 目标完成：${data.reason}`;
  if (data.action === "blocked") return `YOLO 已阻塞：${data.reason}`;
  return `YOLO 继续执行：${data.nextAction ?? data.reason}`;
}

export function isYoloControlData(value: unknown): value is YoloControlData {
  if (!isRecord(value)) return false;
  return value.kind === YOLO_CONTROL_KIND
    && typeof value.action === "string"
    && typeof value.accepted === "boolean"
    && typeof value.createdAt === "string";
}

export function extractYoloControlData(output: unknown): YoloControlData | null {
  if (isYoloControlData(output)) return output;
  if (!isRecord(output)) return null;
  const envelope = output as ToolResultEnvelope;
  return isYoloControlData(envelope.data) ? envelope.data : null;
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
