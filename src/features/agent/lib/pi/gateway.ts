import { complete, validateToolCall, type AssistantMessage, type Static, type Tool, type TSchema } from "@earendil-works/pi-ai";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { assertProviderConfigReady, normalizeProviderConfig } from "../model-gateway/providerConfig";
import { toPiModel, toPiReasoningEffort } from "./models";

// 统一的请求前置：规范化 + 校验配置，返回 pi Model 与 reasoning_effort 档位。
// 所有 pi-ai 调用都先经此，确保配置校验与 modelGateway 旧实现保持一致的报错行为。
function prepareModelRequest(providerConfig: AgentProviderConfig) {
  const normalizedConfig = normalizeProviderConfig(providerConfig);
  assertProviderConfigReady(normalizedConfig);
  return {
    model: toPiModel(normalizedConfig),
    apiKey: normalizedConfig.apiKey,
    reasoningEffort: toPiReasoningEffort(normalizedConfig),
  };
}

// 从 AssistantMessage 内容块中拼接出纯文本。
function extractText(message: AssistantMessage): string {
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

// pi-ai 不抛 HTTP 错误，而是把失败放进 stopReason='error'/'aborted' + errorMessage。
// 这里统一转成 throw，向上层暴露与旧 AI SDK 一致的异常语义。
function throwIfFailed(message: AssistantMessage): void {
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? "模型调用失败。");
  }
}

export type AgentTextGenerationInput = {
  abortSignal?: AbortSignal;
  prompt: string;
  providerConfig: AgentProviderConfig;
  system: string;
};

/** 非流式文本生成（摘要、轻量判断等场景），基于 pi-ai complete()。 */
export async function generateAgentText({
  abortSignal,
  prompt,
  providerConfig,
  system,
}: AgentTextGenerationInput): Promise<string> {
  const request = prepareModelRequest(providerConfig);
  const message = await complete(
    request.model,
    {
      systemPrompt: system,
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    },
    {
      apiKey: request.apiKey,
      reasoningEffort: request.reasoningEffort,
      signal: abortSignal,
    },
  );
  throwIfFailed(message);
  return extractText(message);
}

export type AgentObjectGenerationInput<TParameters extends TSchema> = {
  abortSignal?: AbortSignal;
  // 结构化输出的 TypeBox schema（pi 用 TypeBox 描述工具参数）。
  schema: TParameters;
  // 工具名 / 描述：作为强制工具调用的元信息，帮助模型理解要产出的结构。
  toolName: string;
  toolDescription: string;
  prompt: string;
  providerConfig: AgentProviderConfig;
  system: string;
};

/**
 * 非流式结构化生成。pi-ai 没有 AI SDK 的 Output 等价物，这里用
 * “单工具 + 强制 toolChoice + validateToolCall 重建”实现：
 * 把目标结构包成唯一一个工具，强制模型调用它，再用 pi 的 TypeBox 校验拿回参数对象。
 */
export async function generateAgentObject<TParameters extends TSchema>({
  abortSignal,
  schema,
  toolName,
  toolDescription,
  prompt,
  providerConfig,
  system,
}: AgentObjectGenerationInput<TParameters>): Promise<Static<TParameters>> {
  const request = prepareModelRequest(providerConfig);
  const tool: Tool<TParameters> = {
    name: toolName,
    description: toolDescription,
    parameters: schema,
  };

  const message = await complete(
    request.model,
    {
      systemPrompt: system,
      messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
      tools: [tool],
    },
    {
      apiKey: request.apiKey,
      reasoningEffort: request.reasoningEffort,
      signal: abortSignal,
      // 强制模型调用这个唯一的结构化工具，确保拿到结构化参数而非自由文本。
      toolChoice: { type: "function", function: { name: toolName } },
    },
  );
  throwIfFailed(message);

  const toolCall = message.content.find((block) => block.type === "toolCall" && block.name === toolName);
  if (!toolCall || toolCall.type !== "toolCall") {
    throw new Error("模型未按要求返回结构化结果。");
  }

  // validateToolCall 用工具的 TypeBox schema 校验并强转参数，失败会抛错。
  return validateToolCall([tool as Tool], toolCall) as Static<TParameters>;
}
