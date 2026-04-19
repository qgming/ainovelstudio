import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DialogShell } from "./DialogShell";

type CreateAgentDialogProps = {
  busy?: boolean;
  description: string;
  name: string;
  onCancel: () => void;
  onChangeDescription: (value: string) => void;
  onChangeName: (value: string) => void;
  onConfirm: () => void;
};

// 创建代理对话框：使用 shadcn Input/Textarea/Button/Label，全部 token 化。
export function CreateAgentDialog({
  busy = false,
  description,
  name,
  onCancel,
  onChangeDescription,
  onChangeName,
  onConfirm,
}: CreateAgentDialogProps) {
  const nameId = useId();
  const descriptionId = useId();

  return (
    <DialogShell title="新建代理" onClose={onCancel}>
      <div className="flex flex-1 flex-col justify-between gap-5">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={nameId} className="text-xs text-muted-foreground">
              名称（英文）
            </Label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              onChange={(event) => onChangeName(event.target.value)}
              placeholder="例如：writer"
              className="h-10"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={descriptionId} className="text-xs text-muted-foreground">
              简介
            </Label>
            <Textarea
              id={descriptionId}
              value={description}
              onChange={(event) => onChangeDescription(event.target.value)}
              placeholder="输入代理简介"
              rows={4}
              className="leading-6"
            />
          </div>
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
