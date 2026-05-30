import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { createTestResult, includesAnyKeyword, type ProviderConnectionTestResult } from "./providerProbeShared";

// AI SDK 的 APICallError 形态（脱离 `ai` 依赖后用结构化鸭子类型识别）。
// pi-ai 探测路径抛普通 Error，但底层 OpenAI SDK / fetch 错误可能携带这些字段。
type ApiCallErrorLike = {
  statusCode?: number;
  responseBody?: string;
};

function isApiCallErrorLike(error: unknown): error is ApiCallErrorLike {
  if (!error || typeof error !== "object") {
    return false;
  }
  return "statusCode" in error || "responseBody" in error;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.trim();
  }
  if (typeof error === "string") {
    return error.trim();
  }
  // probe 失败对象是普通对象 { status, body, message }（非 Error 实例），也要读出其 message。
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message.trim();
    }
  }
  return "";
}

// 读取错误对象的 body 文本（probe 失败对象用 body 字段携带原始响应/错误文本）。
function getErrorBody(error: unknown) {
  if (error && typeof error === "object" && "body" in error) {
    const body = (error as { body?: unknown }).body;
    if (typeof body === "string") {
      return body.trim();
    }
  }
  return "";
}

function getErrorCauseCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return "";
  }

  const cause = "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  if (!cause || typeof cause !== "object") {
    return "";
  }

  return "code" in cause && typeof (cause as { code?: unknown }).code === "string"
    ? (cause as { code: string }).code.trim()
    : "";
}


export function classifyRequestError(
  providerConfig: Pick<AgentProviderConfig, "baseURL" | "model">,
  error: unknown,
  durationMs: number,
): ProviderConnectionTestResult {
  if (typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number") {
    const statusCode = (error as { status: number }).status;
    const responseBodyValue = Reflect.get(error, "body");
    const responseBody = typeof responseBodyValue === "string" ? responseBodyValue.toLowerCase() : "";
    const diagnostics = {
      durationMs,
      httpStatus: statusCode,
    };

    if (statusCode === 401 || statusCode === 403) {
      return createTestResult(providerConfig, {
        ok: false,
        status: "auth_error",
        stage: "request",
        message: "鉴权失败，请检查 API Key 是否有效或是否具备调用权限。",
        diagnostics,
      });
    }

    if (
      statusCode === 404 ||
      includesAnyKeyword(responseBody, ["model not found", "no such model", "unknown model"])
    ) {
      return createTestResult(providerConfig, {
        ok: false,
        status: "model_error",
        stage: "request",
        message: "模型不可用，请检查模型名称是否正确，或当前服务是否支持该模型。",
        diagnostics,
      });
    }

    return createTestResult(providerConfig, {
      ok: false,
      status: "unknown_error",
      stage: "request",
      message: "模型连接测试失败，请稍后重试。",
      diagnostics,
    });
  }

  const message = getErrorMessage(error);
  const normalizedMessage = message.toLowerCase();
  const responseBody = getErrorBody(error).toLowerCase();
  const causeCode = getErrorCauseCode(error).toLowerCase();

  if (isApiCallErrorLike(error)) {
    const responseBody = error.responseBody?.toLowerCase() ?? "";
    const statusCode = error.statusCode;
    const diagnostics = {
      durationMs,
      httpStatus: statusCode,
    };

    if (statusCode === 401 || statusCode === 403) {
      return createTestResult(providerConfig, {
        ok: false,
        status: "auth_error",
        stage: "request",
        message: "鉴权失败，请检查 API Key 是否有效或是否具备调用权限。",
        diagnostics,
      });
    }

    if (
      statusCode === 404 ||
      includesAnyKeyword(`${normalizedMessage} ${responseBody}`, ["model not found", "no such model", "unknown model"])
    ) {
      return createTestResult(providerConfig, {
        ok: false,
        status: "model_error",
        stage: "request",
        message: "模型不可用，请检查模型名称是否正确，或当前服务是否支持该模型。",
        diagnostics,
      });
    }

    if (includesAnyKeyword(`${normalizedMessage} ${responseBody} ${causeCode}`, ["enotfound", "econnrefused", "etimedout", "fetch failed", "networkerror"])) {
      return createTestResult(providerConfig, {
        ok: false,
        status: "network_error",
        stage: "request",
        message: "网络不可达，请检查 Base URL 是否正确且服务可访问。",
        diagnostics,
      });
    }

    return createTestResult(providerConfig, {
      ok: false,
      status: "unknown_error",
      stage: "request",
      message: message || "模型连接测试失败，请稍后重试。",
      diagnostics,
    });
  }

  // 兜底分类（status 非数值、且非 ApiCallErrorLike，典型为 probe 的 { status:undefined, body, message } 对象）：
  // 把 message + body + causeCode 一起做关键字匹配，先判模型不可用，再判网络不可达，否则归为未知。
  const haystack = `${normalizedMessage} ${responseBody} ${causeCode}`;

  if (includesAnyKeyword(haystack, ["model not found", "no such model", "unknown model"])) {
    return createTestResult(providerConfig, {
      ok: false,
      status: "model_error",
      stage: "request",
      message: "模型不可用，请检查模型名称是否正确，或当前服务是否支持该模型。",
      diagnostics: {
        durationMs,
      },
    });
  }

  if (includesAnyKeyword(haystack, ["enotfound", "econnrefused", "etimedout", "fetch failed", "networkerror"])) {
    return createTestResult(providerConfig, {
      ok: false,
      status: "network_error",
      stage: "request",
      message: "网络不可达，请检查 Base URL 是否正确且服务可访问。",
      diagnostics: {
        durationMs,
      },
    });
  }

  return createTestResult(providerConfig, {
    ok: false,
    status: "unknown_error",
    stage: "request",
    message: message || responseBody || "模型连接测试失败，请稍后重试。",
    diagnostics: {
      durationMs,
    },
  });
}
