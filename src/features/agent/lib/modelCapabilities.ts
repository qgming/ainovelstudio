export type ReasoningSupportSource = "models.dev" | "heuristic" | "unknown";

export type ReasoningSupport = {
  source: ReasoningSupportSource;
  supported: boolean | "unknown";
};

type ModelsDevModel = {
  id?: string;
  reasoning?: boolean;
};

type ModelsDevProvider = {
  models?: Record<string, ModelsDevModel>;
};

type ModelsDevCatalog = Record<string, ModelsDevProvider>;

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const MODELS_DEV_TIMEOUT_MS = 2500;

let catalogPromise: Promise<ModelsDevCatalog | null> | null = null;

function normalizeModelId(modelId: string) {
  return modelId.trim().toLowerCase();
}

function stripProviderPrefix(modelId: string) {
  const normalized = normalizeModelId(modelId);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

export function getHeuristicReasoningSupport(modelId: string): ReasoningSupport {
  const normalized = stripProviderPrefix(modelId);
  if (!normalized) {
    return { source: "unknown", supported: "unknown" };
  }

  if (/^(o[134]|gpt-5|gpt-6)(?:\.|-|$)/u.test(normalized)) {
    return { source: "heuristic", supported: true };
  }

  if (
    normalized.includes("reasoning")
    || normalized.includes("thinking")
    || normalized.includes("deepseek-r1")
    || normalized.includes("qwq")
  ) {
    return { source: "heuristic", supported: true };
  }

  if (/^(gpt-4|gpt-3|chatgpt-4o|text-|embedding-)/u.test(normalized)) {
    return { source: "heuristic", supported: false };
  }

  return { source: "unknown", supported: "unknown" };
}

function parseModelsDevCatalog(payload: unknown): ModelsDevCatalog | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  return payload as ModelsDevCatalog;
}

async function fetchModelsDevCatalog() {
  if (catalogPromise) {
    return catalogPromise;
  }

  catalogPromise = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);

    try {
      const response = await fetch(MODELS_DEV_API_URL, {
        cache: "force-cache",
        signal: controller.signal,
      });
      if (!response.ok) {
        return null;
      }
      return parseModelsDevCatalog(await response.json());
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  })();

  return catalogPromise;
}

function findModelInCatalog(catalog: ModelsDevCatalog, modelId: string) {
  const candidates = new Set([
    normalizeModelId(modelId),
    stripProviderPrefix(modelId),
  ]);

  for (const provider of Object.values(catalog)) {
    const models = provider.models ?? {};
    for (const [key, model] of Object.entries(models)) {
      const normalizedKey = normalizeModelId(key);
      const normalizedId = normalizeModelId(model.id ?? "");
      if (candidates.has(normalizedKey) || candidates.has(normalizedId)) {
        return model;
      }
    }
  }

  return null;
}

export async function getModelsDevReasoningSupport(modelId: string): Promise<ReasoningSupport> {
  if (import.meta.env.MODE === "test") {
    return getHeuristicReasoningSupport(modelId);
  }

  const catalog = await fetchModelsDevCatalog();
  if (!catalog) {
    return getHeuristicReasoningSupport(modelId);
  }

  const model = findModelInCatalog(catalog, modelId);
  if (!model || typeof model.reasoning !== "boolean") {
    return getHeuristicReasoningSupport(modelId);
  }

  return {
    source: "models.dev",
    supported: model.reasoning,
  };
}
