import { BookOpenText, FolderOpen } from "lucide-react";
import { DialogShell } from "../dialogs/DialogShell";

type BookWorkspaceActionMenuProps = {
  busy?: boolean;
  onClose: () => void;
  onCreateBook: () => void;
  onOpenBook: () => void;
};

type ActionButtonProps = {
  ariaLabel: string;
  busy?: boolean;
  description: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
};

function ActionButton({
  ariaLabel,
  busy = false,
  description,
  icon,
  label,
  onClick,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={busy}
      onClick={onClick}
      className="flex min-h-[112px] flex-col items-start justify-between gap-4 rounded-[12px] border border-[#e2e8f0] bg-[#fbfcfd] px-5 py-4 text-left text-[#111827] transition hover:border-[#bfdbfe] hover:bg-[#eff6ff] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#262a31] dark:bg-[#14161a] dark:text-[#f3f4f6] dark:hover:border-[#24415f] dark:hover:bg-[#162131]"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#e8f3ff] text-[#0b84e7] dark:bg-[#162131] dark:text-[#7cc4ff]">
        {icon}
      </span>
      <span className="space-y-1">
        <span className="block text-base font-semibold tracking-[-0.03em]">{label}</span>
        <span className="block text-sm leading-6 text-[#6b7280] dark:text-[#9aa4b2]">{description}</span>
      </span>
    </button>
  );
}

export function BookWorkspaceActionMenu({
  busy = false,
  onClose,
  onCreateBook,
  onOpenBook,
}: BookWorkspaceActionMenuProps) {
  return (
    <DialogShell title="书籍菜单" onClose={onClose}>
      <div className="grid w-full gap-3">
        <ActionButton
          ariaLabel="选择书籍"
          busy={busy}
          description="重新选择一个已有书籍目录，并切换当前工作区显示。"
          icon={<FolderOpen className="h-5 w-5" />}
          label="选择书籍"
          onClick={onOpenBook}
        />
        <ActionButton
          ariaLabel="新建书籍"
          busy={busy}
          description="输入书名后选择父目录，自动生成新的书籍模板结构。"
          icon={<BookOpenText className="h-5 w-5" />}
          label="新建书籍"
          onClick={onCreateBook}
        />
      </div>
    </DialogShell>
  );
}

