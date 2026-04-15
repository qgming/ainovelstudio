import type { BookWorkspaceSummary } from "./types";

type BookWorkspaceRouteCache = Record<string, BookWorkspaceSummary>;

const WORKSPACE_ROUTE_CACHE_KEY = "ainovelstudio-book-route-cache";

function isBookWorkspaceSummary(value: unknown): value is BookWorkspaceSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const summary = value as Partial<BookWorkspaceSummary>;
  return (
    typeof summary.id === "string" &&
    typeof summary.name === "string" &&
    typeof summary.path === "string" &&
    typeof summary.updatedAt === "number"
  );
}

function readBookWorkspaceRouteCache(): BookWorkspaceRouteCache {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_ROUTE_CACHE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, BookWorkspaceSummary] => {
        const [bookId, summary] = entry;
        return typeof bookId === "string" && isBookWorkspaceSummary(summary);
      }),
    );
  } catch {
    return {};
  }
}

function writeBookWorkspaceRouteCache(cache: BookWorkspaceRouteCache) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(WORKSPACE_ROUTE_CACHE_KEY, JSON.stringify(cache));
}

export function cacheBookWorkspaceSummary(summary: BookWorkspaceSummary) {
  if (!summary.id.trim()) {
    return;
  }

  const cache = readBookWorkspaceRouteCache();
  cache[summary.id] = summary;
  writeBookWorkspaceRouteCache(cache);
}

export function cacheBookWorkspaceSummaries(summaries: BookWorkspaceSummary[]) {
  const cache: BookWorkspaceRouteCache = {};
  for (const summary of summaries) {
    if (!summary.id.trim()) {
      continue;
    }
    cache[summary.id] = summary;
  }
  writeBookWorkspaceRouteCache(cache);
}

export function getCachedBookWorkspaceSummary(bookId: string) {
  const summary = readBookWorkspaceRouteCache()[bookId];
  return isBookWorkspaceSummary(summary) ? summary : null;
}
