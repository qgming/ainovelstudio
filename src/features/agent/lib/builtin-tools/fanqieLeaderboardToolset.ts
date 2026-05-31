import {
  fetchLeaderboard,
  fetchOverallLeaderboard,
  formatCount,
  readCachedLeaderboardBookDetail,
} from "@features/leaderboard/leaderboardApi";
import { MAIN_BOARDS, OVERALL_CATEGORY_ID } from "@features/leaderboard/leaderboardCatalog";
import { buildLeaderboardStats, formatPercent } from "@features/leaderboard/leaderboardStats";
import type { LeaderboardBook, MainBoard, SubCategory } from "@features/leaderboard/types";
import type { AgentTool } from "../runtime";
import { asPositiveInt, ensureString, ok } from "./shared";

const BOARD_IDS = new Set(MAIN_BOARDS.map((board) => board.id));
const DEFAULT_CATEGORY_LIMIT = 30;
const MAX_LIMIT = 5000;
const DEFAULT_STATS_LIMIT = 10;
const MAX_STATS_LIMIT = 30;

type LeaderboardAction = "books" | "details" | "stats";
type RankRange = { from: number; to: number };

function normalizeAction(input: Record<string, unknown>): LeaderboardAction {
  const action = typeof input.action === "string" ? input.action.trim() : "books";
  if (action === "details" || action === "stats" || action === "books") return action;
  throw new Error("leaderboard.action 只支持 books、details、stats。");
}

function normalizeBoard(input: Record<string, unknown>): MainBoard {
  const boardId = typeof input.board === "string" ? input.board.trim() : "";
  if (boardId === "fanqie-overall") {
    throw new Error("小说排行榜工具只读取四个主榜，请选择 male-reading、male-new、female-reading 或 female-new。");
  }
  if (BOARD_IDS.has(boardId)) {
    return MAIN_BOARDS.find((board) => board.id === boardId) ?? MAIN_BOARDS[0];
  }

  const gender = input.gender === 0 || input.gender === 1 ? input.gender : undefined;
  const type = input.type === 1 || input.type === 2 ? input.type : undefined;
  return MAIN_BOARDS.find((board) => board.gender === gender && board.type === type) ?? MAIN_BOARDS[0];
}

function normalizeCategory(input: Record<string, unknown>, board: MainBoard): SubCategory {
  if (typeof input.categoryId === "number" && Number.isFinite(input.categoryId)) {
    const categoryId = Math.trunc(input.categoryId);
    return board.subCategories.find((category) => category.id === categoryId)
      ?? { id: categoryId, name: categoryId === OVERALL_CATEGORY_ID ? "总榜" : `分类 ${categoryId}` };
  }

  const categoryName = typeof input.categoryName === "string" ? input.categoryName.trim() : "";
  if (!categoryName || categoryName === "总榜") {
    return board.subCategories[0];
  }
  const matched = board.subCategories.find((category) => category.name === categoryName)
    ?? board.subCategories.find((category) => category.name.includes(categoryName));
  if (!matched) throw new Error(`未找到 ${board.name} 分类：${categoryName}`);
  return matched;
}

function normalizeRankRange(input: Record<string, unknown>): RankRange | null {
  if (typeof input.rank === "number" && Number.isFinite(input.rank)) {
    const rank = Math.max(1, Math.trunc(input.rank));
    return { from: rank, to: rank };
  }

  const hasRange = input.rankFrom != null || input.rankTo != null || input.limit != null;
  if (!hasRange) return null;

  const from = asPositiveInt(input.rankFrom, 1);
  const limit = Math.min(asPositiveInt(input.limit, DEFAULT_CATEGORY_LIMIT), MAX_LIMIT);
  const to = typeof input.rankTo === "number" && Number.isFinite(input.rankTo)
    ? Math.max(from, Math.trunc(input.rankTo))
    : from + limit - 1;
  return { from, to: Math.min(to, MAX_LIMIT) };
}

function filterBooksByRank(books: LeaderboardBook[], range: RankRange | null) {
  if (!range) return books;
  return books.filter((book) => book.rank >= range.from && book.rank <= range.to);
}

function formatRankRange(range: RankRange | null) {
  if (!range) return "全部排名";
  return range.from === range.to ? `第 ${range.from} 名` : `第 ${range.from}-${range.to} 名`;
}

function formatRankPosDiff(diff: number) {
  if (diff > 0) return `上升 ${diff} 名`;
  if (diff < 0) return `下降 ${Math.abs(diff)} 名`;
  return "排名无变化";
}

function withoutAbstract(book: LeaderboardBook) {
  const { abstract: _abstract, ...bookWithoutAbstract } = book;
  return {
    ...bookWithoutAbstract,
    rankPosDiffText: formatRankPosDiff(book.rankPosDiff ?? 0),
    readCountText: formatCount(book.readCount),
    wordCountText: book.wordCount > 0 ? `${formatCount(book.wordCount)}字` : "字数未知",
  };
}

function withDetail(book: LeaderboardBook) {
  return {
    ...book,
    abstract: book.abstract?.trim() || "",
    rankPosDiffText: formatRankPosDiff(book.rankPosDiff ?? 0),
    readCountText: formatCount(book.readCount),
    wordCountText: book.wordCount > 0 ? `${formatCount(book.wordCount)}字` : "字数未知",
  };
}

async function fetchBoardBooks(input: Record<string, unknown>, board: MainBoard, category: SubCategory, range: RankRange | null) {
  const forceRefresh = input.forceRefresh === true;
  const request = {
    categoryId: category.id,
    forceRefresh,
    gender: board.gender,
    limit: range?.to,
    type: board.type,
  };
  if (typeof input.categoryName === "string" && input.categoryName.trim()) {
    ensureString(input.categoryName, "leaderboard.categoryName");
  }
  return category.id === OVERALL_CATEGORY_ID
    ? fetchOverallLeaderboard(request)
    : fetchLeaderboard({ ...request, limit: request.limit ?? DEFAULT_CATEGORY_LIMIT });
}

function buildBookData(board: MainBoard, category: SubCategory, books: LeaderboardBook[], range: RankRange | null) {
  return {
    action: "books",
    board: board.name,
    boardId: board.id,
    category: category.name,
    categoryId: category.id,
    includesAbstract: false,
    rankRange: range ? { from: range.from, to: range.to } : null,
    totalCount: books.length,
    books: books.map(withoutAbstract),
  };
}

function normalizeTextArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }
  const text = String(value ?? "").trim();
  return text ? [text] : [];
}

function normalizeNumberArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
      .map((item) => Math.max(1, Math.trunc(item)));
  }
  return typeof value === "number" && Number.isFinite(value) ? [Math.max(1, Math.trunc(value))] : [];
}

function normalizeDetailSelectors(input: Record<string, unknown>, range: RankRange | null) {
  const bookIds = new Set(normalizeTextArray(input.bookId).concat(normalizeTextArray(input.bookIds)));
  const bookNames = new Set(normalizeTextArray(input.bookName).concat(normalizeTextArray(input.bookNames)));
  const ranks = new Set(normalizeNumberArray(input.ranks));
  if (range) {
    for (let rank = range.from; rank <= range.to; rank += 1) ranks.add(rank);
  }
  return { bookIds, bookNames, ranks };
}

function matchesDetailSelector(book: LeaderboardBook, selectors: ReturnType<typeof normalizeDetailSelectors>) {
  if (book.bookId && selectors.bookIds.has(book.bookId)) return true;
  if (book.detailUrl && selectors.bookIds.has(book.detailUrl)) return true;
  if (selectors.bookNames.has(book.bookName)) return true;
  if (selectors.ranks.has(book.rank)) return true;
  return false;
}

function buildStatsCategory(stat: ReturnType<typeof buildLeaderboardStats>["categoryStats"][number]) {
  return {
    name: stat.name,
    bookCount: stat.bookCount,
    bookShare: stat.bookShare,
    bookShareText: formatPercent(stat.bookShare),
    readCount: stat.readCount,
    readCountText: formatCount(stat.readCount),
    readShare: stat.readShare,
    readShareText: formatPercent(stat.readShare),
    averageReadCount: stat.averageReadCount,
    averageReadCountText: formatCount(stat.averageReadCount),
    averageWordCount: stat.averageWordCount,
    demandMultiplierIndex: stat.demandMultiplierIndex,
    risingBookShare: stat.risingBookShare,
    risingBookShareText: formatPercent(stat.risingBookShare),
    waistReadShare: stat.waistReadShare,
    waistReadShareText: formatPercent(stat.waistReadShare),
    top3Concentration: stat.top3Concentration,
    top3ConcentrationText: formatPercent(stat.top3Concentration),
    topBookName: stat.topBookName,
    newWriterOpportunityIndex: stat.newWriterOpportunityIndex,
    hotTrendOpportunityIndex: stat.hotTrendOpportunityIndex,
    stableLongFormOpportunityIndex: stat.stableLongFormOpportunityIndex,
    overallOpportunityIndex: stat.overallOpportunityIndex,
    studySampleValueIndex: stat.studySampleValueIndex,
    riskScore: stat.riskScore,
  };
}

export function createFanqieLeaderboardTools(): Record<string, AgentTool> {
  return {
    leaderboard: {
      description: "读取番茄小说四个主榜之一的榜单、单独补作品简介，或读取榜单统计数据。书单默认不返回简介。",
      execute: async (input) => {
        const action = normalizeAction(input);
        const board = normalizeBoard(input);
        const category = normalizeCategory(input, board);
        const range = normalizeRankRange(input);
        const books = await fetchBoardBooks(input, board, category, range);
        const selectedBooks = filterBooksByRank(books, range);

        if (action === "stats") {
          const statsLimit = Math.min(asPositiveInt(input.statsLimit, DEFAULT_STATS_LIMIT), MAX_STATS_LIMIT);
          const stats = buildLeaderboardStats(selectedBooks);
          return ok(
            `已读取${board.name} · ${category.name}的统计数据，样本 ${selectedBooks.length} 本。`,
            {
              action,
              board: board.name,
              boardId: board.id,
              category: category.name,
              categoryId: category.id,
              sampleCount: selectedBooks.length,
              overview: {
                totalBooks: stats.totalBooks,
                totalReadCount: stats.totalReadCount,
                totalReadCountText: formatCount(stats.totalReadCount),
                totalWordCount: stats.totalWordCount,
                totalWordCountText: `${formatCount(stats.totalWordCount)}字`,
                averageReadCount: stats.averageReadCount,
                averageReadCountText: formatCount(stats.averageReadCount),
                serialBookShare: stats.serialBookShare,
                serialBookShareText: formatPercent(stats.serialBookShare),
                finishedBookShare: stats.finishedBookShare,
                finishedBookShareText: formatPercent(stats.finishedBookShare),
                topTenReadShare: stats.topTenReadShare,
                topTenReadShareText: formatPercent(stats.topTenReadShare),
                topCategoryName: stats.topCategoryName,
                topCategoryReadShare: stats.topCategoryReadShare,
                topCategoryReadShareText: formatPercent(stats.topCategoryReadShare),
              },
              categories: stats.categoryStats.slice(0, statsLimit).map(buildStatsCategory),
            },
          );
        }

        if (action === "details") {
          const selectors = normalizeDetailSelectors(input, range);
          if (selectors.bookIds.size === 0 && selectors.bookNames.size === 0 && selectors.ranks.size === 0) {
            throw new Error("leaderboard details 需要 bookId、bookIds、bookName、bookNames、rank 或排名范围。 ");
          }
          const detailedBooks = books
            .filter((book) => matchesDetailSelector(book, selectors))
            .map((book) => readCachedLeaderboardBookDetail(book) ?? book)
            .map(withDetail);
          return ok(
            `已读取${board.name} · ${category.name}的作品简介，共 ${detailedBooks.length} 本。`,
            {
              action,
              board: board.name,
              boardId: board.id,
              category: category.name,
              categoryId: category.id,
              includesAbstract: true,
              books: detailedBooks,
            },
          );
        }

        return ok(
          `已读取${board.name} · ${category.name}，${formatRankRange(range)}，共 ${selectedBooks.length} 本；列表不含简介。`,
          buildBookData(board, category, selectedBooks, range),
        );
      },
    },
  };
}
