import { BookOpenText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BookWorkspaceSummary } from "../../lib/bookWorkspace/types";
import { DialogShell } from "./DialogShell";

type BookshelfDialogProps = {
  books: BookWorkspaceSummary[];
  busy?: boolean;
  errorMessage?: string | null;
  onClose: () => void;
  onCreate: () => void;
  onOpen: (bookId: string) => void;
  onRefresh: () => void;
};

// 选择书籍对话框：使用 shadcn Button + 主题 token；列表项支持触屏目标尺寸。
export function BookshelfDialog({
  books,
  busy = false,
  errorMessage = null,
  onClose,
  onCreate,
  onOpen,
  onRefresh,
}: BookshelfDialogProps) {
  return (
    <DialogShell title="选择书籍" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm leading-6 text-muted-foreground">
            从 SQLite 书库中切换当前书籍，Windows 和 Android 共用同一套书架。
          </p>
          <Button
            type="button"
            aria-label="刷新书库列表"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            onClick={onRefresh}
            className="text-muted-foreground"
          >
            <RefreshCw className={cn("h-4 w-4", busy && "animate-spin")} />
          </Button>
        </div>

        {errorMessage ? (
          <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-panel">
          {books.length > 0 ? (
            <ul className="divide-y divide-border">
              {books.map((book) => (
                <li key={book.id}>
                  <button
                    type="button"
                    aria-label={book.name}
                    disabled={busy}
                    onClick={() => onOpen(book.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <BookOpenText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {book.name}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        书库标识：{book.path}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center">
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  书库里还没有书籍，先创建一本新的书。
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={onCreate}
                >
                  新建书籍
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
