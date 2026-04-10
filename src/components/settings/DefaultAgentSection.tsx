import { RotateCcw, Save } from "lucide-react";

type DefaultAgentSectionProps = {
  draftContent: string;
  isDirty: boolean;
  onChange: (value: string) => void;
  onReset: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
};

export function DefaultAgentSection({
  draftContent,
  isDirty,
  onChange,
  onReset,
  onSave,
}: DefaultAgentSectionProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f7f7f8] dark:bg-[#111214]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#e2e8f0] px-3 py-2 dark:border-[#20242b]">
        <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-[#f3f4f6]">
          AGENTS.md
        </h2>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="恢复默认 AGENTS"
            onClick={onReset}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] p-0 text-[#0f172a] transition-colors duration-200 hover:bg-[#edf1f6] dark:text-[#f3f4f6] dark:hover:bg-[#1a1c21]"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="保存 AGENTS"
            onClick={onSave}
            disabled={!isDirty}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] p-0 text-[#0f172a] transition-colors duration-200 hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#f3f4f6] dark:hover:bg-[#1a1c21]"
          >
            <Save className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        <textarea
          aria-label="默认 AGENTS 编辑器"
          value={draftContent}
          onChange={(event) => onChange(event.target.value)}
          className="h-full min-h-0 w-full resize-none overflow-y-auto border-0 bg-transparent px-2 py-1 text-[15px] leading-8 text-[#111827] outline-none dark:text-[#f3f4f6]"
          spellCheck={false}
        />
      </div>
    </section>
  );
}
