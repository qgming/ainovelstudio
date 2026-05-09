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
  let hasStarted = false;
  let hasAborted = false;
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
      if (hasStarted) {
        controller?.error(new Error(message));
        return;
      }
      reject(new Error(message));
    };

    void (async () => {
      unlisten = await listen<ProviderStreamEvent>("provider-stream", (event) => {
        const payload = event.payload;
        if (getProviderStreamRequestId(payload) !== requestId) return;

        if (payload.type === "start") {
          hasStarted = true;
          resolve(new Response(stream, {
            headers: payload.headers,
            status: payload.status,
          }));
          return;
        }

        if (payload.type === "chunk") {
          controller?.enqueue(new Uint8Array(payload.chunk));
          return;
        }

        if (payload.type === "end") {
          cleanup();
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
      if (hasStarted) {
        controller?.error(abortError);
        return;
      }
      rejectStart?.(abortError);
    };
    abortSignal.addEventListener("abort", abortHandler, { once: true });
  }

  return start;
}
