import { forwardProviderRequestViaTauri } from "@features/agent/lib/providerApi";
import { decodeText } from "./fanqieDecoder";
import {
  FEMALE_CATEGORIES_BASE,
  MALE_CATEGORIES_BASE,
  OVERALL_CATEGORY_ID,
} from "./leaderboardCatalog";
import type { FanqieRankBook, LeaderboardBook, LeaderboardRequest, SubCategory } from "./types";

const FANQIE_BASE_URL = "https://fanqienovel.com";
const FANQIE_APP_ID = "1967";
const DEFAULT_LIMIT = 30;
const RANK_LIST_TYPE = "3";
const CACHE_VERSION = "v2";
const CACHE_PREFIX = "ainovelstudio:fanqie-leaderboard";

type CategoryFetchPlan = {
  categories: SubCategory[];
  forceRefresh?: boolean;
  gender: 0 | 1;
  type: 1 | 2;
};

type InitialState = {
  rank?: {
    book_list?: FanqieRankBook[];
  };
};

type RankApiResponse = {
  code?: number;
  data?: {
    book_list?: FanqieRankBook[];
  };
  message?: string;
};

type CachePayload = {
  books: LeaderboardBook[];
  date: string;
  version: string;
};

export function buildFanqieRankUrl(request: LeaderboardRequest) {
  return `${FANQIE_BASE_URL}/rank/${request.gender}_${request.type}_${request.categoryId}`;
}

export function buildFanqieRankApiUrl(request: LeaderboardRequest) {
  const params = new URLSearchParams({
    app_id: FANQIE_APP_ID,
    category_id: String(request.categoryId),
    gender: String(request.gender),
    limit: String(request.limit ?? DEFAULT_LIMIT),
    offset: String(request.offset ?? 0),
    rankMold: String(request.type),
    rank_list_type: RANK_LIST_TYPE,
    rank_version: "",
  });
  return `${FANQIE_BASE_URL}/api/rank/category/list?${params.toString()}`;
}

export function parseReadableCount(value?: string | number): number {
  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text) return 0;
  const multiplier = text.endsWith("万") ? 10_000 : 1;
  const normalized = text.replace(/万$/, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed * multiplier) : 0;
}

export function formatCount(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return value.toLocaleString("zh-CN");
}

function getTodayKey() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function getCacheKey(request: LeaderboardRequest) {
  return `${CACHE_PREFIX}:${CACHE_VERSION}:${getTodayKey()}:${request.gender}:${request.type}:${request.categoryId}`;
}

function getCacheStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readCachedBooks(request: LeaderboardRequest): LeaderboardBook[] | null {
  const storage = getCacheStorage();
  if (!storage || request.forceRefresh) return null;
  const raw = storage.getItem(getCacheKey(request));
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as CachePayload;
    if (payload.version !== CACHE_VERSION || payload.date !== getTodayKey()) return null;
    if (!Array.isArray(payload.books)) return null;
    const requestedLimit = request.limit ?? DEFAULT_LIMIT;
    return payload.books.length >= requestedLimit ? payload.books : null;
  } catch {
    return null;
  }
}

function writeCachedBooks(request: LeaderboardRequest, books: LeaderboardBook[]) {
  const storage = getCacheStorage();
  if (!storage) return;
  const payload: CachePayload = { books, date: getTodayKey(), version: CACHE_VERSION };
  try {
    storage.setItem(getCacheKey(request), JSON.stringify(payload));
  } catch {
    // Cache storage is best-effort; fetching should still succeed if quota is full.
  }
}

function extractJsonObject(source: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === "\\") {
      escapeNext = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return source.slice(startIndex, index + 1);
  }
  return null;
}

function parseInitialBooks(html: string): FanqieRankBook[] {
  const marker = "window.__INITIAL_STATE__=";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return [];
  const objectStart = html.indexOf("{", markerIndex + marker.length);
  if (objectStart < 0) return [];
  const jsonText = extractJsonObject(html, objectStart);
  if (!jsonText) return [];
  const state = JSON.parse(jsonText) as InitialState;
  return state.rank?.book_list ?? [];
}

function parseDomBooks(html: string): FanqieRankBook[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = Array.from(doc.querySelectorAll(".book-item"))
    .filter((item) => item.querySelector(".title a"));
  return items.map((item, index) => ({
    abstract: item.querySelector(".abstract")?.textContent?.trim(),
    author: item.querySelector(".author")?.textContent?.trim(),
    bookName: item.querySelector(".title a")?.textContent?.trim(),
    bookId: item.querySelector(".title a")?.getAttribute("href")?.split("/").pop(),
    creationStatus: item.querySelector(".book-item-footer-status")?.textContent?.includes("连载") ? "1" : "0",
    currentPos: index + 1,
    read_count: item.querySelector(".book-item-count")?.textContent?.replace("在读：", "").trim(),
  }));
}

function normalizeBook(book: FanqieRankBook, index: number, category?: SubCategory): LeaderboardBook {
  const readCount = parseReadableCount(book.read_count || book.readCount);
  const bookId = book.bookId?.trim();
  return {
    abstract: book.abstract ? decodeText(book.abstract) : undefined,
    author: decodeText(book.author ?? ""),
    bookId,
    bookName: decodeText(book.bookName ?? "未命名作品"),
    category: category?.name ?? decodeText(book.category ?? ""),
    detailUrl: bookId ? `${FANQIE_BASE_URL}/page/${bookId}` : undefined,
    rank: book.currentPos ?? index + 1,
    readCount,
    status: book.creationStatus === "1" ? "连载中" : "已完结",
    thumbUri: book.thumbUri,
    wordCount: parseReadableCount(book.wordNumber),
  };
}

async function fetchRankHtml(request: LeaderboardRequest) {
  const response = await forwardProviderRequestViaTauri({
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Cache-Control": "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    method: "GET",
    url: buildFanqieRankUrl(request),
  });
  if (!response.ok) throw new Error(`番茄排行榜请求失败：HTTP ${response.status}`);
  return response.body;
}

async function fetchRankApiBooks(request: LeaderboardRequest) {
  const response = await forwardProviderRequestViaTauri({
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Cache-Control": "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    method: "GET",
    url: buildFanqieRankApiUrl(request),
  });
  if (!response.ok) throw new Error(`番茄排行榜请求失败：HTTP ${response.status}`);
  const payload = JSON.parse(response.body) as RankApiResponse;
  if (payload.code !== 0) throw new Error(payload.message || "番茄排行榜接口返回异常。");
  return payload.data?.book_list ?? [];
}

export function parseLeaderboardBooks(html: string, category?: SubCategory): LeaderboardBook[] {
  const sourceBooks = parseInitialBooks(html);
  const books = sourceBooks.length > 0 ? sourceBooks : parseDomBooks(html);
  return books.map((book, index) => normalizeBook(book, index, category));
}

async function fetchRankBooks(request: LeaderboardRequest, category?: SubCategory) {
  const cachedBooks = readCachedBooks(request);
  if (cachedBooks) return cachedBooks;
  let apiError: unknown;
  try {
    const sourceBooks = await fetchRankApiBooks(request);
    if (sourceBooks.length > 0) {
      const books = sourceBooks.map((book, index) => normalizeBook(book, index, category));
      writeCachedBooks(request, books);
      return books;
    }
  } catch (error) {
    apiError = error;
  }

  try {
    const html = await fetchRankHtml(request);
    const books = parseLeaderboardBooks(html, category);
    if (books.length > 0) {
      writeCachedBooks(request, books);
      return books;
    }
  } catch {
    if (apiError) throw apiError;
  }
  return [];
}

export async function fetchLeaderboard(request: LeaderboardRequest): Promise<LeaderboardBook[]> {
  if (request.categoryId === OVERALL_CATEGORY_ID) {
    return fetchOverallLeaderboard(request);
  }
  const limit = request.limit ?? DEFAULT_LIMIT;
  const fetchLimit = Math.max(limit, DEFAULT_LIMIT);
  const books = (await fetchRankBooks({ ...request, limit: fetchLimit }, getRequestCategory(request))).slice(0, limit);
  if (books.length === 0) throw new Error("番茄排行榜解析为空。");
  return books;
}

function getOverallCategories(gender: 0 | 1) {
  return gender === 1 ? MALE_CATEGORIES_BASE : FEMALE_CATEGORIES_BASE;
}

function getRequestCategory(request: LeaderboardRequest) {
  return getOverallCategories(request.gender).find((category) => category.id === request.categoryId);
}

function getDedupKey(book: LeaderboardBook) {
  return book.bookId || book.detailUrl || `${book.bookName}-${book.author}`;
}

async function fetchCategoryPlanBooks(plan: CategoryFetchPlan) {
  const categoryBooks = await Promise.all(
    plan.categories.map(async (category) => {
      return fetchRankBooks({
        categoryId: category.id,
        forceRefresh: plan.forceRefresh,
        gender: plan.gender,
        limit: DEFAULT_LIMIT,
        type: plan.type,
      }, category);
    }),
  );
  return categoryBooks.flat();
}

function rankMergedBooks(books: LeaderboardBook[], limit?: number) {
  const deduped = new Map<string, LeaderboardBook>();
  for (const book of books) {
    const key = getDedupKey(book);
    if (!deduped.has(key) || deduped.get(key)!.readCount < book.readCount) {
      deduped.set(key, book);
    }
  }
  const rankedBooks = Array.from(deduped.values())
    .sort((a, b) => b.readCount - a.readCount);
  const visibleBooks = typeof limit === "number" ? rankedBooks.slice(0, limit) : rankedBooks;
  return visibleBooks.map((book, index) => ({ ...book, rank: index + 1 }));
}

export async function fetchOverallLeaderboard(request: LeaderboardRequest): Promise<LeaderboardBook[]> {
  const books = await fetchCategoryPlanBooks({
    categories: getOverallCategories(request.gender),
    forceRefresh: request.forceRefresh,
    gender: request.gender,
    type: request.type,
  });
  return rankMergedBooks(books, request.limit);
}

export async function fetchFanqieOverallLeaderboard(
  limit?: number,
  options: { forceRefresh?: boolean } = {},
): Promise<LeaderboardBook[]> {
  const plans: CategoryFetchPlan[] = [
    { categories: MALE_CATEGORIES_BASE, forceRefresh: options.forceRefresh, gender: 1, type: 2 },
    { categories: MALE_CATEGORIES_BASE, forceRefresh: options.forceRefresh, gender: 1, type: 1 },
    { categories: FEMALE_CATEGORIES_BASE, forceRefresh: options.forceRefresh, gender: 0, type: 2 },
    { categories: FEMALE_CATEGORIES_BASE, forceRefresh: options.forceRefresh, gender: 0, type: 1 },
  ];
  const planBooks = await Promise.all(plans.map(fetchCategoryPlanBooks));
  return rankMergedBooks(planBooks.flat(), limit);
}
