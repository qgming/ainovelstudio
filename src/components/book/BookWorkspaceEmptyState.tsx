import { BookOpenText, FolderOpen, Plus } from "lucide-react";

type BookWorkspaceEmptyStateProps = {
  busy?: boolean;
  onCreate: () => void;
  onOpen: () => void;
};

export function BookWorkspaceEmptyState({
  busy = false,
  onCreate,
  onOpen,
}: BookWorkspaceEmptyStateProps) {
  return (
    <section className="flex h-full min-h-0 items-center justify-center overflow-auto px-10 py-12">
      <div className="w-full max-w-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center text-[#0b84e7] dark:text-[#7cc4ff]">
          <BookOpenText className="h-7 w-7" />
        </div>
        <h1 className="mt-5 text-center text-[clamp(2rem,4vw,3rem)] font-semibold tracking-[-0.05em] text-[#111827] dark:text-[#f3f4f6]">
          选择一本书，或新建一本书。
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-center text-base leading-7 text-[#6b7280] dark:text-[#9aa4b2]">
          打开已有目录，或者生成一套适合 AI 小说创作的中文模板结构。
        </p>
        <div className="mt-10 grid gap-px overflow-hidden border border-[#e2e8f0] bg-[#e2e8f0] md:grid-cols-2 dark:border-[#262a31] dark:bg-[#262a31]">
          <button
            type="button"
            aria-label="选择书籍"
            disabled={busy}
            onClick={onOpen}
            className="flex min-h-[92px] items-center justify-center gap-3 bg-[#f7f7f8] px-5 text-[#111827] transition hover:bg-[#eff6ff] disabled:opacity-60 dark:bg-[#111214] dark:text-[#f3f4f6] dark:hover:bg-[#162131]"
          >
            <FolderOpen className="h-5 w-5 text-[#0b84e7] dark:text-[#7cc4ff]" />
            <span className="text-lg font-semibold tracking-[-0.03em]">选择书籍</span>
          </button>
          <button
            type="button"
            aria-label="新建书籍"
            disabled={busy}
            onClick={onCreate}
            className="flex min-h-[92px] items-center justify-center gap-3 bg-[#f7f7f8] px-5 text-[#111827] transition hover:bg-[#eff6ff] disabled:opacity-60 dark:bg-[#111214] dark:text-[#f3f4f6] dark:hover:bg-[#162131]"
          >
            <Plus className="h-5 w-5 text-[#0b84e7] dark:text-[#7cc4ff]" />
            <span className="text-lg font-semibold tracking-[-0.03em]">新建书籍</span>
          </button>
        </div>
      </div>
    </section>
  );
}
