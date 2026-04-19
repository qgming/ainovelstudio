import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

// 单字段输入对话框：复用 shadcn Input/Button/Label 与项目主题 token。
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
        <div className="space-y-2">
          <Label htmlFor={inputId} className="text-xs text-muted-foreground">
            {label}
          </Label>
          <Input
            id={inputId}
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={description}
            className="h-10"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "处理中..." : confirmLabel}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
