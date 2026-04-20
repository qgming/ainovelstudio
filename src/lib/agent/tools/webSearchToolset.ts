import type { AgentTool } from "../runtime";
import { ensureString, ok } from "./shared";
import { searxngSearchService } from "./searxngSearchService";
import type { WebSearchResult } from "./webSearchTypes";

function formatSearchSummary(query: string, resultCount: number, instance: string) {
  if (resultCount === 0) {
    return `已搜索“${query}”，当前没有返回结果。`;
  }

  return `已搜索“${query}”，通过 ${instance} 返回 ${resultCount} 条结果。`;
}

function normalizeDomains(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .map((item) => String(item).trim().toLowerCase())
        .filter(Boolean)
        .map((domain) => domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")),
    ),
  );
}

function buildQueryWithDomains(query: string, domains: string[]) {
  if (domains.length === 0) {
    return query;
  }

  const domainQuery = domains
    .map((domain, index) => (index === 0 ? `site:${domain}` : `OR site:${domain}`))
    .join(" ");

  return `${query} ${domainQuery}`.trim();
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function matchesDomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function scoreResult(result: WebSearchResult, normalizedQuery: string, domains: string[]) {
  const hostname = getHostname(result.url);
  const title = result.title.toLowerCase();
  const snippet = result.snippet.toLowerCase();
  let score = 0;

  if (domains.some((domain) => matchesDomain(hostname, domain))) {
    score += 100;
  }
  if (title.includes(normalizedQuery)) {
    score += 40;
  }
  if (snippet.includes(normalizedQuery)) {
    score += 20;
  }

  return score;
}

function finalizeResults(
  results: WebSearchResult[],
  query: string,
  domains: string[],
  limit: number,
) {
  const normalizedQuery = query.trim().toLowerCase();
  const deduped = new Map<string, WebSearchResult>();
  for (const result of results) {
    const existing = deduped.get(result.url);
    if (!existing) {
      deduped.set(result.url, result);
      continue;
    }

    if (
      scoreResult(result, normalizedQuery, domains) >
      scoreResult(existing, normalizedQuery, domains)
    ) {
      deduped.set(result.url, result);
    }
  }
  const domainFiltered =
    domains.length === 0
      ? Array.from(deduped.values())
      : Array.from(deduped.values()).filter((result) =>
          domains.some((domain) =>
            matchesDomain(getHostname(result.url), domain),
          ),
        );

  return [...domainFiltered]
    .sort(
      (left, right) =>
        scoreResult(right, normalizedQuery, domains) -
          scoreResult(left, normalizedQuery, domains) ||
        left.url.localeCompare(right.url, "zh-CN"),
    )
    .slice(0, limit);
}

export function createWebSearchTools(): Record<string, AgentTool> {
  return {
    web_search: {
      description: "搜索公开网页并返回结果列表",
      execute: async (input) => {
        const query = ensureString(input.query, "web_search.query");
        const domains = normalizeDomains(input.domains);
        const limit =
          typeof input.limit === "number" && Number.isFinite(input.limit)
            ? Math.trunc(input.limit)
            : undefined;
        const effectiveQuery = buildQueryWithDomains(query, domains);
        const response = await searxngSearchService.search(effectiveQuery, {
          language:
            typeof input.language === "string" && input.language.trim()
              ? input.language.trim()
              : undefined,
          limit,
          safesearch:
            input.safesearch === 0 || input.safesearch === 2 ? input.safesearch : 1,
        });

        if (!response.success) {
          return ok(
            `网络搜索失败：${response.error ?? "没有可用的搜索实例"}`,
            response,
          );
        }

        const nextResults = finalizeResults(
          response.results,
          query,
          domains,
          limit ?? response.results.length,
        );
        const nextResponse = {
          ...response,
          query: effectiveQuery,
          results: nextResults,
          totalCount: nextResults.length,
        };

        return ok(
          formatSearchSummary(effectiveQuery, nextResponse.totalCount, nextResponse.instance),
          nextResponse,
        );
      },
    },
  };
}
