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
      body,
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
