import { APICallError, type ModelMessage } from "ai";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";

export const MAX_CONSECUTIVE_AI_REQUEST_FAILURES = 5;

const RETRY_CONTINUE_PROMPT = "继续执行";
const NON_RETRYABLE_HTTP_STATUS = new Set([400, 401, 403, 404, 422]);
const NON_RETRYABLE_PROVIDER_ERROR_CODES = new Set([
  "authentication_error",
  "billing_not_active",
  "content_policy_violation",
  "context_length_exceeded",
  "insufficient_quota",
  "invalid_api_key",
  "invalid_model",
  "invalid_request_error",
  "model_not_found",
  "permission_denied",
  "rate_limit_exceeded",
]);

export type AiRequestFailure = {
  attempt: number;
  message: string;
  name: string;
  partsGenerated: number;
  timestamp: string;
  turnId: string;
};

export type RetryState = {
  consecutiveFailures: number;
  failureHistory: AiRequestFailure[];
};

export function createRetryState(): RetryState {
  return { consecutiveFailures: 0, failureHistory: [] };
}

export function isAbortError(error: unknown, abortSignal?: AbortSignal) {
  if (abortSignal?.aborted) return true;
  return error instanceof DOMException && error.name === "AbortError";
}

export function isNonRetryableAiRequestError(error: unknown) {
  if (!APICallError.isInstance(error)) return false;
  const providerCode = extractProviderErrorCode(error.responseBody);
  if (providerCode && NON_RETRYABLE_PROVIDER_ERROR_CODES.has(providerCode)) return true;
  return typeof error.statusCode === "number" && NON_RETRYABLE_HTTP_STATUS.has(error.statusCode);
}

export function createFailureRecord(params: {
  attempt: number;
  error: unknown;
  partsGenerated: number;
  turnId: string;
}): AiRequestFailure {
  return {
    attempt: params.attempt,
    message: getErrorMessage(params.error),
    name: params.error instanceof Error ? params.error.name : typeof params.error,
    partsGenerated: params.partsGenerated,
    timestamp: new Date().toISOString(),
    turnId: params.turnId,
  };
}

export function appendRetryPrompt(messages: ModelMessage[], failure: AiRequestFailure) {
  messages.push({
    role: "user",
    content: [
      RETRY_CONTINUE_PROMPT,
      "",
      `系统自动续跑提示：上一轮 AI 流式请求中断，这是连续第 ${failure.attempt} 次短暂失败。`,
      `错误：${failure.message}`,
      "请从当前任务的中断点继续执行，保持已有目标、约束和进度一致。",
      "如已经完成过工具写入或外部动作，先核对现状再继续，避免重复操作。",
    ].join("\n"),
  });
}

export function buildFailureReport(failures: AiRequestFailure[], providerConfig: AgentProviderConfig) {
  const failure = failures.at(-1);
  return [
    `连续 ${MAX_CONSECUTIVE_AI_REQUEST_FAILURES} 次 AI 请求失败，已停止自动续跑。`,
    "",
    "失败上下文：",
    `模型：${providerConfig.model || "未配置"}`,
    `Base URL：${providerConfig.baseURL || "未配置"}`,
    ...(failure
      ? [
          `最近一次时间：${failure.timestamp}`,
          `最近一次 turnId：${failure.turnId}`,
          `错误类型：${failure.name}`,
          `已生成片段数：${failure.partsGenerated}`,
          `错误信息：${failure.message}`,
        ]
      : []),
    "",
    "建议检查网络稳定性、供应商状态、模型名称、Base URL、API Key 权限，以及供应商是否在流式响应中返回了非 SSE/异常响应体。",
  ].join("\n");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "未知 AI 请求错误";
}

function extractProviderErrorCode(responseBody?: string) {
  const body = responseBody?.trim();
  if (!body) return "";

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object") return "";
    const topLevelCode = (parsed as Record<string, unknown>).code;
    if (typeof topLevelCode === "string") return topLevelCode;
    const nestedError = (parsed as Record<string, unknown>).error;
    if (!nestedError || typeof nestedError !== "object") return "";
    const nestedCode = (nestedError as Record<string, unknown>).code;
    return typeof nestedCode === "string" ? nestedCode : "";
  } catch {
    return "";
  }
}
