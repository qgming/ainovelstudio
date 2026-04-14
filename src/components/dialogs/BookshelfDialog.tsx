import { BookOpenText, RefreshCw } from "lucide-react";
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
          <p className="text-sm leading-6 text-[#64748b] dark:text-[#94a3b8]">
            从应用内置书库中切换当前书籍，Windows 和 Android 共用同一套书架。
          </p>
          <button
            type="button"
            aria-label="刷新书库列表"
            disabled={busy}
            onClick={onRefresh}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[#111827] transition-colors duration-200 hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-[#1a1c21]"
          >
            <RefreshCw className={["h-4 w-4", busy ? "animate-spin" : ""].join(" ")} />
          </button>
        </div>

        {errorMessage ? (
          <div className="rounded-[10px] border border-[#f0d7d2] bg-[#fff7f5] px-3 py-2 text-sm text-[#8a4b42] dark:border-[#4b2b2d] dark:bg-[#241617] dark:text-[#efb5af]">
            {errorMessage}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto rounded-[12px] border border-[#e2e8f0] bg-white dark:border-[#20242b] dark:bg-[#0f1115]">
          {books.length > 0 ? (
            <div className="divide-y divide-[#e2e8f0] dark:divide-[#20242b]">
              {books.map((book) => (
                <button
                  key={book.id}
                  type="button"
                  aria-label={book.name}
                  disabled={busy}
                  onClick={() => onOpen(book.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-[#eef6ff] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#141c26]"
                >
                  <BookOpenText className="mt-0.5 h-4 w-4 shrink-0 text-[#0b84e7] dark:text-[#7cc4ff]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[#111827] dark:text-[#f3f4f6]">
                      {book.name}
                    </span>
                    <span className="mt-1 block truncate text-xs text-[#64748b] dark:text-[#94a3b8]">
                      {book.path}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center">
              <div className="space-y-3">
                <p className="text-sm text-[#64748b] dark:text-[#94a3b8]">
                  书库里还没有书籍，先创建一本新的书。
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onCreate}
                  className="inline-flex h-8 items-center rounded-[8px] bg-[#0b84e7] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#0975cd] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-200"
                >
                  新建书籍
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
