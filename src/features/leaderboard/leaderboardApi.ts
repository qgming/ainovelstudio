import { invoke, isTauri } from "@tauri-apps/api/core";
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
const CACHE_VERSION = "v3";
const FANQIE_CATEGORY_CONCURRENCY = 2;
const FANQIE_REQUEST_SPACING_MS = 250;
const FANQIE_MAX_RETRIES = 2;
const FANQIE_RETRY_BASE_DELAY_MS = 900;

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

type LeaderboardSnapshotEntry = {
  books: LeaderboardBook[];
  categoryId: number;
  gender: 0 | 1;
  type: 1 | 2;
};

type SnapshotPayload = {
  date: string;
  entries: LeaderboardSnapshotEntry[];
  version: string;
};

type LeaderboardSnapshot = {
  entries: LeaderboardSnapshotEntry[];
  fanqieOverall: LeaderboardBook[];
};

type FanqieForwardRequest = Parameters<typeof forwardProviderRequestViaTauri>[0];

let nextFanqieRequestAt = 0;
const inFlightRankRequests = new Map<string, Promise<LeaderboardBook[]>>();
const inFlightMergedRequests = new Map<string, Promise<LeaderboardBook[]>>();
const memoryRankBooks = new Map<string, LeaderboardBook[]>();
let inFlightSnapshotRequest: Promise<LeaderboardSnapshot> | null = null;
let memorySnapshotDate: string | null = null;
let memorySnapshot: LeaderboardSnapshot | null = null;

class FanqieHttpError extends Error {
  constructor(public readonly status: number) {
    super(`番茄排行榜请求失败：HTTP ${status}`);
    this.name = "FanqieHttpError";
  }
}

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

function getRankCacheKey(request: Pick<LeaderboardRequest, "categoryId" | "gender" | "type">) {
  return `${getTodayKey()}:${request.gender}:${request.type}:${request.categoryId}`;
}

function getRankRequestKey(request: LeaderboardRequest) {
  return `${getRankCacheKey(request)}:${request.limit ?? DEFAULT_LIMIT}:${request.forceRefresh ? "force" : "auto"}`;
}

function getOverallMergedCacheKey(gender: 0 | 1, type: 1 | 2) {
  return `${getTodayKey()}:overall:${gender}:${type}`;
}

function getFanqieOverallCacheKey() {
  return `${getTodayKey()}:fanqie-overall`;
}

function getCachedMemorySnapshot(): LeaderboardSnapshot | null {
  return memorySnapshotDate === getTodayKey() ? memorySnapshot : null;
}

function readMemoryRankBooks(request: LeaderboardRequest): LeaderboardBook[] | null {
  if (request.forceRefresh) return null;
  const books = memoryRankBooks.get(getRankCacheKey(request));
  if (!books) return null;
  const requestedLimit = request.limit ?? DEFAULT_LIMIT;
  return books.length >= requestedLimit ? books : null;
}

function writeMemoryRankBooks(request: Pick<LeaderboardRequest, "categoryId" | "gender" | "type">, books: LeaderboardBook[]) {
  memoryRankBooks.set(getRankCacheKey(request), books);
}

function indexMemorySnapshot(snapshot: LeaderboardSnapshot) {
  memoryRankBooks.clear();
  for (const entry of snapshot.entries) {
    writeMemoryRankBooks(entry, entry.books);
  }
}

function isSnapshotPayload(value: unknown): value is SnapshotPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<SnapshotPayload>;
  return payload.version === CACHE_VERSION
    && payload.date === getTodayKey()
    && Array.isArray(payload.entries);
}

async function readSqliteSnapshot(): Promise<LeaderboardSnapshotEntry[] | null> {
  if (!isTauri()) return null;
  try {
    const payload = await invoke<SnapshotPayload | null>("read_leaderboard_snapshot", {
      date: getTodayKey(),
      version: CACHE_VERSION,
    });
    return isSnapshotPayload(payload) ? payload.entries : null;
  } catch {
    return null;
  }
}

async function writeSqliteSnapshot(entries: LeaderboardSnapshotEntry[]) {
  if (!isTauri()) return;
  const snapshot: SnapshotPayload = { date: getTodayKey(), entries, version: CACHE_VERSION };
  await invoke<void>("write_leaderboard_snapshot", { snapshot });
}

function sliceCachedBooks(books: LeaderboardBook[] | null, limit?: number) {
  if (!books) return null;
  return typeof limit === "number" ? books.slice(0, limit) : books;
}

function readSnapshotLeaderboard(request: LeaderboardRequest): LeaderboardBook[] | null {
  const snapshot = getCachedMemorySnapshot();
  if (!snapshot) return null;
  const entries = snapshot.entries.filter((entry) => {
    return entry.gender === request.gender
      && entry.type === request.type
      && (request.categoryId === OVERALL_CATEGORY_ID || entry.categoryId === request.categoryId);
  });
  if (entries.length === 0) return null;
  const books = request.categoryId === OVERALL_CATEGORY_ID
    ? rankMergedBooks(entries.flatMap((entry) => entry.books))
    : entries.flatMap((entry) => entry.books);
  return sliceCachedBooks(books, request.limit);
}

export function readCachedLeaderboard(request: LeaderboardRequest): LeaderboardBook[] | null {
  if (request.categoryId === OVERALL_CATEGORY_ID) {
    return readCachedOverallLeaderboard(request);
  }
  const snapshotBooks = readSnapshotLeaderboard(request);
  if (snapshotBooks) return snapshotBooks;
  const limit = request.limit ?? DEFAULT_LIMIT;
  const fetchLimit = Math.max(limit, DEFAULT_LIMIT);
  const books = readMemoryRankBooks({ ...request, limit: fetchLimit });
  return sliceCachedBooks(books, limit);
}

export function readCachedOverallLeaderboard(request: LeaderboardRequest): LeaderboardBook[] | null {
  const snapshotBooks = readSnapshotLeaderboard(request);
  if (snapshotBooks) return snapshotBooks;
  return null;
}

export function readCachedFanqieOverallLeaderboard(limit?: number): LeaderboardBook[] | null {
  const snapshot = getCachedMemorySnapshot();
  if (snapshot) return sliceCachedBooks(snapshot.fanqieOverall, limit);
  return null;
}

function matchesCachedBook(source: LeaderboardBook, target: Partial<LeaderboardBook>) {
  if (source.bookId && target.bookId) return source.bookId === target.bookId;
  if (source.detailUrl && target.detailUrl) return source.detailUrl === target.detailUrl;
  return Boolean(source.bookName && source.bookName === target.bookName && source.author === target.author);
}

export function readCachedLeaderboardBookDetail(book: LeaderboardBook): LeaderboardBook | null {
  const snapshotBooks = getCachedMemorySnapshot()?.entries.flatMap((entry) => entry.books) ?? [];
  const rankBooks = Array.from(memoryRankBooks.values()).flat();
  return [...snapshotBooks, ...rankBooks].find((cachedBook) => matchesCachedBook(cachedBook, book)) ?? null;
}

function isTestMode() {
  return import.meta.env.MODE === "test";
}

function delay(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function getRequestSpacingMs() {
  return isTestMode() ? 0 : FANQIE_REQUEST_SPACING_MS;
}

function getRetryDelayMs(attempt: number) {
  return isTestMode() ? 0 : FANQIE_RETRY_BASE_DELAY_MS * 2 ** attempt;
}

async function waitForFanqieRequestSlot() {
  const spacing = getRequestSpacingMs();
  if (spacing <= 0) return;
  const now = Date.now();
  const waitMs = Math.max(0, nextFanqieRequestAt - now);
  nextFanqieRequestAt = Math.max(now, nextFanqieRequestAt) + spacing;
  await delay(waitMs);
}

function shouldRetryFanqieStatus(status: number) {
  return status === 429 || status === 444 || status >= 500;
}

function isRateLimitedError(error: unknown) {
  return error instanceof FanqieHttpError && (error.status === 429 || error.status === 444);
}

async function forwardFanqieRequest(request: FanqieForwardRequest) {
  for (let attempt = 0; attempt <= FANQIE_MAX_RETRIES; attempt += 1) {
    await waitForFanqieRequestSlot();
    const response = await forwardProviderRequestViaTauri(request);
    if (response.ok || !shouldRetryFanqieStatus(response.status) || attempt >= FANQIE_MAX_RETRIES) {
      return response;
    }
    await delay(getRetryDelayMs(attempt));
  }
  return forwardProviderRequestViaTauri(request);
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
    categoryId: category?.id,
    categoryRank: book.currentPos ?? index + 1,
    detailUrl: bookId ? `${FANQIE_BASE_URL}/page/${bookId}` : undefined,
    rank: book.currentPos ?? index + 1,
    rankPosDiff: typeof book.rankPosDiff === "number" ? book.rankPosDiff : 0,
    readCount,
    status: book.creationStatus === "1" ? "连载中" : "已完结",
    thumbUri: book.thumbUri,
    wordCount: parseReadableCount(book.wordNumber),
  };
}

async function fetchRankHtml(request: LeaderboardRequest) {
  const response = await forwardFanqieRequest({
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Cache-Control": "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    method: "GET",
    url: buildFanqieRankUrl(request),
  });
  if (!response.ok) throw new FanqieHttpError(response.status);
  return response.body;
}

async function fetchRankApiBooks(request: LeaderboardRequest) {
  const response = await forwardFanqieRequest({
    headers: {
      Accept: "application/json,text/plain,*/*",
      "Cache-Control": "no-cache",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    method: "GET",
    url: buildFanqieRankApiUrl(request),
  });
  if (!response.ok) throw new FanqieHttpError(response.status);
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
  const cachedBooks = readMemoryRankBooks(request);
  if (cachedBooks) return cachedBooks;
  const inFlightKey = getRankRequestKey(request);
  const inFlightRequest = inFlightRankRequests.get(inFlightKey);
  if (inFlightRequest) return inFlightRequest;

  const requestPromise = fetchFreshRankBooks(request, category).finally(() => {
    inFlightRankRequests.delete(inFlightKey);
  });
  inFlightRankRequests.set(inFlightKey, requestPromise);
  return requestPromise;
}

async function fetchFreshRankBooks(request: LeaderboardRequest, category?: SubCategory) {
  let apiError: unknown;
  try {
    const sourceBooks = await fetchRankApiBooks(request);
    if (sourceBooks.length > 0) {
      const books = sourceBooks.map((book, index) => normalizeBook(book, index, category));
      writeMemoryRankBooks(request, books);
      return books;
    }
  } catch (error) {
    apiError = error;
    if (isRateLimitedError(error)) throw error;
  }

  try {
    const html = await fetchRankHtml(request);
    const books = parseLeaderboardBooks(html, category);
    if (books.length > 0) {
      writeMemoryRankBooks(request, books);
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
  const cachedBooks = readCachedLeaderboard(request);
  if (cachedBooks) return cachedBooks;
  if (isTauri()) {
    await ensureDailyLeaderboardSnapshot({ forceRefresh: request.forceRefresh });
    const snapshotBooks = readCachedLeaderboard(request);
    if (snapshotBooks) return snapshotBooks;
  }
  const fetchLimit = Math.max(limit, DEFAULT_LIMIT);
  const books = (await fetchRankBooks({ ...request, limit: fetchLimit }, getOverallCategories(request.gender).find((category) => category.id === request.categoryId))).slice(0, limit);
  if (books.length === 0) throw new Error("番茄排行榜解析为空。");
  return books;
}

function getOverallCategories(gender: 0 | 1) {
  return gender === 1 ? MALE_CATEGORIES_BASE : FEMALE_CATEGORIES_BASE;
}

function getAllLeaderboardPlans(forceRefresh?: boolean): CategoryFetchPlan[] {
  return [
    { categories: MALE_CATEGORIES_BASE, forceRefresh, gender: 1, type: 2 },
    { categories: MALE_CATEGORIES_BASE, forceRefresh, gender: 1, type: 1 },
    { categories: FEMALE_CATEGORIES_BASE, forceRefresh, gender: 0, type: 2 },
    { categories: FEMALE_CATEGORIES_BASE, forceRefresh, gender: 0, type: 1 },
  ];
}

function getDedupKey(book: LeaderboardBook) {
  return book.bookId || book.detailUrl || `${book.bookName}-${book.author}`;
}

async function fetchCategoryPlanEntries(plan: CategoryFetchPlan) {
  return mapWithConcurrency(
    plan.categories,
    FANQIE_CATEGORY_CONCURRENCY,
    async (category) => {
      const request = {
        categoryId: category.id,
        forceRefresh: plan.forceRefresh,
        gender: plan.gender,
        limit: DEFAULT_LIMIT,
        type: plan.type,
      };
      return {
        books: await fetchRankBooks(request, category),
        categoryId: category.id,
        gender: plan.gender,
        type: plan.type,
      };
    },
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    runWorker,
  ));
  return results;
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

function buildLeaderboardSnapshot(entries: LeaderboardSnapshotEntry[]) {
  return {
    entries,
    fanqieOverall: rankMergedBooks(entries.flatMap((entry) => entry.books)),
  };
}

function hasSnapshotBooks(entries: LeaderboardSnapshotEntry[]) {
  return entries.some((entry) => entry.books.length > 0);
}

function setMemorySnapshot(snapshot: LeaderboardSnapshot) {
  memorySnapshotDate = getTodayKey();
  memorySnapshot = snapshot;
  indexMemorySnapshot(snapshot);
  return snapshot;
}

async function persistLeaderboardSnapshot(entries: LeaderboardSnapshotEntry[]) {
  await writeSqliteSnapshot(entries);
}

function writeLeaderboardSnapshot(entries: LeaderboardSnapshotEntry[]) {
  return setMemorySnapshot(buildLeaderboardSnapshot(entries));
}

async function fetchLeaderboardSnapshot(forceRefresh = false): Promise<LeaderboardSnapshot> {
  const memorySnapshot = getCachedMemorySnapshot();
  if (memorySnapshot && !forceRefresh) return memorySnapshot;

  const sqliteEntries = await readSqliteSnapshot();
  if (sqliteEntries && sqliteEntries.length > 0 && !forceRefresh) {
    return writeLeaderboardSnapshot(sqliteEntries);
  }

  if (inFlightSnapshotRequest && !forceRefresh) return inFlightSnapshotRequest;

  const requestPromise = (async () => {
    const entries: LeaderboardSnapshotEntry[] = [];
    for (const plan of getAllLeaderboardPlans(forceRefresh || undefined)) {
      entries.push(...await fetchCategoryPlanEntries(plan));
    }
    if (!hasSnapshotBooks(entries)) {
      if (sqliteEntries && sqliteEntries.length > 0) {
        return writeLeaderboardSnapshot(sqliteEntries);
      }
      throw new Error("番茄排行榜全量刷新没有解析到作品，已保留本地数据。");
    }
    const snapshot = writeLeaderboardSnapshot(entries);
    persistLeaderboardSnapshot(entries).catch((error: unknown) => {
      console.warn("番茄排行榜 SQLite 快照保存失败", error);
    });
    return snapshot;
  })().finally(() => {
    if (inFlightSnapshotRequest === requestPromise) inFlightSnapshotRequest = null;
  });

  if (!forceRefresh) inFlightSnapshotRequest = requestPromise;
  return requestPromise;
}

export async function ensureDailyLeaderboardSnapshot(options: { forceRefresh?: boolean } = {}) {
  await fetchLeaderboardSnapshot(Boolean(options.forceRefresh));
}

export async function fetchOverallLeaderboard(request: LeaderboardRequest): Promise<LeaderboardBook[]> {
  const cacheKey = getOverallMergedCacheKey(request.gender, request.type);
  const cachedBooks = readCachedOverallLeaderboard(request);
  if (cachedBooks) return typeof request.limit === "number" ? cachedBooks.slice(0, request.limit) : cachedBooks;
  const inFlightKey = `${cacheKey}:${request.forceRefresh ? "force" : "auto"}`;
  const inFlightRequest = inFlightMergedRequests.get(inFlightKey);
  if (inFlightRequest) {
    const books = await inFlightRequest;
    return typeof request.limit === "number" ? books.slice(0, request.limit) : books;
  }

  const requestPromise = ensureDailyLeaderboardSnapshot({
    forceRefresh: request.forceRefresh,
  }).then(() => readCachedOverallLeaderboard(request) ?? []).finally(() => {
    inFlightMergedRequests.delete(inFlightKey);
  });
  inFlightMergedRequests.set(inFlightKey, requestPromise);
  const rankedBooks = await requestPromise;
  if (rankedBooks.length === 0) throw new Error("当前总榜没有缓存数据，请先刷新全部榜单。");
  return typeof request.limit === "number" ? rankedBooks.slice(0, request.limit) : rankedBooks;
}

export async function fetchFanqieOverallLeaderboard(
  limit?: number,
  options: { forceRefresh?: boolean } = {},
): Promise<LeaderboardBook[]> {
  const cacheKey = getFanqieOverallCacheKey();
  const cachedBooks = options.forceRefresh ? null : readCachedFanqieOverallLeaderboard(limit);
  if (cachedBooks) return typeof limit === "number" ? cachedBooks.slice(0, limit) : cachedBooks;
  const inFlightKey = `${cacheKey}:${options.forceRefresh ? "force" : "auto"}`;
  const inFlightRequest = inFlightMergedRequests.get(inFlightKey);
  if (inFlightRequest) {
    const books = await inFlightRequest;
    return typeof limit === "number" ? books.slice(0, limit) : books;
  }

  const requestPromise = ensureDailyLeaderboardSnapshot({
    forceRefresh: options.forceRefresh,
  }).then(() => readCachedFanqieOverallLeaderboard() ?? []).finally(() => {
    inFlightMergedRequests.delete(inFlightKey);
  });
  inFlightMergedRequests.set(inFlightKey, requestPromise);
  const rankedBooks = await requestPromise;
  if (rankedBooks.length === 0) throw new Error("当前番茄总榜没有缓存数据，请先刷新全部榜单。");
  return typeof limit === "number" ? rankedBooks.slice(0, limit) : rankedBooks;
}

export function __resetLeaderboardCacheForTests() {
  if (!isTestMode()) return;
  nextFanqieRequestAt = 0;
  inFlightRankRequests.clear();
  inFlightMergedRequests.clear();
  memoryRankBooks.clear();
  inFlightSnapshotRequest = null;
  memorySnapshotDate = null;
  memorySnapshot = null;
}
