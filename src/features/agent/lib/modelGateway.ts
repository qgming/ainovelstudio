import { generateText, isLoopFinished, stepCountIs, streamText, tool as defineTool } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import type { AgentUsage } from "./types";
import { createProvider } from "./providerRequest";
import {
  assertProviderConfigReady,
  buildProviderOptions,
  normalizeProviderConfig,
} from "./model-gateway/providerConfig";
export { testAgentProviderConnection } from "./model-gateway/providerProbe";
export type {
  ProviderConnectionTestResult,
  ProviderConnectionTestStage,
  ProviderConnectionTestStatus,
} from "./model-gateway/providerProbeShared";

export type AgentTextGenerationInput = {
  abortSignal?: AbortSignal;
  prompt: string;
  providerConfig: AgentProviderConfig;
  system: string;
};

type GenerateTextOptions = Parameters<typeof generateText>[0];

type AgentOutputGenerationInput = AgentTextGenerationInput & {
  output: NonNullable<GenerateTextOptions["output"]>;
};

// 所有模型调用都先经过这里，确保配置校验、provider 创建和 providerOptions 注入保持一致。
function prepareModelRequest(providerConfig: AgentProviderConfig) {
  const normalizedConfig = normalizeProviderConfig(providerConfig);
  assertProviderConfigReady(normalizedConfig);
  const provider = createProvider(normalizedConfig);
  return {
    model: provider(normalizedConfig.model),
    normalizedConfig,
    providerOptions: buildProviderOptions(normalizedConfig),
  };
}

function resolveStopWhen(singleStep: boolean | undefined, maxSteps: number | undefined) {
  if (singleStep) return stepCountIs(1);
  if (typeof maxSteps === "number" && maxSteps > 0) {
    return [isLoopFinished(), stepCountIs(maxSteps)];
  }
  return isLoopFinished();
}

/** 非流式文本生成（摘要、轻量判断等场景） */
export async function generateAgentText({ abortSignal, prompt, providerConfig, system }: AgentTextGenerationInput) {
  const request = prepareModelRequest(providerConfig);
  const result = await generateText({
    abortSignal,
    model: request.model,
    prompt,
    providerOptions: request.providerOptions,
    system,
  });
  return result.text;
}

/** 非流式结构化生成，统一走 AI SDK Output。 */
export async function generateAgentOutput<COMPLETE_OUTPUT>({
  abortSignal,
  output,
  prompt,
  providerConfig,
  system,
}: AgentOutputGenerationInput): Promise<COMPLETE_OUTPUT> {
  const request = prepareModelRequest(providerConfig);
  const result = await generateText({
    abortSignal,
    model: request.model,
    output,
    prompt,
    providerOptions: request.providerOptions,
    system,
  });
  return result.output as COMPLETE_OUTPUT;
}

export type StreamAgentTextInput = {
  abortSignal?: AbortSignal;
  maxSteps?: number;
  messages: ModelMessage[];
  providerConfig: AgentProviderConfig;
  singleStep?: boolean;
  system: string;
  tools?: ToolSet;
};

export type StreamAgentTextResult = {
  finishReasonPromise?: Promise<string>;
  fullStream: ReturnType<typeof streamText>["fullStream"];
  responseMessagesPromise?: Promise<ModelMessage[]>;
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
  singleStep,
  system,
  tools,
}: StreamAgentTextInput): StreamAgentTextResult {
  const request = prepareModelRequest(providerConfig);

  const result = streamText({
    abortSignal,
    model: request.model,
    messages,
    providerOptions: request.providerOptions,
    system,
    tools,
    stopWhen: resolveStopWhen(singleStep, maxSteps),
  });

  const finishReasonPromise = Promise.resolve(result.finishReason);
  const responseMessagesPromise = Promise.resolve(result.response)
    .then((response) => response.messages as ModelMessage[])
    .catch(() => []);
  const usagePromise = createAbortAwareUsagePromise({
    abortSignal,
    finishReasonPromise,
    providerConfig: request.normalizedConfig,
    responsePromise: result.response,
    totalUsagePromise: result.totalUsage,
  });

  return {
    finishReasonPromise,
    fullStream: result.fullStream,
    responseMessagesPromise,
    usagePromise,
  };
}

export { defineTool };
