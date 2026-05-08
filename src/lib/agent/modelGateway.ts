import { generateText, isLoopFinished, stepCountIs, streamText, tool as defineTool } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import type { AgentUsage } from "./types";
import { createProvider } from "./providerRequest";
import { buildProviderOptions, normalizeProviderConfig } from "./modelGateway/providerConfig";
export { testAgentProviderConnection } from "./modelGateway/providerProbe";
export type {
  ProviderConnectionTestResult,
  ProviderConnectionTestStage,
  ProviderConnectionTestStatus,
} from "./modelGateway/providerProbeShared";

export type AgentTextGenerationInput = {
  prompt: string;
  providerConfig: AgentProviderConfig;
  system: string;
};

/** 非流式文本生成（子代理等场景） */
export async function generateAgentText({ prompt, providerConfig, system }: AgentTextGenerationInput) {
  const normalizedConfig = normalizeProviderConfig(providerConfig);
  const provider = createProvider(normalizedConfig);

  const { text } = await generateText({
    model: provider(normalizedConfig.model),
    prompt,
    providerOptions: buildProviderOptions(normalizedConfig),
    system,
  });

  return text;
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
  const normalizedConfig = normalizeProviderConfig(providerConfig);
  const provider = createProvider(normalizedConfig);

  const result = streamText({
    abortSignal,
    model: provider(normalizedConfig.model),
    messages,
    providerOptions: buildProviderOptions(normalizedConfig),
    system,
    tools,
    stopWhen: singleStep
      ? stepCountIs(1)
      : typeof maxSteps === "number" && maxSteps > 0
        ? [isLoopFinished(), stepCountIs(maxSteps)]
        : isLoopFinished(),
  });

  const finishReasonPromise = Promise.resolve(result.finishReason);
  const responseMessagesPromise = Promise.resolve(result.response)
    .then((response) => response.messages as ModelMessage[])
    .catch(() => []);
  const usagePromise = createAbortAwareUsagePromise({
    abortSignal,
    finishReasonPromise,
    providerConfig: normalizedConfig,
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