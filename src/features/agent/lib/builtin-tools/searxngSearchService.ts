import { forwardProviderRequestViaTauri } from "../providerApi";
import {
  CLIENT_REQUEST_TIMEOUT_MS,
  COOLDOWN_BY_FAILURE,
  DEFAULT_SEARXNG_INSTANCES,
} from "./webSearchConstants";
import type {
  FailureCode,
  SearchFailure,
  SearxngInstanceState,
  WebSearchResponse,
  WebSearchResult,
} from "./webSearchTypes";

const createInstanceState = (baseUrl: string): SearxngInstanceState => ({
  baseUrl,
  failureCount: 0,
  cooldownUntil: 0,
  successCount: 0,
  lastCheckedAt: 0,
});

function normalizeUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function decodeHtmlText(value: string) {
  if (!value.trim()) {
    return "";
  }

  if (typeof DOMParser === "function") {
    const parsed = new DOMParser().parseFromString(
      `<!doctype html><body>${value}`,
      "text/html",
    );
    return parsed.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
  }

  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function buildRequestHeaders(language: string) {
  return {
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": language,
    "Cache-Control": "no-cache",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };
}

function mapStatusCode(status: number): FailureCode {
  if (status === 429) {
    return "rate_limited";
  }
  if (status === 403) {
    return "anti_bot";
  }
  if (status === 406 || status === 415) {
    return "format_blocked";
  }
  return "http_error";
}

function mapUnknownError(message: string): FailureCode {
  const normalized = message.toLowerCase();
  if (normalized.includes("timeout") || normalized.includes("aborted")) {
    return "timeout";
  }
  if (
    normalized.includes("network")
    || normalized.includes("failed to fetch")
    || normalized.includes("connection")
  ) {
    return "network";
  }
  return "unknown";
}

function parseHtmlResults(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const articleRe =
    /<article[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null = null;

  while ((match = articleRe.exec(html)) !== null && results.length < limit) {
    const block = match[1];
    const url = block.match(/href="(https?:\/\/[^"]+)"/i)?.[1] ?? "";
    if (!url) {
      continue;
    }

    const title = decodeHtmlText(
      block.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "",
    );
    const snippet = decodeHtmlText(
      block.match(/<p[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1]
        ?? "",
    );

    results.push({ url, title, snippet, source: url });
  }

  return results;
}

async function withTimeout<T>(task: () => Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    task()
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

class SearxngSearchService {
  private instances = DEFAULT_SEARXNG_INSTANCES.map((url) =>
    createInstanceState(normalizeUrl(url)),
  );

  private nextIndex = 0;

  setInstances(urls: string[]) {
    const unique = Array.from(new Set(urls.map(normalizeUrl).filter(Boolean)));
    if (unique.length === 0) {
      return;
    }
    this.instances = unique.map(createInstanceState);
    this.nextIndex = 0;
  }

  private getNextCandidate(triedInstances: Set<string>) {
    if (this.instances.length === 0) {
      return null;
    }

    const now = Date.now();
    for (let offset = 0; offset < this.instances.length; offset += 1) {
      const index = (this.nextIndex + offset) % this.instances.length;
      const candidate = this.instances[index];
      if (triedInstances.has(candidate.baseUrl)) {
        continue;
      }
      if (candidate.cooldownUntil <= now) {
        this.nextIndex = (index + 1) % this.instances.length;
        return candidate;
      }
    }

    const fallback = this.instances
      .filter((candidate) => !triedInstances.has(candidate.baseUrl))
      .sort((left, right) => left.cooldownUntil - right.cooldownUntil)[0];
    if (!fallback) {
      return null;
    }
    this.nextIndex = (this.instances.indexOf(fallback) + 1) % this.instances.length;
    return fallback;
  }

  private markSuccess(instance: SearxngInstanceState) {
    instance.successCount += 1;
    instance.failureCount = 0;
    instance.cooldownUntil = 0;
    instance.lastCheckedAt = Date.now();
    instance.lastErrorCode = undefined;
    instance.lastErrorMessage = undefined;
  }

  private markFailure(
    instance: SearxngInstanceState,
    code: FailureCode,
    message: string,
  ) {
    instance.failureCount += 1;
    instance.lastCheckedAt = Date.now();
    instance.lastErrorCode = code;
    instance.lastErrorMessage = message;
    instance.cooldownUntil = Date.now() + COOLDOWN_BY_FAILURE[code];
  }

  private async tryViaHtmlSearch(
    instance: SearxngInstanceState,
    query: string,
    options: { limit: number; language: string; safesearch: 0 | 1 | 2 },
  ) {
    const params = new URLSearchParams({
      q: query,
      language: options.language,
      safesearch: String(options.safesearch),
    });

    try {
      const response = await withTimeout(
        () =>
          forwardProviderRequestViaTauri({
            headers: buildRequestHeaders(options.language),
            method: "GET",
            url: `${instance.baseUrl}/search?${params.toString()}`,
          }),
        CLIENT_REQUEST_TIMEOUT_MS,
      );

      if (!response.ok) {
        return {
          success: false as const,
          failure: {
            code: mapStatusCode(response.status),
            endpoint: "/search" as const,
            instance: instance.baseUrl,
            message: `HTTP ${response.status}`,
            method: "GET" as const,
            stage: "get_root" as const,
            status: response.status,
          },
        };
      }

      const results = parseHtmlResults(response.body, options.limit);
      if (
        results.length === 0
        && /(not a bot|captcha|cloudflare)/i.test(response.body)
      ) {
        return {
          success: false as const,
          failure: {
            code: "anti_bot" as const,
            endpoint: "/search" as const,
            instance: instance.baseUrl,
            message: "触发反爬校验",
            method: "GET" as const,
            stage: "get_root" as const,
          },
        };
      }

      return { success: true as const, results };
    } catch (error) {
      const message = error instanceof Error ? error.message : "请求失败";
      return {
        success: false as const,
        failure: {
          code: mapUnknownError(message),
          endpoint: "/search" as const,
          instance: instance.baseUrl,
          message,
          method: "GET" as const,
          stage: "get_root" as const,
        },
      };
    }
  }

  async search(
    query: string,
    options?: { limit?: number; language?: string; safesearch?: 0 | 1 | 2 },
  ): Promise<WebSearchResponse> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      return {
        success: false,
        query,
        provider: "searxng",
        instance: "",
        totalCount: 0,
        results: [],
        error: "查询内容不能为空",
      };
    }

    const failures: SearchFailure[] = [];
    const triedInstances = new Set<string>();
    const limit = Math.min(Math.max(options?.limit ?? 5, 1), 10);
    const language = options?.language ?? "zh-CN";
    const safesearch = options?.safesearch ?? 1;

    for (let attemptIndex = 0; attemptIndex < this.instances.length; attemptIndex += 1) {
      const instance = this.getNextCandidate(triedInstances);
      if (!instance) {
        break;
      }
      triedInstances.add(instance.baseUrl);

      const attempt = await this.tryViaHtmlSearch(instance, normalizedQuery, {
        language,
        limit,
        safesearch,
      });
      if (attempt.success) {
        this.markSuccess(instance);
        return {
          success: true,
          query: normalizedQuery,
          provider: "searxng",
          instance: instance.baseUrl,
          totalCount: attempt.results.length,
          results: attempt.results,
        };
      }

      failures.push(attempt.failure);
      this.markFailure(instance, attempt.failure.code, attempt.failure.message);
    }

    const errorPreview = failures
      .slice(0, 3)
      .map((item) => `${item.instance}(${item.code})`)
      .join("；");

    return {
      success: false,
      query: normalizedQuery,
      provider: "searxng",
      instance: "",
      totalCount: 0,
      results: [],
      error: errorPreview || "没有可用的搜索实例",
      errorSummary: {
        totalAttempts: failures.length,
        failures: failures.slice(0, 20),
      },
    };
  }
}

export const searxngSearchService = new SearxngSearchService();
