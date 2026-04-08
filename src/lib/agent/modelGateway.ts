import { generateText, streamText, tool as defineTool, stepCountIs } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";

export type AgentTextGenerationInput = {
  prompt: string;
  providerConfig: AgentProviderConfig;
  system: string;
};

/** 非流式文本生成（子代理等场景） */
export async function generateAgentText({ prompt, providerConfig, system }: AgentTextGenerationInput) {
  const provider = createOpenAICompatible({
    name: "ainovelstudio-provider",
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseURL,
  });

  const { text } = await generateText({
    maxOutputTokens: providerConfig.maxOutputTokens,
    model: provider(providerConfig.model),
    prompt,
    system,
    temperature: providerConfig.temperature,
  });

  return text;
}

export type StreamAgentTextInput = {
  abortSignal?: AbortSignal;
  messages: ModelMessage[];
  providerConfig: AgentProviderConfig;
  system: string;
  tools?: ToolSet;
};

/** 流式文本生成，返回 AI SDK streamText result */
export function streamAgentText({ abortSignal, messages, providerConfig, system, tools }: StreamAgentTextInput) {
  const provider = createOpenAICompatible({
    name: "ainovelstudio-provider",
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseURL,
  });

  return streamText({
    abortSignal,
    maxOutputTokens: providerConfig.maxOutputTokens,
    model: provider(providerConfig.model),
    messages,
    system,
    temperature: providerConfig.temperature,
    tools,
    stopWhen: stepCountIs(5),
  });
}

export { defineTool };
