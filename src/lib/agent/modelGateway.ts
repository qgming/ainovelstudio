import { generateText, isLoopFinished, streamText, tool as defineTool } from "ai";
import type { ModelMessage, ToolSet } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";

const CONNECTION_TEST_SYSTEM = "你是连接测试助手。请用一句自然语言简短回复。";
const CONNECTION_TEST_PROMPT = "请回复一句简短的话，确认你已收到这条测试消息。";
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

function extractProbeReply(result: {
  text: string;
  reasoningText?: string;
  content?: Array<{ type?: string; text?: string }>;
}) {
  const textReply = normalizeProbeReply(result.text);
  if (textReply) {
    return textReply;
  }

  const reasoningReply = normalizeProbeReply(result.reasoningText ?? "");
  if (reasoningReply) {
    return reasoningReply;
  }

  const contentReply = normalizeProbeReply(
    (result.content ?? [])
      .map((part) => (part.type === "text" || part.type === "reasoning" ? part.text ?? "" : ""))
      .join("\n"),
  );
  return contentReply;
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

  const result = await generateText({
    maxOutputTokens: CONNECTION_TEST_MAX_TOKENS,
    model: provider(providerConfig.model),
    prompt: CONNECTION_TEST_PROMPT,
    system: CONNECTION_TEST_SYSTEM,
    temperature: 0,
  });

  const normalizedReply = extractProbeReply(result);
  if (!normalizedReply) {
    throw new Error("模型未返回有效内容。");
  }

  return {
    hasContent: true,
    reply: normalizedReply,
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
    model: provider(providerConfig.model),
    messages,
    system,
    temperature: providerConfig.temperature,
    tools,
    stopWhen: isLoopFinished(),
  });
}

export { defineTool };
