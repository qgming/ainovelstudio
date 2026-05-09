import { APICallError } from "ai";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { createTestResult, includesAnyKeyword, type ProviderConnectionTestResult } from "./providerProbeShared";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message.trim();
  }
  if (typeof error === "string") {
    return error.trim();
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
  const causeCode = getErrorCauseCode(error).toLowerCase();

  if (APICallError.isInstance(error)) {
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

  if (includesAnyKeyword(`${normalizedMessage} ${causeCode}`, ["enotfound", "econnrefused", "etimedout", "fetch failed", "networkerror"])) {
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
    message: message || "模型连接测试失败，请稍后重试。",
    diagnostics: {
      durationMs,
    },
  });
}
