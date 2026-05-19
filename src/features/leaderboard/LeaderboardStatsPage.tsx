import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageBackTitle } from "@shared/components/PageBackTitle";
import { PageShell } from "@shared/components/PageShell";
import { Skeleton } from "@shared/ui/skeleton";
import { SegmentedControl } from "@shared/ui/segmented-control";
import {
  fetchFanqieOverallLeaderboard,
  fetchOverallLeaderboard,
  readCachedFanqieOverallLeaderboard,
  readCachedOverallLeaderboard,
} from "./leaderboardApi";
import { FANQIE_OVERALL_BOARD_ID, MAIN_BOARDS, OVERALL_CATEGORY_ID } from "./leaderboardCatalog";
import { LeaderboardStatsOverview } from "./LeaderboardStatsCharts";
import { buildLeaderboardStats } from "./leaderboardStats";
import type { LeaderboardBook, MainBoard } from "./types";

type LoadStatus = "loading" | "ready";
type StatsBookFilter = "all" | "dropBottom90" | "dropBottomHalf" | "dropTop90" | "dropTopHalf";
type StatsBoardSelection = {
  boardName: string;
  isFanqieOverall: boolean;
  selectedBoard: MainBoard | null;
};

const FILTER_BOOK_COUNT = 90;
const STATS_FILTER_OPTIONS: { id: StatsBookFilter; label: string }[] = [
  { id: "all", label: "全部图书" },
  { id: "dropTop90", label: "移除前90部" },
  { id: "dropBottom90", label: "移除后90部" },
  { id: "dropTopHalf", label: "移除前一半" },
  { id: "dropBottomHalf", label: "移除后一半" },
];


function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : "数据统计加载失败，请稍后重试。";
}

function getStatsBoard(boardId: string | null): MainBoard | null {
  return MAIN_BOARDS.find((board) => board.id === boardId) ?? null;
}

function getStatsBoardSelection(boardId: string): StatsBoardSelection {
  const selectedBoard = getStatsBoard(boardId);
  const isFanqieOverall = boardId === FANQIE_OVERALL_BOARD_ID || !selectedBoard;
  return {
    boardName: isFanqieOverall ? "今日番茄总榜" : selectedBoard.name,
    isFanqieOverall,
    selectedBoard,
  };
}

async function fetchStatsBooks(selection: StatsBoardSelection, forceRefresh: boolean) {
  if (selection.isFanqieOverall || !selection.selectedBoard) {
    return fetchFanqieOverallLeaderboard(undefined, { forceRefresh });
  }
  return fetchOverallLeaderboard({
    categoryId: OVERALL_CATEGORY_ID,
    forceRefresh: forceRefresh || undefined,
    gender: selection.selectedBoard.gender,
    type: selection.selectedBoard.type,
  });
}

function readCachedStatsBooks(selection: StatsBoardSelection) {
  if (selection.isFanqieOverall || !selection.selectedBoard) {
    return readCachedFanqieOverallLeaderboard();
  }
  return readCachedOverallLeaderboard({
    categoryId: OVERALL_CATEGORY_ID,
    gender: selection.selectedBoard.gender,
    type: selection.selectedBoard.type,
  });
}

function useLeaderboardStatsData(selection: StatsBoardSelection) {
  const requestSeq = useRef(0);
  const [books, setBooks] = useState<LeaderboardBook[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");

  const refresh = useCallback(async (forceRefresh = false) => {
    const cachedBooks = forceRefresh ? null : readCachedStatsBooks(selection);
    if (cachedBooks) {
      setBooks(cachedBooks);
      setErrorMessage(null);
      setStatus("ready");
      return;
    }
    const currentSeq = requestSeq.current + 1;
    requestSeq.current = currentSeq;
    setStatus("loading");
    setErrorMessage(null);
    try {
      const nextBooks = await fetchStatsBooks(selection, forceRefresh);
      if (requestSeq.current !== currentSeq) return;
      setBooks(nextBooks);
    } catch (error) {
      if (requestSeq.current !== currentSeq) return;
      setBooks([]);
      setErrorMessage(getReadableError(error));
    } finally {
      if (requestSeq.current === currentSeq) setStatus("ready");
    }
  }, [selection]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { books, errorMessage, status };
}

function StatsSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
      <div className="space-y-3">
        <section className="overflow-hidden rounded-xl border border-border/45 bg-card p-3 shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
          <Skeleton className="h-16 rounded-lg" />
        </section>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-xl" />
        <div className="grid gap-3 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function sortBooksByRank(books: LeaderboardBook[]) {
  return [...books].sort((left, right) => left.rank - right.rank || right.readCount - left.readCount);
}

function filterStatsBooks(books: LeaderboardBook[], filter: StatsBookFilter) {
  if (filter === "all") return books;
  const rankedBooks = sortBooksByRank(books);
  if (filter === "dropTop90") return rankedBooks.slice(FILTER_BOOK_COUNT);
  if (filter === "dropTopHalf") return rankedBooks.slice(Math.ceil(rankedBooks.length / 2));
  if (filter === "dropBottomHalf") return rankedBooks.slice(0, Math.floor(rankedBooks.length / 2));
  return rankedBooks.slice(0, Math.max(0, rankedBooks.length - FILTER_BOOK_COUNT));
}

function StatsFilterBar({ filter, filteredCount, onChange, totalCount }: {
  filter: StatsBookFilter;
  filteredCount: number;
  onChange: (filter: StatsBookFilter) => void;
  totalCount: number;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/45 bg-card text-card-foreground shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:bg-panel dark:shadow-none">
      <div className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <div className="min-w-0">
          <p className="text-[15px] font-medium tracking-[-0.02em] text-foreground">统计口径</p>
          <p className="mt-0.5 text-xs text-muted-foreground">当前统计 {filteredCount} / {totalCount} 本</p>
        </div>
        <SegmentedControl
          ariaLabel="统计口径筛选"
          buttonClassName="h-8 px-2.5 text-xs"
          className="w-full bg-panel-subtle shadow-none sm:w-auto"
          onValueChange={onChange}
          options={STATS_FILTER_OPTIONS.map((option) => ({
            label: option.label,
            value: option.id,
          }))}
          value={filter}
        />
      </div>
    </section>
  );
}

function StatsContent({ books, filter, onFilterChange }: {
  books: LeaderboardBook[];
  filter: StatsBookFilter;
  onFilterChange: (filter: StatsBookFilter) => void;
}) {
  const filteredBooks = useMemo(() => filterStatsBooks(books, filter), [books, filter]);
  const stats = useMemo(() => buildLeaderboardStats(filteredBooks), [filteredBooks]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4">
      <div className="space-y-3">
        <StatsFilterBar filter={filter} filteredCount={filteredBooks.length} onChange={onFilterChange} totalCount={books.length} />
        {stats.totalBooks > 0 ? <LeaderboardStatsOverview stats={stats} /> : <EmptyStats />}
      </div>
    </div>
  );
}

function EmptyStats() {
  return (
    <div className="editor-empty-state rounded-xl">
      <div>
        <h2 className="editor-empty-state-title text-xl">暂无统计数据</h2>
        <p className="editor-empty-state-copy">当前总榜没有可统计作品，请刷新后再试。</p>
      </div>
    </div>
  );
}

export function LeaderboardStatsPage() {
  const [searchParams] = useSearchParams();
  const boardId = searchParams.get("board") ?? FANQIE_OVERALL_BOARD_ID;
  const [bookFilter, setBookFilter] = useState<StatsBookFilter>("all");
  const selection = useMemo(() => getStatsBoardSelection(boardId), [boardId]);
  const { books, errorMessage, status } = useLeaderboardStatsData(selection);

  return (
    <PageShell
      title={<PageBackTitle backLabel="返回排行榜" title="数据统计" to="/leaderboard" />}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
        {errorMessage ? (
          <div className="editor-callout" data-tone="error">
            <pre className="whitespace-pre-wrap break-words text-sm leading-6">{errorMessage}</pre>
          </div>
        ) : null}
        {status === "loading" ? <StatsSkeleton /> : <StatsContent books={books} filter={bookFilter} onFilterChange={setBookFilter} />}
      </div>
    </PageShell>
  );
}

