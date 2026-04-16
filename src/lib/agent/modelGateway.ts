import { APICallError, generateText, isLoopFinished, stepCountIs, streamText, tool as defineTool } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import type { AgentUsage } from "./types";
import { createProvider } from "./providerRequest";
import { probeProviderConnectionViaTauri } from "./providerApi";

export type AgentTextGenerationInput = {
  prompt: string;
  providerConfig: AgentProviderConfig;
  system: string;
};

export type ProviderConnectionTestStage = "config" | "request" | "response";
export type ProviderConnectionTestStatus =
  | "success"
  | "config_error"
  | "auth_error"
  | "network_error"
  | "model_error"
  | "response_invalid"
  | "unknown_error";

export type ProviderConnectionTestResult = {
  ok: boolean;
  status: ProviderConnectionTestStatus;
  stage: ProviderConnectionTestStage;
  message: string;
  provider: {
    baseURL: string;
    model: string;
  };
  diagnostics: {
    contentTypes?: string[];
    durationMs?: number;
    finishReason?: string;
    httpStatus?: number;
    rawFinishReason?: string;
    responseTextPreview?: string;
  };
};

type ProbeContentPart = {
  type?: string;
  text?: string;
};

type ProbeGenerateResult = {
  content?: ProbeContentPart[];
  finishReason?: string;
  rawFinishReason?: string;
};

type ProviderConfigValidationResult =
  | { ok: true; normalizedConfig: AgentProviderConfig }
  | { ok: false; result: ProviderConnectionTestResult };

type ProbeExecutionSuccess = {
  durationMs: number;
  result: ProbeGenerateResult;
};

type ProbeExecutionFailure = {
  durationMs: number;
  error: unknown;
};

/** 非流式文本生成（子代理等场景） */
export async function generateAgentText({ prompt, providerConfig, system }: AgentTextGenerationInput) {
  const provider = createProvider(providerConfig);

  const { text } = await generateText({
    model: provider(providerConfig.model),
    prompt,
    system,
  });

  return text;
}

function normalizeProbeReply(text: string) {
  return text
    .trim()
    .replace(/^```[\w-]*\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/gu, "")
    .trim();
}

function createTestResult(
  providerConfig: Pick<AgentProviderConfig, "baseURL" | "model">,
  result: Omit<ProviderConnectionTestResult, "provider">,
): ProviderConnectionTestResult {
  return {
    ...result,
    provider: {
      baseURL: providerConfig.baseURL,
      model: providerConfig.model,
    },
  };
}

function compactPreview(text: string, maxLength = 120) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function collectContentTypes(content?: ProbeContentPart[]) {
  return (content ?? []).map((part) => part.type?.trim() ?? "").filter(Boolean);
}

function extractResponseText(content?: ProbeContentPart[]) {
  return normalizeProbeReply(
    (content ?? [])
      .map((part) => (part.type === "text" ? part.text ?? "" : ""))
      .join("\n"),
  );
}

function validateProviderConfig(providerConfig: AgentProviderConfig): ProviderConfigValidationResult {
  const normalizedConfig = {
    apiKey: providerConfig.apiKey.trim(),
    baseURL: providerConfig.baseURL.trim(),
    model: providerConfig.model.trim(),
    simulateOpencodeBeta: Boolean(providerConfig.simulateOpencodeBeta),
  };

  if (!normalizedConfig.baseURL) {
    return {
      ok: false,
      result: createTestResult(normalizedConfig, {
        ok: false,
        status: "config_error",
        stage: "config",
        message: "请先填写 Base URL。",
        diagnostics: {},
      }),
    };
  }

  try {
    const parsedUrl = new URL(normalizedConfig.baseURL);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return {
        ok: false,
        result: createTestResult(normalizedConfig, {
          ok: false,
          status: "config_error",
          stage: "config",
          message: "Base URL 必须使用 http 或 https 协议。",
          diagnostics: {},
        }),
      };
    }
  } catch {
    return {
      ok: false,
      result: createTestResult(normalizedConfig, {
        ok: false,
        status: "config_error",
        stage: "config",
        message: "Base URL 格式无效，请填写完整地址。",
        diagnostics: {},
      }),
    };
  }

  if (!normalizedConfig.apiKey) {
    return {
      ok: false,
      result: createTestResult(normalizedConfig, {
        ok: false,
        status: "config_error",
        stage: "config",
        message: "请先填写 API Key。",
        diagnostics: {},
      }),
    };
  }

  if (!normalizedConfig.model) {
    return {
      ok: false,
      result: createTestResult(normalizedConfig, {
        ok: false,
        status: "config_error",
        stage: "config",
        message: "请先填写 Model。",
        diagnostics: {},
      }),
    };
  }

  return {
    ok: true,
    normalizedConfig,
  };
}

function parseProbeResult(body: string): ProbeGenerateResult {
  const payload = JSON.parse(body) as {
    choices?: Array<{
      finish_reason?: string | null;
      native_finish_reason?: string | null;
      message?: {
        content?: string | null;
        tool_calls?: unknown[];
      };
    }>;
  };
  const choice = payload.choices?.[0];
  const content: ProbeContentPart[] = [];

  if (typeof choice?.message?.content === "string" && choice.message.content.trim()) {
    content.push({ type: "text", text: choice.message.content });
  }

  if (Array.isArray(choice?.message?.tool_calls) && choice.message.tool_calls.length > 0) {
    content.push({ type: "tool-call" });
  }

  return {
    content,
    finishReason: choice?.finish_reason ?? undefined,
    rawFinishReason: choice?.native_finish_reason ?? choice?.finish_reason ?? undefined,
  };
}

async function executeProviderProbe(providerConfig: AgentProviderConfig): Promise<ProbeExecutionSuccess | ProbeExecutionFailure> {
  const startedAt = Date.now();

  try {
    const response = await probeProviderConnectionViaTauri(providerConfig);
    if (!response.ok) {
      return {
        durationMs: Date.now() - startedAt,
        error: { body: response.body, status: response.status },
      };
    }

    const result = parseProbeResult(response.body);

    return {
      durationMs: Date.now() - startedAt,
      result,
    };
  } catch (error) {
    return {
      durationMs: Date.now() - startedAt,
      error,
    };
  }
}

function analyzeProbeResponse(
  providerConfig: Pick<AgentProviderConfig, "baseURL" | "model">,
  probeResult: ProbeGenerateResult,
  durationMs: number,
): ProviderConnectionTestResult {
  const responseText = extractResponseText(probeResult.content);
  const finishReason = probeResult.finishReason?.trim();
  const rawFinishReason = probeResult.rawFinishReason?.trim();
  const contentTypes = collectContentTypes(probeResult.content);

  if (responseText) {
    return createTestResult(providerConfig, {
      ok: true,
      status: "success",
      stage: "response",
      message: "已连接到模型并收到有效响应。",
      diagnostics: {
        contentTypes,
        durationMs,
        finishReason,
        rawFinishReason,
        responseTextPreview: compactPreview(responseText),
      },
    });
  }

  if (finishReason === "content-filter") {
    return createTestResult(providerConfig, {
      ok: false,
      status: "response_invalid",
      stage: "response",
      message: "模型响应被内容过滤拦截，未返回可用文本。",
      diagnostics: {
        contentTypes,
        durationMs,
        finishReason,
        rawFinishReason,
      },
    });
  }

  if (finishReason === "length") {
    return createTestResult(providerConfig, {
      ok: false,
      status: "response_invalid",
      stage: "response",
      message: "模型在返回有效文本前因长度限制中断。",
      diagnostics: {
        contentTypes,
        durationMs,
        finishReason,
        rawFinishReason,
      },
    });
  }

  if (finishReason === "tool-calls") {
    return createTestResult(providerConfig, {
      ok: false,
      status: "response_invalid",
      stage: "response",
      message: "模型未直接返回文本，而是返回了工具调用。",
      diagnostics: {
        contentTypes,
        durationMs,
        finishReason,
        rawFinishReason,
      },
    });
  }

  if (contentTypes.length > 0) {
    return createTestResult(providerConfig, {
      ok: false,
      status: "response_invalid",
      stage: "response",
      message: `模型未返回文本内容，收到的内容类型：${contentTypes.join(", ")}。`,
      diagnostics: {
        contentTypes,
        durationMs,
        finishReason,
        rawFinishReason,
      },
    });
  }

  if (finishReason || rawFinishReason) {
    return createTestResult(providerConfig, {
      ok: false,
      status: "response_invalid",
      stage: "response",
      message: `模型未返回有效文本响应。finishReason=${finishReason || "unknown"}${rawFinishReason ? `，raw=${rawFinishReason}` : ""}。`,
      diagnostics: {
        durationMs,
        finishReason,
        rawFinishReason,
      },
    });
  }

  return createTestResult(providerConfig, {
    ok: false,
    status: "response_invalid",
    stage: "response",
    message: "模型未返回有效文本响应。",
    diagnostics: {
      durationMs,
    },
  });
}

function includesAnyKeyword(value: string, keywords: string[]) {
  return keywords.some((keyword) => value.includes(keyword));
}

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

function classifyRequestError(
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

export async function testAgentProviderConnection(providerConfig: AgentProviderConfig): Promise<ProviderConnectionTestResult> {
  const validation = validateProviderConfig(providerConfig);
  if (!validation.ok) {
    return validation.result;
  }

  const execution = await executeProviderProbe(validation.normalizedConfig);
  if ("error" in execution) {
    return classifyRequestError(validation.normalizedConfig, execution.error, execution.durationMs);
  }

  return analyzeProbeResponse(validation.normalizedConfig, execution.result, execution.durationMs);
}

export type StreamAgentTextInput = {
  abortSignal?: AbortSignal;
  maxSteps?: number;
  messages: ModelMessage[];
  providerConfig: AgentProviderConfig;
  system: string;
  tools?: ToolSet;
};

export type StreamAgentTextResult = {
  fullStream: ReturnType<typeof streamText>["fullStream"];
  usagePromise?: Promise<AgentUsage | null>;
};

function normalizeUsageNumber(value: number | undefined) {
  return value ?? 0;
}

function createAbortAwareUsagePromise(params: {
  abortSignal?: AbortSignal;
  finishReasonPromise: PromiseLike<string>;
  providerConfig: AgentProviderConfig;
  responsePromise: PromiseLike<{ modelId?: string }>;
  totalUsagePromise: PromiseLike<{
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    inputTokenDetails: {
      noCacheTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
    outputTokenDetails: {
      reasoningTokens?: number;
    };
  }>;
}): Promise<AgentUsage | null> {
  const { abortSignal, finishReasonPromise, providerConfig, responsePromise, totalUsagePromise } = params;

  if (abortSignal?.aborted) {
    return Promise.resolve(null);
  }

  const usagePromise = Promise.all([
    Promise.resolve(totalUsagePromise),
    Promise.resolve(finishReasonPromise),
    Promise.resolve(responsePromise),
  ])
    .then(([totalUsage, finishReason, response]) => ({
      recordedAt: Math.floor(Date.now() / 1000).toString(),
      provider: "ainovelstudio-provider",
      modelId: response.modelId || providerConfig.model,
      finishReason,
      inputTokens: normalizeUsageNumber(totalUsage.inputTokens),
      outputTokens: normalizeUsageNumber(totalUsage.outputTokens),
      totalTokens: normalizeUsageNumber(totalUsage.totalTokens),
      noCacheTokens: normalizeUsageNumber(totalUsage.inputTokenDetails.noCacheTokens),
      cacheReadTokens: normalizeUsageNumber(totalUsage.inputTokenDetails.cacheReadTokens),
      cacheWriteTokens: normalizeUsageNumber(totalUsage.inputTokenDetails.cacheWriteTokens),
      reasoningTokens: normalizeUsageNumber(totalUsage.outputTokenDetails.reasoningTokens),
    }))
    .catch(() => null);

  if (!abortSignal) {
    return usagePromise;
  }

  return new Promise<AgentUsage | null>((resolve) => {
    const handleAbort = () => {
      abortSignal.removeEventListener("abort", handleAbort);
      resolve(null);
    };

    abortSignal.addEventListener("abort", handleAbort, { once: true });
    void usagePromise.then((usage) => {
      abortSignal.removeEventListener("abort", handleAbort);
      resolve(usage);
    });
  });
}

/** 流式文本生成，返回 AI SDK streamText result */
export function streamAgentText({
  abortSignal,
  maxSteps,
  messages,
  providerConfig,
  system,
  tools,
}: StreamAgentTextInput): StreamAgentTextResult {
  const provider = createProvider(providerConfig);

  const result = streamText({
    abortSignal,
    model: provider(providerConfig.model),
    messages,
    system,
    tools,
    stopWhen: typeof maxSteps === "number" && maxSteps > 0 ? [isLoopFinished(), stepCountIs(maxSteps)] : isLoopFinished(),
  });

  const usagePromise = createAbortAwareUsagePromise({
    abortSignal,
    finishReasonPromise: result.finishReason,
    providerConfig,
    responsePromise: result.response,
    totalUsagePromise: result.totalUsage,
  });

  return {
    fullStream: result.fullStream,
    usagePromise,
  };
}

export { defineTool };
