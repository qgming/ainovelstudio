import { Save } from "lucide-react";

type BookEditorPanelProps = {
  activeFileName: string | null;
  busy?: boolean;
  content: string;
  isDirty: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
};
export function BookEditorPanel({
  activeFileName,
  busy = false,
  content,
  isDirty,
  onChange,
  onSave,
}: BookEditorPanelProps) {
  if (!activeFileName) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-[#f7f7f8] px-8 py-10 dark:bg-[#111214]">
        <div className="max-w-md text-center">
          <h2 className="text-3xl font-semibold tracking-[-0.05em] text-[#111827] dark:text-[#f3f4f6]">
            从左侧打开一个文件。
          </h2>
          <p className="mt-4 text-base leading-7 text-[#6b7280] dark:text-[#9aa4b2]">
            章节、大纲和设定文件会在这里直接编辑，并保存回原文件。
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f7f7f8] dark:bg-[#111214]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e2e8f0] px-3 py-1 dark:border-[#20242b]">
        <h2 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-[#f3f4f6]">
          {activeFileName}
        </h2>
        <div className="flex items-center gap-1.5">
          {isDirty ? (
            <span className="px-2 py-1 text-xs font-medium text-[#b45309] dark:text-[#f7c680]">
              未保存
            </span>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={onSave}
            className="flex h-8 items-center justify-center gap-1 rounded-[8px] bg-[#0b84e7] px-3 text-white transition-colors duration-200 hover:bg-[#0975cd] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-200"
          >
            <Save className="h-3.5 w-3.5" />
            <span className="text-[11px] font-medium leading-none tracking-[0.01em]">
              {busy ? "保存中..." : "保存"}
            </span>
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <textarea
          aria-label="文件编辑器"
          value={content}
          onChange={(event) => onChange(event.target.value)}
          className="h-full min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-1 text-[15px] leading-8 text-[#111827] outline-none dark:text-[#f3f4f6]"
          spellCheck={false}
        />
      </div>
    </section>
  );
}
