import { generateText, streamText, tool as defineTool, stepCountIs } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";

const CONNECTION_TEST_REPLY = "CONNECTION_OK";
const CONNECTION_TEST_SYSTEM = "你是连接测试助手。你必须且只能回复 CONNECTION_OK。";
const CONNECTION_TEST_PROMPT = "请只回复 CONNECTION_OK，不要输出任何额外内容。";
const CONNECTION_TEST_MAX_TOKENS = 32;

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

function normalizeProbeReply(text: string) {
  return text
    .trim()
    .replace(/^```[\w-]*\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim()
    .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/gu, "")
    .trim();
}

function assertProviderConfig(providerConfig: AgentProviderConfig) {
  if (!providerConfig.baseURL.trim()) {
    throw new Error("请先填写 Base URL。");
  }

  if (!providerConfig.apiKey.trim()) {
    throw new Error("请先填写 API Key。");
  }

  if (!providerConfig.model.trim()) {
    throw new Error("请先填写 Model。");
  }
}

export async function testAgentProviderConnection(providerConfig: AgentProviderConfig) {
  assertProviderConfig(providerConfig);

  const provider = createOpenAICompatible({
    name: "ainovelstudio-provider",
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseURL,
  });

  const { text } = await generateText({
    maxOutputTokens: CONNECTION_TEST_MAX_TOKENS,
    model: provider(providerConfig.model),
    prompt: CONNECTION_TEST_PROMPT,
    system: CONNECTION_TEST_SYSTEM,
    temperature: 0,
  });

  const normalizedReply = normalizeProbeReply(text);
  if (normalizedReply !== CONNECTION_TEST_REPLY) {
    throw new Error(`模型返回校验失败：${text.trim() || "空响应"}`);
  }

  return {
    expectedReply: CONNECTION_TEST_REPLY,
    reply: text.trim(),
  };
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
