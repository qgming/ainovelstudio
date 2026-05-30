import type { Model } from "@earendil-works/pi-ai";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { buildProviderHeaders } from "../providerRequest";

// openai-completions 协议直接支持的 reasoning_effort 档位（与应用的 5 档一致，去掉 auto）。
export type PiReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

// 把工作区配置的 baseURL 规范化：去掉尾部斜杠。pi-ai 会在其后拼接 /chat/completions 等路径。
function normalizeBaseUrl(baseURL: string) {
  return baseURL.trim().replace(/\/+$/, "");
}

// 把应用的 AgentProviderConfig 映射成 pi-ai 的自定义 Model（OpenAI 兼容协议）。
// 本应用面向任意用户自填的 OpenAI 兼容网关（多为国产中转），不能用 pi-ai 的内置
// getModel（只认预置 provider 表）；统一手工构造 Model。
export function toPiModel(config: AgentProviderConfig): Model<"openai-completions"> {
  const reasoningEnabled =
    config.reasoningEffort !== undefined && config.reasoningEffort !== "auto";

  return {
    id: config.model,
    name: config.model,
    api: "openai-completions",
    provider: "ainovelstudio-provider",
    baseUrl: normalizeBaseUrl(config.baseURL),
    reasoning: reasoningEnabled,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    // opencode beta 头（仅 simulateOpencodeBeta=true 时存在）。
    headers: buildProviderHeaders(config),
    compat: {
      // 国产网关域名非 openai.com，pi-ai 的 URL 自动探测会把 reasoning_effort 判为不支持
      // 并静默丢弃；这里显式开启，让 reasoningEffort 档位能下发。
      supportsReasoningEffort: true,
    },
  };
}

// 把应用的 reasoningEffort 映射成 openai-completions 协议的 reasoning_effort 档位。
// auto（或未设）→ undefined：不下发 reasoning_effort，由网关自行决定。
// 注意：openai-completions provider 读的是 options.reasoningEffort（OpenAICompletionsOptions），
// 而非 SimpleStreamOptions.reasoning（那是 streamSimple/completeSimple 才用的抽象档位）。
export function toPiReasoningEffort(config: AgentProviderConfig): PiReasoningEffort | undefined {
  if (config.reasoningEffort === undefined || config.reasoningEffort === "auto") {
    return undefined;
  }
  return config.reasoningEffort;
}

// pi-agent-core 的 ThinkingLevel（"off" | "minimal" | "low" | "medium" | "high" | "xhigh"）。
// Agent.thinkingLevel = "off" 时 pi 不下发 reasoning（agent.js:282），等价于应用的 auto。
export type PiThinkingLevel = "off" | PiReasoningEffort;

// 把应用的 reasoningEffort 映射成 pi Agent 的 thinkingLevel（initialState/state.thinkingLevel）。
// auto（或未设）→ "off"：不强制思考档位，交给模型默认。
// pi Agent 用 streamSimple，会把 thinkingLevel 经 reasoning 映射成 reasoning_effort，
// 并自带国产网关（zai/qwen/deepseek）的 thinkingFormat 兼容。
export function toPiThinkingLevel(config: AgentProviderConfig): PiThinkingLevel {
  if (config.reasoningEffort === undefined || config.reasoningEffort === "auto") {
    return "off";
  }
  return config.reasoningEffort;
}
