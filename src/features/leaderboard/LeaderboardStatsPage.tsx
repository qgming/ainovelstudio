import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageShell } from "@shared/components/PageShell";
import { Skeleton } from "@shared/ui/skeleton";
import { cn } from "@shared/utils";
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

function formatUpdatedAt(date: Date | null) {
  if (!date) return "尚未刷新";
  return `更新于 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
}

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
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const refresh = useCallback(async (forceRefresh = false) => {
    const cachedBooks = forceRefresh ? null : readCachedStatsBooks(selection);
    if (cachedBooks) {
      setBooks(cachedBooks);
      setErrorMessage(null);
      setStatus("ready");
      setUpdatedAt(new Date());
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
      setUpdatedAt(new Date());
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

  return { books, errorMessage, refresh, status, updatedAt };
}

function StatsSkeleton() {
  return (
    <div className="space-y-3 p-4 sm:p-5">
      <Skeleton className="h-20 rounded-md" />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Skeleton className="h-72 rounded-md" />
        <Skeleton className="h-72 rounded-md" />
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
    <section className="border-b border-border">
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">统计口径</p>
          <p className="mt-0.5 text-xs text-muted-foreground">当前统计 {filteredCount} / {totalCount} 本</p>
        </div>
        <div className="grid w-full grid-cols-2 overflow-hidden rounded-md border border-border sm:w-auto sm:grid-cols-5" role="group" aria-label="统计口径筛选">
          {STATS_FILTER_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => onChange(option.id)}
              className={cn(
                "min-h-9 border-r border-b border-border px-3 text-xs font-medium text-muted-foreground transition-colors even:border-r-0 last:border-b-0 sm:border-b-0 sm:even:border-r sm:last:border-r-0",
                filter === option.id && "bg-primary text-primary-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
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
    <div className="min-h-0 overflow-y-auto">
      <StatsFilterBar filter={filter} filteredCount={filteredBooks.length} onChange={onFilterChange} totalCount={books.length} />
      {stats.totalBooks > 0 ? <LeaderboardStatsOverview stats={stats} /> : <EmptyStats />}
    </div>
  );
}

function EmptyStats() {
  return (
    <div className="editor-empty-state border-t-0">
      <div>
        <h2 className="editor-empty-state-title text-xl">暂无统计数据</h2>
        <p className="editor-empty-state-copy">当前总榜没有可统计作品，请刷新后再试。</p>
      </div>
    </div>
  );
}

function StatsTitle() {
  return (
    <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
      <Link to="/leaderboard" className="text-muted-foreground transition-colors hover:text-foreground">
        排行榜
      </Link>
      <span className="px-1.5 text-muted-foreground">/</span>
      <span>数据统计</span>
    </div>
  );
}

export function LeaderboardStatsPage() {
  const [searchParams] = useSearchParams();
  const boardId = searchParams.get("board") ?? FANQIE_OVERALL_BOARD_ID;
  const [bookFilter, setBookFilter] = useState<StatsBookFilter>("all");
  const selection = useMemo(() => getStatsBoardSelection(boardId), [boardId]);
  const { books, errorMessage, refresh, status, updatedAt } = useLeaderboardStatsData(selection);

  return (
    <PageShell
      title={<StatsTitle />}
      headerRight={
        <div className="hidden text-xs text-muted-foreground sm:block">
          {selection.boardName} · {formatUpdatedAt(updatedAt)}
        </div>
      }
      actions={[
        { icon: RefreshCw, label: status === "loading" ? "刷新中..." : "刷新统计", onClick: () => void refresh(true) },
      ]}
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
