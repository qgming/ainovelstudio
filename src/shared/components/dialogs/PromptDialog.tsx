import { useId } from "react";
import { Button } from "@shared/ui/button";
import { getSurfaceActionClassName } from "@shared/ui/action-button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";
import { DialogShell } from "@shared/components/dialogs/DialogShell";

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
        <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
            className={getSurfaceActionClassName({ className: "min-w-0 sm:flex-none", tone: "default" })}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={onConfirm}
            className={getSurfaceActionClassName({ className: "min-w-0 sm:flex-none", tone: "primary" })}
          >
            {busy ? "处理中..." : confirmLabel}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
