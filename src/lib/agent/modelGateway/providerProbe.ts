import type { AgentProviderConfig } from "../../../stores/agentSettingsStore";
import { probeProviderConnectionViaTauri } from "../providerApi";
import { normalizeProviderConfig } from "./providerConfig";
import { classifyRequestError } from "./providerProbeErrors";
import {
  createTestResult,
  type ProbeContentPart,
  type ProbeExecutionFailure,
  type ProbeExecutionSuccess,
  type ProbeGenerateResult,
  type ProviderConfigValidationResult,
  type ProviderConnectionTestResult,
} from "./providerProbeShared";

function normalizeProbeReply(text: string) {
  return text
    .trim()
    .replace(/^```[\w-]*\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/gu, "")
    .trim();
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
  const normalizedConfig = normalizeProviderConfig(providerConfig);

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
