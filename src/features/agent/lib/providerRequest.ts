import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";
import { streamProviderRequestViaTauri } from "./providerApi";

const OPENCODE_CLIENT = "cli";
const OPENCODE_PROJECT = "global";

const opencodeSessionId = createOpencodeId("ses_");

function createOpencodeId(prefix: "msg_" | "ses_") {
  const rawId = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

  return `${prefix}${rawId}`;
}

export function buildProviderHeaders(providerConfig: AgentProviderConfig) {
  if (!providerConfig.simulateOpencodeBeta) {
    return undefined;
  }

  return {
    "x-opencode-client": OPENCODE_CLIENT,
    "x-opencode-project": OPENCODE_PROJECT,
    "x-opencode-request": createOpencodeId("msg_"),
    "x-opencode-session": opencodeSessionId,
  };
}

export function buildProviderRequestHeaders(providerConfig: AgentProviderConfig) {
  const headers = new Headers(buildProviderHeaders(providerConfig));
  headers.set("Authorization", `Bearer ${providerConfig.apiKey.trim()}`);
  headers.set("Accept", "application/json");
  return Object.fromEntries(headers.entries());
}

async function readForwardBody(body: BodyInit | null | undefined) {
  if (body == null) {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  return new Response(body).text();
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractReasoningTextFromContent(content: unknown) {
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!isRecord(part) || part.type !== "reasoning") return "";
      return typeof part.text === "string" ? part.text : "";
    })
    .join("")
    .trim();
}

function extractReasoningTextFromAssistantMessage(message: JsonRecord) {
  const nativeReasoning = message.reasoning_content ?? message.reasoning;
  if (typeof nativeReasoning === "string" && nativeReasoning.trim()) {
    return nativeReasoning.trim();
  }

  return extractReasoningTextFromContent(message.content);
}

function getToolCallNames(toolCalls: unknown) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls
    .map((toolCall) => {
      if (!isRecord(toolCall) || !isRecord(toolCall.function)) return "";
      return typeof toolCall.function.name === "string" ? toolCall.function.name.trim() : "";
    })
    .filter(Boolean);
}

function buildFallbackReasoningContent(message: JsonRecord, previousReasoningContent: string) {
  if (previousReasoningContent) return previousReasoningContent;

  const toolNames = getToolCallNames(message.tool_calls);
  const toolSummary = toolNames.length > 0
    ? `需要调用工具：${Array.from(new Set(toolNames)).join(", ")}。`
    : "需要调用工具继续执行。";
  return `上游消息历史缺少原始 reasoning_content，已按工具调用历史补齐。${toolSummary}`;
}

function addReasoningContentToAssistantMessages(body: string | undefined) {
  if (!body) return body;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) return body;

  let changed = false;
  let previousReasoningContent = "";
  const messages = parsed.messages.map((message) => {
    if (!isRecord(message) || message.role !== "assistant") return message;

    const reasoningContent = extractReasoningTextFromAssistantMessage(message);
    if (reasoningContent) previousReasoningContent = reasoningContent;
    const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
    if (!hasToolCalls && reasoningContent) {
      if (message.reasoning_content === reasoningContent) return message;
      changed = true;
      return {
        ...message,
        reasoning_content: reasoningContent,
      };
    }

    if (!hasToolCalls) return message;

    const patchedReasoningContent = reasoningContent || buildFallbackReasoningContent(message, previousReasoningContent);
    previousReasoningContent = patchedReasoningContent;
    changed = true;
    return {
      ...message,
      reasoning_content: patchedReasoningContent,
    };
  });

  if (!changed) return body;
  return JSON.stringify({
    ...parsed,
    messages,
  });
}

function createTauriProviderFetch(providerConfig: AgentProviderConfig) {
  return async function tauriProviderFetch(input: RequestInfo | URL, init?: RequestInit) {
    const request = input instanceof Request ? input : new Request(input, init);
    const body = await readForwardBody(
      init?.body ?? (request.method === "GET" || request.method === "HEAD" ? undefined : request.body),
    );
    return streamProviderRequestViaTauri({
      baseUrl: providerConfig.baseURL,
      method: request.method,
      mode: "provider",
      headers: Object.fromEntries(request.headers.entries()),
      body: addReasoningContentToAssistantMessages(body),
      url: request.url,
    }, init?.signal ?? request.signal);
  };
}

export function createProvider(providerConfig: AgentProviderConfig) {
  return createOpenAICompatible({
    name: "ainovelstudio-provider",
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseURL,
    fetch: createTauriProviderFetch(providerConfig),
    headers: buildProviderHeaders(providerConfig),
  });
}
