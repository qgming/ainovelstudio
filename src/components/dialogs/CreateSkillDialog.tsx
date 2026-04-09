import { useId } from "react";
import { DialogShell } from "./DialogShell";

type CreateSkillDialogProps = {
  busy?: boolean;
  description: string;
  name: string;
  onCancel: () => void;
  onChangeDescription: (value: string) => void;
  onChangeName: (value: string) => void;
  onConfirm: () => void;
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

export function CreateSkillDialog({
  busy = false,
  description,
  name,
  onCancel,
  onChangeDescription,
  onChangeName,
  onConfirm,
}: CreateSkillDialogProps) {
  const nameId = useId();
  const descriptionId = useId();

  return (
    <DialogShell title="新建技能" onClose={onCancel}>
      <div className="flex flex-1 flex-col justify-between gap-5">
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={nameId} className="block text-xs font-medium text-[#64748b] dark:text-[#94a3b8]">
              名称（英文）
            </label>
            <input
              id={nameId}
              autoFocus
              value={name}
              onChange={(event) => onChangeName(event.target.value)}
              placeholder="例如：chapter-outline"
              className="h-10 w-full rounded-[10px] border border-[#d8dee6] bg-white px-3 text-sm text-[#111827] outline-none transition-colors duration-200 placeholder:text-[#94a3b8] focus:border-[#0b84e7] dark:border-[#2a2f36] dark:bg-[#0f1115] dark:text-[#f3f4f6] dark:placeholder:text-[#64748b] dark:focus:border-zinc-100"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor={descriptionId} className="block text-xs font-medium text-[#64748b] dark:text-[#94a3b8]">
              简介
            </label>
            <textarea
              id={descriptionId}
              value={description}
              onChange={(event) => onChangeDescription(event.target.value)}
              placeholder="输入技能简介"
              rows={4}
              className="w-full rounded-[10px] border border-[#d8dee6] bg-white px-3 py-2.5 text-sm leading-6 text-[#111827] outline-none transition-colors duration-200 placeholder:text-[#94a3b8] focus:border-[#0b84e7] dark:border-[#2a2f36] dark:bg-[#0f1115] dark:text-[#f3f4f6] dark:placeholder:text-[#64748b] dark:focus:border-zinc-100"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <DialogActionButton onClick={onCancel}>取消</DialogActionButton>
          <DialogActionButton kind="primary" busy={busy} onClick={onConfirm}>
            {busy ? "创建中..." : "确认创建"}
          </DialogActionButton>
        </div>
      </div>
    </DialogShell>
  );
}
