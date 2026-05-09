import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageShell } from "@shared/components/PageShell";
import {
  LeaderboardBoardSelector,
  LeaderboardBookCard,
  LeaderboardBookDialog,
  LeaderboardCategorySelector,
  RankSkeletonGrid,
} from "./LeaderboardComponents";
import { fetchFanqieOverallLeaderboard, fetchLeaderboard, fetchOverallLeaderboard } from "./leaderboardApi";
import { FANQIE_OVERALL_BOARD_ID, MAIN_BOARDS, OVERALL_CATEGORY_ID } from "./leaderboardCatalog";
import type { LeaderboardBook } from "./types";

type LoadStatus = "loading" | "ready";

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : "排行榜加载失败，请稍后重试。";
}

function formatUpdatedAt(date: Date | null) {
  if (!date) return "尚未刷新";
  return `更新于 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
}

export function LeaderboardPage() {
  const [boardId, setBoardId] = useState(FANQIE_OVERALL_BOARD_ID);
  const [categoryId, setCategoryId] = useState(String(OVERALL_CATEGORY_ID));
  const [books, setBooks] = useState<LeaderboardBook[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedBook, setSelectedBook] = useState<LeaderboardBook | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const requestSeq = useRef(0);
  const selectedBoard = useMemo(
    () => MAIN_BOARDS.find((board) => board.id === boardId) ?? MAIN_BOARDS[0],
    [boardId],
  );
  const isFanqieOverall = boardId === FANQIE_OVERALL_BOARD_ID;
  const selectedCategory = useMemo(
    () => selectedBoard.subCategories.find((category) => String(category.id) === categoryId),
    [categoryId, selectedBoard.subCategories],
  );
  const selectedCategoryId = Number(categoryId);

  const refresh = useCallback(async (forceRefresh = false) => {
    const currentSeq = requestSeq.current + 1;
    requestSeq.current = currentSeq;
    setStatus("loading");
    setErrorMessage(null);

    try {
      const request = {
        categoryId: selectedCategoryId,
        forceRefresh: forceRefresh || undefined,
        gender: selectedBoard.gender,
        type: selectedBoard.type,
      };
      const nextBooks = isFanqieOverall
        ? await fetchFanqieOverallLeaderboard(undefined, { forceRefresh })
        : selectedCategoryId === OVERALL_CATEGORY_ID
        ? await fetchOverallLeaderboard(request)
        : await fetchLeaderboard(request);
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
  }, [isFanqieOverall, selectedBoard.gender, selectedBoard.type, selectedCategoryId]);

  const handleBoardChange = useCallback((nextBoardId: string) => {
    setBoardId(nextBoardId);
    setCategoryId(String(OVERALL_CATEGORY_ID));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PageShell
      title={<div className="truncate text-[15px] font-semibold text-foreground">排行榜</div>}
      headerRight={
        <div className="hidden text-xs text-muted-foreground sm:block">
          番茄小说 · {formatUpdatedAt(updatedAt)}
        </div>
      }
      actions={[{ icon: RefreshCw, label: status === "loading" ? "刷新中..." : "刷新榜单", onClick: () => void refresh(true) }]}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
        <div className="shrink-0 border-b border-border bg-panel-subtle px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3">
            <LeaderboardBoardSelector boardId={boardId} onChange={handleBoardChange} />
            {isFanqieOverall ? null : (
              <LeaderboardCategorySelector
                categoryId={categoryId}
                selectedBoard={selectedBoard}
                onChange={setCategoryId}
              />
            )}
          </div>
        </div>

        {errorMessage ? (
          <div className="editor-callout" data-tone="error">
            <pre className="whitespace-pre-wrap break-words text-sm leading-6">{errorMessage}</pre>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {status === "loading" ? (
            <RankSkeletonGrid />
          ) : books.length > 0 ? (
            <div className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
              {books.map((book) => (
                <LeaderboardBookCard
                  key={book.bookId ?? `${book.bookName}-${book.rank}`}
                  book={book}
                  onSelect={setSelectedBook}
                />
              ))}
            </div>
          ) : (
            <div className="editor-empty-state border-t-0">
              <div>
                <h2 className="editor-empty-state-title text-xl">暂无榜单数据</h2>
                <p className="editor-empty-state-copy">当前分类没有解析到作品，请刷新后再试。</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <LeaderboardBookDialog
        boardName={isFanqieOverall ? "今日番茄总榜" : selectedBoard.name}
        book={selectedBook}
        categoryName={isFanqieOverall ? "综合" : selectedCategory?.name ?? "总榜"}
        onOpenChange={(open) => {
          if (!open) setSelectedBook(null);
        }}
      />
    </PageShell>
  );
}
