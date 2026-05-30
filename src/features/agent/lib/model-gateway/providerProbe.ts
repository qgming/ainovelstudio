import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { complete, type AssistantMessage } from "@earendil-works/pi-ai";
import { toPiModel, toPiReasoningEffort } from "../pi/models";
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

// 把 pi-ai 的 StopReason 映射成探测分析期望的 OpenAI 风格 finishReason。
function mapStopReason(stopReason: AssistantMessage["stopReason"]) {
  switch (stopReason) {
    case "toolUse":
      return "tool-calls";
    case "length":
      return "length";
    case "stop":
      return "stop";
    default:
      return stopReason;
  }
}

// 把 pi-ai 的 AssistantMessage 映射成探测分析所需的 ProbeGenerateResult。
function toProbeResult(message: AssistantMessage): ProbeGenerateResult {
  const content: ProbeContentPart[] = [];

  for (const block of message.content) {
    if (block.type === "text" && block.text.trim()) {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "toolCall") {
      content.push({ type: "tool-call" });
    }
  }

  const finishReason = mapStopReason(message.stopReason);
  return {
    content,
    finishReason,
    rawFinishReason: message.stopReason,
  };
}

// 从 pi-ai 的 errorMessage 文本里提取 HTTP 状态码。
// pi-ai 不抛 HTTP 错误，其 errorMessage 源自底层 OpenAI SDK 的 APIError.message，
// 格式恒以三位状态码开头（如 "401 ..."、"404 status code (no body)"），onResponse 在非 2xx 时不会触发，
// 所以这里从文本兜底解析状态码，让 classifyRequestError 能据此归类 auth/model 错误。
function extractHttpStatusFromMessage(message: string): number | undefined {
  const match = message.trim().match(/^(\d{3})\b/u);
  if (!match) {
    return undefined;
  }
  const code = Number(match[1]);
  return code >= 100 && code < 600 ? code : undefined;
}

async function executeProviderProbe(providerConfig: AgentProviderConfig): Promise<ProbeExecutionSuccess | ProbeExecutionFailure> {
  const startedAt = Date.now();
  // onResponse 捕获底层 HTTP 状态码，用于把非 2xx 归类成 auth/model/unknown 错误。
  let httpStatus: number | undefined;

  try {
    const message = await complete(
      toPiModel(providerConfig),
      {
        systemPrompt: "You are a connection test. Reply with the single word: ok.",
        messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
      },
      {
        apiKey: providerConfig.apiKey.trim(),
        reasoningEffort: toPiReasoningEffort(providerConfig),
        onResponse: (response) => {
          httpStatus = response.status;
        },
      },
    );

    // pi-ai 不抛 HTTP 错误，而是把失败放进 stopReason='error'/'aborted' + errorMessage。
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      const errorMessage = message.errorMessage ?? "";
      return {
        durationMs: Date.now() - startedAt,
        error: {
          // onResponse 在非 2xx 时不触发（OpenAI SDK 先抛），httpStatus 多为 undefined，
          // 故从 errorMessage 文本兜底提取状态码，供 classifyRequestError 归类。
          status: httpStatus ?? extractHttpStatusFromMessage(errorMessage),
          body: errorMessage,
          message: errorMessage,
        },
      };
    }

    return {
      durationMs: Date.now() - startedAt,
      result: toProbeResult(message),
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
