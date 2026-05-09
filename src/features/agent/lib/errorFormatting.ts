import { APICallError } from "ai";

type ProviderErrorContext = {
  baseURL?: string;
  model?: string;
};

function compactText(value: string, maxLength = 280) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function extractObjectString(value: unknown, key: string) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function extractModelName(requestBodyValues: unknown, context?: ProviderErrorContext) {
  const modelFromBody = extractObjectString(requestBodyValues, "model");
  if (modelFromBody) {
    return modelFromBody;
  }
  return context?.model?.trim() ?? "";
}

function extractCauseDetail(cause: unknown): string {
  if (!cause) {
    return "";
  }

  if (typeof cause === "string") {
    return cause.trim();
  }

  if (cause instanceof Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : "";
    const message = cause.message.trim();
    return [code, message].filter(Boolean).join(": ");
  }

  if (typeof cause === "object") {
    const message = extractObjectString(cause, "message");
    const code = extractObjectString(cause, "code");
    return [code, message].filter(Boolean).join(": ");
  }

  return "";
}

function extractResponseDetail(responseBody?: string) {
  const body = responseBody?.trim();
  if (!body) {
    return "";
  }

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const topLevelMessage = extractObjectString(parsed, "message");
    if (topLevelMessage) {
      return compactText(topLevelMessage);
    }

    const errorMessage =
      parsed.error && typeof parsed.error === "object"
        ? extractObjectString(parsed.error, "message") || extractObjectString(parsed.error, "detail")
        : "";
    if (errorMessage) {
      return compactText(errorMessage);
    }
  } catch {
    // 非 JSON 响应时直接回退到原始文本摘要。
  }

  return compactText(body);
}

function buildContextLines(url: string, model: string, responseDetail: string, causeDetail: string) {
  return [
    url ? `请求地址：${url}` : "",
    model ? `模型：${model}` : "",
    responseDetail ? `服务端返回：${responseDetail}` : "",
    causeDetail ? `底层原因：${causeDetail}` : "",
  ].filter(Boolean);
}

function buildErrorTitle(
  message: string,
  fallbackMessage: string,
  responseDetail: string,
  causeDetail: string,
  statusCode?: number,
) {
  if (statusCode) {
    return `模型调用失败（HTTP ${statusCode}）。`;
  }

  const detail = responseDetail || causeDetail || message;
  if (detail) {
    return `模型调用失败：${detail}`;
  }

  return fallbackMessage;
}

export function formatProviderError(
  error: unknown,
  fallbackMessage: string,
  context?: ProviderErrorContext,
) {
  if (APICallError.isInstance(error)) {
    const message = error.message.trim();
    const responseDetail = extractResponseDetail(error.responseBody);
    const causeDetail = extractCauseDetail(error.cause);
    const title = buildErrorTitle(
      message,
      fallbackMessage,
      responseDetail,
      causeDetail,
      error.statusCode,
    );
    const detailLines = buildContextLines(
      error.url || context?.baseURL?.trim() || "",
      extractModelName(error.requestBodyValues, context),
      responseDetail,
      causeDetail,
    );
    return [title, ...detailLines].join("\n");
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    const cause = (error as Error & { cause?: unknown }).cause;
    const causeDetail = extractCauseDetail(cause);
    const title = !causeDetail && message ? message : buildErrorTitle(message, fallbackMessage, "", causeDetail);
    const detailLines = buildContextLines(
      context?.baseURL?.trim() || "",
      context?.model?.trim() || "",
      "",
      causeDetail,
    );
    return [title, ...detailLines].filter(Boolean).join("\n");
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallbackMessage;
}
