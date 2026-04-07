import { useId } from "react";
import { DialogShell } from "./DialogShell";

type PromptDialogProps = {
  busy?: boolean;
  confirmLabel: string;
  description: string;
  label: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onConfirm: () => void;
  title: string;
  value: string;
};

function DialogActionButton({
  children,
  kind = "secondary",
  onClick,
  busy = false,
}: {
  busy?: boolean;
  children: React.ReactNode;
  kind?: "primary" | "secondary";
  onClick: () => void;
}) {
  const className =
    kind === "primary"
      ? "bg-[#0b84e7] text-white hover:bg-[#0975cd] dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-200"
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

export function PromptDialog({
  busy = false,
  confirmLabel,
  description,
  label,
  onCancel,
  onChange,
  onConfirm,
  title,
  value,
}: PromptDialogProps) {
  const inputId = useId();

  return (
    <DialogShell title={title} onClose={onCancel}>
      <div className="flex flex-1 flex-col justify-between gap-5">
        <div className="space-y-3">
          <label htmlFor={inputId} className="block text-xs font-medium text-[#64748b] dark:text-[#94a3b8]">
            {label}
          </label>
          <input
            id={inputId}
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={description}
            className="h-10 w-full rounded-[10px] border border-[#d8dee6] bg-white px-3 text-sm text-[#111827] outline-none transition-colors duration-200 placeholder:text-[#94a3b8] focus:border-[#0b84e7] dark:border-[#2a2f36] dark:bg-[#0f1115] dark:text-[#f3f4f6] dark:placeholder:text-[#64748b] dark:focus:border-zinc-100"
          />
        </div>
        <div className="flex justify-end gap-2">
          <DialogActionButton onClick={onCancel}>取消</DialogActionButton>
          <DialogActionButton kind="primary" busy={busy} onClick={onConfirm}>
            {busy ? "处理中..." : confirmLabel}
          </DialogActionButton>
        </div>
      </div>
    </DialogShell>
  );
}
