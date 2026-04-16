import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AgentProviderConfig } from "../../stores/agentSettingsStore";
import { forwardProviderRequestViaTauri } from "./providerApi";

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

async function tauriProviderFetch(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request ? input : new Request(input, init);
  const body = await readForwardBody(init?.body ?? (request.method === "GET" || request.method === "HEAD" ? undefined : request.body));
  const response = await forwardProviderRequestViaTauri({
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    url: request.url,
  });

  return new Response(response.body, {
    headers: response.headers,
    status: response.status,
  });
}

export function createProvider(providerConfig: AgentProviderConfig) {
  return createOpenAICompatible({
    name: "ainovelstudio-provider",
    apiKey: providerConfig.apiKey,
    baseURL: providerConfig.baseURL,
    fetch: tauriProviderFetch,
    headers: buildProviderHeaders(providerConfig),
  });
}
