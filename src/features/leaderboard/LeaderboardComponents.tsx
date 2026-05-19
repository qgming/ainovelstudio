import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowDown, ArrowUp, ExternalLink, Minus, Trophy } from "lucide-react";
import { Badge } from "@shared/ui/badge";
import { getSurfaceActionClassName } from "@shared/ui/action-button";
import { Button } from "@shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/ui/dialog";
import { SegmentedControl } from "@shared/ui/segmented-control";
import { Skeleton } from "@shared/ui/skeleton";
import { cn } from "@shared/utils";
import { formatCount } from "./leaderboardApi";
import { LEADERBOARD_BOARD_OPTIONS } from "./leaderboardCatalog";
import type { LeaderboardBook, MainBoard } from "./types";

export function formatWordCount(wordCount: number) {
  if (wordCount <= 0) return "字数未知";
  return `${formatCount(wordCount)}字`;
}

export function RankSkeletonGrid() {
  return (
    <div className="editor-block-grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
      {Array.from({ length: 10 }, (_, index) => (
        <article key={index} className="editor-block-tile">
          <Skeleton className="absolute left-0 top-0 z-10 h-5 w-6 rounded-none rounded-br-md" />
          <div className="flex h-full flex-col gap-2.5 p-3 sm:gap-3 sm:p-4">
            <div className="flex min-h-0 flex-1 gap-2 sm:gap-3">
              <Skeleton className="h-24 w-[64px] shrink-0 rounded-md sm:h-28 sm:w-[76px]" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-full sm:h-5" />
                <Skeleton className="h-4 w-4/5 sm:h-5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Skeleton className="h-5 rounded-md" />
              <Skeleton className="h-5 rounded-md" />
              <Skeleton className="h-5 rounded-md" />
              <Skeleton className="h-5 rounded-md" />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-medium text-foreground">{value}</span>
    </div>
  );
}

function RankNumber({ className, value }: { className?: string; value: number }) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-xs font-semibold tabular-nums",
        value <= 3
          ? "border-primary/20 bg-primary/10 text-primary"
          : "border-border bg-panel-subtle text-muted-foreground",
        className,
      )}
    >
      {String(value).padStart(2, "0")}
    </div>
  );
}

function getRankDiffLabel(diff: number) {
  if (diff > 0) return `上升 ${diff} 名`;
  if (diff < 0) return `下降 ${Math.abs(diff)} 名`;
  return "排名无变化";
}

function RankDiff({ value }: { value?: number }) {
  const diff = value ?? 0;
  const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : Minus;
  return (
    <div
      aria-label={getRankDiffLabel(diff)}
      title={getRankDiffLabel(diff)}
      className={cn(
        "absolute left-0 top-5 z-10 flex h-5 w-6 items-center justify-center gap-0.5 rounded-none rounded-br-md border border-l-0 border-t-0 bg-panel/95 text-[10px] font-medium tabular-nums shadow-sm",
        diff > 0 ? "border-emerald-500/20 text-emerald-600" : diff < 0 ? "border-red-500/20 text-red-600" : "border-border text-muted-foreground",
      )}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      {diff === 0 ? null : <span>{Math.abs(diff)}</span>}
    </div>
  );
}

function BookCover({ book, className }: { book: LeaderboardBook; className?: string }) {
  if (!book.thumbUri) {
    return (
      <div className={cn("flex shrink-0 items-center justify-center rounded-md border border-border bg-panel-subtle text-muted-foreground", className)}>
        <Trophy className="h-5 w-5" />
      </div>
    );
  }
  return (
    <img
      alt={`${book.bookName} 封面`}
      className={cn("shrink-0 rounded-md border border-border bg-panel object-cover", className)}
      loading="lazy"
      src={book.thumbUri}
    />
  );
}

export function LeaderboardBoardSelector({
  boardId,
  onChange,
}: {
  boardId: string;
  onChange: (nextBoardId: string) => void;
}) {
  return (
    <SegmentedControl
      ariaLabel="排行榜榜单"
      buttonClassName="px-2.5 text-xs sm:text-[0.8rem]"
      className="md:flex-nowrap"
      onValueChange={onChange}
      options={LEADERBOARD_BOARD_OPTIONS.map((board) => ({
        label: board.name,
        value: board.id,
      }))}
      value={boardId}
    />
  );
}

export function LeaderboardCategorySelector({
  categoryId,
  selectedBoard,
  onChange,
}: {
  categoryId: string;
  selectedBoard: MainBoard;
  onChange: (value: string) => void;
}) {
  return (
    <div className="border-t border-border/45 pt-2">
      <SegmentedControl
        ariaLabel="排行榜分类"
        buttonClassName="h-7 px-2.5"
        onValueChange={onChange}
        options={selectedBoard.subCategories.map((category) => ({
          label: category.name,
          value: String(category.id),
        }))}
        value={categoryId}
      />
    </div>
  );
}

export function LeaderboardBookCard({
  book,
  onSelect,
}: {
  book: LeaderboardBook;
  onSelect: (book: LeaderboardBook) => void;
}) {
  return (
    <article className="editor-block-tile">
      <RankNumber
        value={book.rank}
        className="absolute left-0 top-0 z-10 h-5 w-6 rounded-none rounded-br-md border-l-0 border-t-0 bg-panel/95 text-[10px] shadow-sm"
      />
      <RankDiff value={book.rankPosDiff} />
      <button
        type="button"
        aria-label={`查看 ${book.bookName} 详情`}
        onClick={() => onSelect(book)}
        className="flex h-full w-full cursor-pointer flex-col gap-2.5 overflow-hidden rounded-none p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset sm:gap-3 sm:p-4"
      >
        <div className="flex min-h-0 flex-1 gap-2 sm:gap-3">
          <BookCover book={book} className="h-24 w-[64px] sm:h-28 sm:w-[76px]" />
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-3 break-words text-[14px] font-semibold leading-[1.2] tracking-[-0.03em] text-foreground sm:text-[16px]">
              {book.bookName}
            </h2>
            <p className="mt-1 break-words text-[11px] leading-[18px] text-muted-foreground sm:mt-1.5 sm:text-xs sm:leading-5">{book.author || "作者未知"}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Badge variant="outline" className="min-w-0 justify-center truncate rounded-md px-1 text-[10px] sm:px-1.5 sm:text-xs">{formatCount(book.readCount)}在读</Badge>
          <Badge variant="outline" className="min-w-0 justify-center truncate rounded-md px-1 text-[10px] sm:px-1.5 sm:text-xs">{book.status}</Badge>
          <Badge variant="outline" className="min-w-0 justify-center truncate rounded-md px-1 text-[10px] sm:px-1.5 sm:text-xs">{formatWordCount(book.wordCount)}</Badge>
          {book.category ? (
            <Badge variant="outline" className="min-w-0 justify-center truncate rounded-md px-1 text-[10px] sm:px-1.5 sm:text-xs">{book.category}</Badge>
          ) : null}
        </div>
      </button>
    </article>
  );
}

export function LeaderboardBookDialog({
  boardName,
  book,
  categoryName,
  onOpenChange,
}: {
  boardName: string;
  book: LeaderboardBook | null;
  categoryName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const canOpen = Boolean(book?.detailUrl);
  const displayCategory = book?.category || categoryName;
  const rankLabel = book ? `${boardName} · ${displayCategory} · 第 ${book.rank} 名` : "";
  return (
    <Dialog open={book !== null} onOpenChange={onOpenChange}>
      <DialogContent className="min-h-[min(560px,calc(100vh-2rem))] max-h-[min(760px,calc(100vh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:w-[860px] sm:max-w-[860px]">
        {book ? (
          <>
            <DialogHeader className="pr-8">
              <div className="w-fit rounded-md border border-border bg-panel-subtle px-2 py-1 text-xs font-medium text-muted-foreground">
                {rankLabel}
              </div>
              <DialogTitle className="sr-only">{book.bookName}</DialogTitle>
              <DialogDescription className="sr-only">{book.author || "作者未知"}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-hidden">
              <div className="grid h-full min-h-0 gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
                <BookCover book={book} className="mx-auto h-44 w-28 sm:mx-0 sm:h-64 sm:w-40" />
                <div className="flex min-h-0 min-w-0 flex-col">
                  <h2 className="break-words text-xl font-semibold leading-[1.15] tracking-[-0.04em] text-foreground sm:text-2xl">
                    {book.bookName}
                  </h2>
                  <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
                    {book.author || "作者未知"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    <DetailStat label="在读数" value={`${formatCount(book.readCount)}在读`} />
                    <DetailStat label="排行变化" value={getRankDiffLabel(book.rankPosDiff ?? 0)} />
                    <DetailStat label="状态" value={book.status} />
                    <DetailStat label="字数" value={formatWordCount(book.wordCount)} />
                    <DetailStat label="分类" value={displayCategory || "分类未知"} />
                  </div>
                  <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                    <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">
                      {book.abstract || "暂无简介。"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                disabled={!canOpen}
                className={getSurfaceActionClassName({ tone: "primary" })}
                onClick={() => {
                  if (book.detailUrl) void openUrl(book.detailUrl);
                }}
              >
                <ExternalLink className="h-4 w-4" />
                打开番茄详情页
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
