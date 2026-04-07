import type { ReactNode } from "react";
import { X } from "lucide-react";

type DialogShellProps = {
  children: ReactNode;
  onClose: () => void;
  title: string;
};

export function DialogShell({ children, onClose, title }: DialogShellProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f172a]/18 px-4 py-6 backdrop-blur-[3px] dark:bg-black/42">
      <div className="flex min-h-[280px] w-full max-w-md flex-col overflow-hidden rounded-[12px] border border-[#e2e8f0] bg-[#f7f7f8] shadow-[0_18px_50px_rgba(15,23,42,0.16)] dark:border-[#20242b] dark:bg-[#111214]">
        <div className="flex items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-3.5 dark:border-[#20242b]">
          <h2 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-[#f3f4f6]">
            {title}
          </h2>
          <button
            type="button"
            aria-label="关闭弹窗"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] p-0 text-[#111827] transition-colors duration-200 hover:bg-[#edf1f6] dark:text-zinc-300 dark:hover:bg-[#1a1c21]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 px-4 py-5">{children}</div>
      </div>
    </div>
  );
}
