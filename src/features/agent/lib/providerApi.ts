import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentProviderConfig } from "@features/settings/stores/useAgentSettingsStore";

export type ProviderHttpResponse = {
  ok: boolean;
  status: number;
  body: string;
};

export type ForwardProviderRequest = {
  baseUrl?: string;
  method: string;
  headers: Record<string, string>;
  mode?: "provider" | "publicWeb";
  body?: string;
  requestId?: string;
  url: string;
};

export type ForwardProviderResponse = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: string;
};

type JsonRecord = Record<string, unknown>;

export function fetchProviderModelsViaTauri(config: AgentProviderConfig) {
  return invoke<ProviderHttpResponse>("fetch_provider_models", { config });
}

export function probeProviderConnectionViaTauri(config: AgentProviderConfig) {
  return invoke<ProviderHttpResponse>("probe_provider_connection", { config });
}

export function forwardProviderRequestViaTauri(request: ForwardProviderRequest) {
  return invoke<ForwardProviderResponse>("forward_provider_request", { request });
}

type ProviderStreamEvent =
  | {
      type: "start";
      requestId: string;
      request_id?: string;
      ok: boolean;
      status: number;
      headers: Record<string, string>;
    }
  | {
      type: "chunk";
      requestId: string;
      request_id?: string;
      chunk: number[];
    }
  | {
      type: "end";
      requestId: string;
      request_id?: string;
    }
  | {
      type: "error";
      requestId: string;
      request_id?: string;
      message: string;
    };

function createProviderStreamId() {
  return `provider-stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function cancelProviderStream(requestId: string) {
  await invoke<void>("cancel_provider_stream", { requestId }).catch(() => undefined);
}

function getProviderStreamRequestId(payload: ProviderStreamEvent) {
  return payload.requestId ?? payload.request_id;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestExpectsChatCompletionStream(request: ForwardProviderRequest) {
  if (!request.body) return false;

  try {
    const url = new URL(request.url);
    const body = JSON.parse(request.body) as unknown;
    return url.pathname.endsWith("/chat/completions") && isRecord(body) && body.stream === true;
  } catch {
    return false;
  }
}

function extractTextContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (isRecord(part) && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

function extractChoiceText(choice: unknown) {
  if (!isRecord(choice) || !isRecord(choice.message)) return "";

  const content = extractTextContent(choice.message.content);
  if (content.trim()) return content;

  const reasoningContent = choice.message.reasoning_content ?? choice.message.reasoningContent;
  return typeof reasoningContent === "string" ? reasoningContent : "";
}

function normalizeToolCall(toolCall: unknown, fallbackIndex: number): JsonRecord | null {
  if (!isRecord(toolCall)) return null;

  const normalized: JsonRecord = {
    index: typeof toolCall.index === "number" ? toolCall.index : fallbackIndex,
  };

  if (typeof toolCall.id === "string") normalized.id = toolCall.id;
  if (typeof toolCall.type === "string") normalized.type = toolCall.type;

  if (isRecord(toolCall.function)) {
    const normalizedFunction: JsonRecord = {};
    if (typeof toolCall.function.name === "string") {
      normalizedFunction.name = toolCall.function.name;
    }
    if (typeof toolCall.function.arguments === "string") {
      normalizedFunction.arguments = toolCall.function.arguments;
    }
    normalized.function = normalizedFunction;
  }

  return normalized;
}

function extractToolCalls(choice: JsonRecord) {
  if (!isRecord(choice.message) || !Array.isArray(choice.message.tool_calls)) return [];
  return choice.message.tool_calls
    .map((toolCall, index) => normalizeToolCall(toolCall, index))
    .filter((toolCall): toolCall is JsonRecord => toolCall !== null);
}

function createChatCompletionChunk(params: {
  created: number;
  delta: JsonRecord;
  finishReason: unknown;
  id: string;
  index: number;
  model: string;
  usage?: unknown;
}) {
  return {
    id: params.id,
    object: "chat.completion.chunk",
    created: params.created,
    model: params.model,
    choices: [
      {
        index: params.index,
        delta: params.delta,
        finish_reason: typeof params.finishReason === "string" ? params.finishReason : null,
      },
    ],
    ...(params.usage !== undefined ? { usage: params.usage } : {}),
  };
}

function encodeSsePayload(payloads: unknown[]) {
  const encoder = new TextEncoder();
  const text = [
    ...payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`),
    "data: [DONE]\n\n",
  ].join("");
  return encoder.encode(text);
}

function convertChatCompletionJsonToSse(body: string): Uint8Array | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.object !== "chat.completion" || !Array.isArray(parsed.choices)) {
    return null;
  }

  const id = typeof parsed.id === "string" ? parsed.id : `chatcmpl-${Date.now().toString(36)}`;
  const created = typeof parsed.created === "number" ? parsed.created : Math.floor(Date.now() / 1000);
  const model = typeof parsed.model === "string" ? parsed.model : "";
  const payloads: unknown[] = [];

  parsed.choices.forEach((choice, fallbackIndex) => {
    if (!isRecord(choice)) return;
    const index = typeof choice.index === "number" ? choice.index : fallbackIndex;
    const text = extractChoiceText(choice);
    const toolCalls = extractToolCalls(choice);

    payloads.push(createChatCompletionChunk({
      created,
      delta: { role: "assistant" },
      finishReason: null,
      id,
      index,
      model,
    }));

    if (text.length > 0) {
      payloads.push(createChatCompletionChunk({
        created,
        delta: { content: text },
        finishReason: null,
        id,
        index,
        model,
      }));
    }

    if (toolCalls.length > 0) {
      payloads.push(createChatCompletionChunk({
        created,
        delta: { tool_calls: toolCalls },
        finishReason: null,
        id,
        index,
        model,
      }));
    }

    payloads.push(createChatCompletionChunk({
      created,
      delta: {},
      finishReason: choice.finish_reason ?? (toolCalls.length > 0 ? "tool_calls" : "stop"),
      id,
      index,
      model,
      usage: parsed.usage,
    }));
  });

  return payloads.length > 0 ? encodeSsePayload(payloads) : null;
}

function createBufferedResponse(params: {
  body: Uint8Array;
  headers: Record<string, string>;
  status: number;
}) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(params.body);
      controller.close();
    },
  });
  return new Response(stream, {
    headers: params.headers,
    status: params.status,
  });
}

function sniffBufferedStreamBody(chunks: Uint8Array[]) {
  const text = new TextDecoder().decode(mergeChunks(chunks)).trimStart();
  if (!text) return "pending" as const;
  if (/^(data|event|id|retry):/.test(text)) return "sse" as const;
  if (text.startsWith("{") || text.startsWith("[")) return "json" as const;
  return "passthrough" as const;
}

export async function streamProviderRequestViaTauri(
  request: ForwardProviderRequest,
  abortSignal?: AbortSignal,
): Promise<Response> {
  const requestId = request.requestId ?? createProviderStreamId();
  if (abortSignal?.aborted) {
    await cancelProviderStream(requestId);
    throw new DOMException("Provider request aborted.", "AbortError");
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let hasResolved = false;
  let hasAborted = false;
  let bufferedJsonChunks: Uint8Array[] | null = null;
  let bufferedResponseMeta: { headers: Record<string, string>; status: number } | null = null;
  let rejectStart: ((reason?: unknown) => void) | null = null;
  let unlisten: UnlistenFn | null = null;
  let abortHandler: (() => void) | null = null;

  const cleanup = () => {
    unlisten?.();
    unlisten = null;
    if (abortSignal && abortHandler) {
      abortSignal.removeEventListener("abort", abortHandler);
      abortHandler = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    },
    cancel() {
      cleanup();
      return cancelProviderStream(requestId);
    },
  });

  const start = new Promise<Response>((resolve, reject) => {
    rejectStart = reject;

    const handleError = (message: string) => {
      cleanup();
      if (hasResolved) {
        controller?.error(new Error(message));
        return;
      }
      reject(new Error(message));
    };

    const resolvePassthroughStream = (headers: Record<string, string>, status: number, chunks: Uint8Array[]) => {
      hasResolved = true;
      resolve(new Response(stream, { headers, status }));
      chunks.forEach((chunk) => controller?.enqueue(chunk));
      bufferedJsonChunks = null;
      bufferedResponseMeta = null;
    };

    void (async () => {
      unlisten = await listen<ProviderStreamEvent>("provider-stream", (event) => {
        const payload = event.payload;
        if (getProviderStreamRequestId(payload) !== requestId) return;

        if (payload.type === "start") {
          if (
            payload.ok
            && requestExpectsChatCompletionStream(request)
          ) {
            bufferedJsonChunks = [];
            bufferedResponseMeta = { headers: payload.headers, status: payload.status };
            return;
          }

          hasResolved = true;
          resolve(new Response(stream, {
            headers: payload.headers,
            status: payload.status,
          }));
          return;
        }

        if (payload.type === "chunk") {
          const chunk = new Uint8Array(payload.chunk);
          if (bufferedJsonChunks) {
            bufferedJsonChunks.push(chunk);
            const sniffedBodyType = sniffBufferedStreamBody(bufferedJsonChunks);
            if (sniffedBodyType === "sse" || sniffedBodyType === "passthrough") {
              resolvePassthroughStream(
                bufferedResponseMeta?.headers ?? {},
                bufferedResponseMeta?.status ?? 200,
                bufferedJsonChunks,
              );
            }
            return;
          }
          controller?.enqueue(chunk);
          return;
        }

        if (payload.type === "end") {
          cleanup();
          if (bufferedJsonChunks && bufferedResponseMeta) {
            const merged = mergeChunks(bufferedJsonChunks);
            const rawBody = new TextDecoder().decode(merged);
            const converted = convertChatCompletionJsonToSse(rawBody);
            if (converted) {
              const headers: Record<string, string> = {
                ...bufferedResponseMeta.headers,
                "content-type": "text/event-stream; charset=utf-8",
                "x-ainovelstudio-stream-fallback": "chat-completion-json",
              };
              delete headers["content-length"];
              hasResolved = true;
              resolve(createBufferedResponse({
                body: converted,
                headers,
                status: bufferedResponseMeta.status,
              }));
              return;
            }

            hasResolved = true;
            resolve(createBufferedResponse({
              body: merged,
              headers: bufferedResponseMeta.headers,
              status: bufferedResponseMeta.status,
            }));
            return;
          }
          controller?.close();
          return;
        }

        handleError(payload.message);
      });

      if (hasAborted) {
        cleanup();
        return;
      }
      await invoke<void>("stream_provider_request", { request: { ...request, requestId } });
    })().catch((error) => {
      handleError(error instanceof Error ? error.message : String(error));
    });
  });

  if (abortSignal) {
    abortHandler = () => {
      hasAborted = true;
      cleanup();
      void cancelProviderStream(requestId);
      const abortError = new DOMException("Provider request aborted.", "AbortError");
      if (hasResolved) {
        controller?.error(abortError);
        return;
      }
      rejectStart?.(abortError);
    };
    abortSignal.addEventListener("abort", abortHandler, { once: true });
  }

  return start;
}

function mergeChunks(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
