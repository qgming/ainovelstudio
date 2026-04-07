import { DialogShell } from "./DialogShell";

type ConfirmDialogProps = {
  busy?: boolean;
  confirmLabel: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
};

function DialogActionButton({
  children,
  kind = "secondary",
  onClick,
  busy = false,
}: {
  busy?: boolean;
  children: React.ReactNode;
  kind?: "danger" | "secondary";
  onClick: () => void;
}) {
  const className =
    kind === "danger"
      ? "bg-[#c2412d] text-white hover:bg-[#a63624] dark:bg-[#ef4444] dark:text-white dark:hover:bg-[#dc2626]"
      : "border border-[#d8dee6] bg-transparent text-[#334155] hover:bg-[#edf1f6] dark:border-[#2a2f36] dark:text-[#cbd5e1] dark:hover:bg-[#1a1c21]";

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={`inline-flex h-8 items-center justify-center rounded-[8px] px-3 text-[11px] font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {children}
    </button>
  );
}

export function ConfirmDialog({
  busy = false,
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  title,
}: ConfirmDialogProps) {
  return (
    <DialogShell title={title} onClose={onCancel}>
      <div className="flex flex-1 flex-col justify-between gap-5">
        <div className="space-y-3">
          <p className="text-sm leading-6 text-[#64748b] dark:text-[#94a3b8]">
            {description}
          </p>
          <p className="text-sm leading-6 text-[#94a3b8] dark:text-[#64748b]">
            删除后不会进入回收站，请确认这是你想要的操作。
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <DialogActionButton onClick={onCancel}>取消</DialogActionButton>
          <DialogActionButton kind="danger" busy={busy} onClick={onConfirm}>
            {busy ? "处理中..." : confirmLabel}
          </DialogActionButton>
        </div>
      </div>
    </DialogShell>
  );
}
