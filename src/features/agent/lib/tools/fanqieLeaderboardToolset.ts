import {
  fetchFanqieOverallLeaderboard,
  fetchLeaderboard,
  fetchOverallLeaderboard,
  formatCount,
} from "@features/leaderboard/leaderboardApi";
import { FANQIE_OVERALL_BOARD_ID, MAIN_BOARDS, OVERALL_CATEGORY_ID } from "@features/leaderboard/leaderboardCatalog";
import type { LeaderboardBook, MainBoard, SubCategory } from "@features/leaderboard/types";
import type { AgentTool } from "../runtime";
import { asPositiveInt, ensureString, ok } from "./shared";

const BOARD_IDS = new Set(MAIN_BOARDS.map((board) => board.id));
const FANQIE_OVERALL_BOARD_NAME = "今日番茄总榜";
const DEFAULT_LIMIT = 30;
const FANQIE_OVERALL_LIMIT = 180;
const MAX_LIMIT = 180;

function normalizeBoard(input: Record<string, unknown>): MainBoard {
  const boardId = typeof input.board === "string" ? input.board.trim() : "";
  if (BOARD_IDS.has(boardId)) {
    return MAIN_BOARDS.find((board) => board.id === boardId) ?? MAIN_BOARDS[0];
  }

  const gender = input.gender === 0 || input.gender === 1 ? input.gender : undefined;
  const type = input.type === 1 || input.type === 2 ? input.type : undefined;
  return MAIN_BOARDS.find((board) => board.gender === gender && board.type === type) ?? MAIN_BOARDS[0];
}

function shouldUseFanqieOverall(input: Record<string, unknown>) {
  const boardId = typeof input.board === "string" ? input.board.trim() : "";
  const categoryName = typeof input.categoryName === "string" ? input.categoryName.trim() : "";
  return boardId === FANQIE_OVERALL_BOARD_ID
    || categoryName === "番茄总榜"
    || categoryName === "今日番茄总榜"
    || (!boardId && !categoryName && input.gender == null && input.type == null && input.categoryId == null);
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

function normalizeRankRange(input: Record<string, unknown>, defaultLimit: number = DEFAULT_LIMIT) {
  if (typeof input.rank === "number" && Number.isFinite(input.rank)) {
    const rank = Math.max(1, Math.trunc(input.rank));
    return { from: rank, to: rank };
  }
  const from = asPositiveInt(input.rankFrom, 1);
  const limit = Math.min(asPositiveInt(input.limit, defaultLimit), MAX_LIMIT);
  const to = typeof input.rankTo === "number" && Number.isFinite(input.rankTo)
    ? Math.max(from, Math.trunc(input.rankTo))
    : from + limit - 1;
  return { from, to: Math.min(to, MAX_LIMIT) };
}

function filterBooksByRank(books: LeaderboardBook[], from: number, to: number) {
  return books.filter((book) => book.rank >= from && book.rank <= to);
}

function formatRankRange(from: number, to: number) {
  return from === to ? `第 ${from} 名` : `第 ${from}-${to} 名`;
}

function buildSummary(board: MainBoard, category: SubCategory, from: number, to: number, count: number) {
  return `已读取${board.name} · ${category.name}，${formatRankRange(from, to)}，共 ${count} 本。`;
}

function buildToolData(
  board: { id: string; name: string },
  category: SubCategory,
  books: LeaderboardBook[],
) {
  return {
    board: board.name,
    boardId: board.id,
    category: category.name,
    categoryId: category.id,
    books: books.map((book) => ({
      ...book,
      readCountText: formatCount(book.readCount),
      wordCountText: book.wordCount > 0 ? `${formatCount(book.wordCount)}字` : "字数未知",
    })),
  };
}

export function createFanqieLeaderboardTools(): Record<string, AgentTool> {
  return {
    fanqie_leaderboard: {
      description: "读取番茄小说排行榜，可按主榜、分类和排名范围返回作品信息。",
      execute: async (input) => {
        const forceRefresh = input.forceRefresh === true;
        if (shouldUseFanqieOverall(input)) {
          const range = normalizeRankRange(input, FANQIE_OVERALL_LIMIT);
          const books = await fetchFanqieOverallLeaderboard(range.to, { forceRefresh });
          const selectedBooks = filterBooksByRank(books, range.from, range.to);
          const category = { id: OVERALL_CATEGORY_ID, name: "综合" };
          return ok(
            `已读取${FANQIE_OVERALL_BOARD_NAME}，${formatRankRange(range.from, range.to)}，共 ${selectedBooks.length} 本。`,
            buildToolData({ id: FANQIE_OVERALL_BOARD_ID, name: FANQIE_OVERALL_BOARD_NAME }, category, selectedBooks),
          );
        }

        const range = normalizeRankRange(input);
        const board = normalizeBoard(input);
        const category = normalizeCategory(input, board);
        const request = {
          categoryId: category.id,
          forceRefresh,
          gender: board.gender,
          limit: range.to,
          type: board.type,
        };
        if (typeof input.categoryName === "string" && input.categoryName.trim()) {
          ensureString(input.categoryName, "fanqie_leaderboard.categoryName");
        }
        const books = category.id === OVERALL_CATEGORY_ID
          ? await fetchOverallLeaderboard(request)
          : await fetchLeaderboard(request);
        const selectedBooks = filterBooksByRank(books, range.from, range.to);
        return ok(
          buildSummary(board, category, range.from, range.to, selectedBooks.length),
          buildToolData(board, category, selectedBooks),
        );
      },
    },
  };
}
