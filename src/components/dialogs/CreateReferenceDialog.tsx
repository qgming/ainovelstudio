import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogShell } from "./DialogShell";

type CreateReferenceDialogProps = {
  busy?: boolean;
  name: string;
  onCancel: () => void;
  onChangeName: (value: string) => void;
  onConfirm: () => void;
};

// 添加参考文献对话框：仅一个名称字段，使用 shadcn Input/Button/Label。
export function CreateReferenceDialog({
  busy = false,
  name,
  onCancel,
  onChangeName,
  onConfirm,
}: CreateReferenceDialogProps) {
  const inputId = useId();

  return (
    <DialogShell title="添加参考文献" onClose={onCancel}>
      <div className="flex flex-1 flex-col justify-between gap-5">
        <div className="space-y-2">
          <Label htmlFor={inputId} className="text-xs text-muted-foreground">
            名称（英文）
          </Label>
          <Input
            id={inputId}
            autoFocus
            value={name}
            onChange={(event) => onChangeName(event.target.value)}
            placeholder="例如：world-rules"
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
            {busy ? "创建中..." : "确认创建"}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
