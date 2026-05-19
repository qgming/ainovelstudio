import { useId } from "react";
import { Button } from "@shared/ui/button";
import { getSurfaceActionClassName } from "@shared/ui/action-button";
import { Input } from "@shared/ui/input";
import { Label } from "@shared/ui/label";
import { Textarea } from "@shared/ui/textarea";
import { DialogShell } from "@shared/components/dialogs/DialogShell";

type CreateSkillDialogProps = {
  busy?: boolean;
  description: string;
  name: string;
  onCancel: () => void;
  onChangeDescription: (value: string) => void;
  onChangeName: (value: string) => void;
  onConfirm: () => void;
};

// 创建技能对话框：复用 shadcn 表单组件。
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
            <Label htmlFor={nameId} className="text-xs text-muted-foreground">
              名称（英文）
            </Label>
            <Input
              id={nameId}
              autoFocus
              value={name}
              onChange={(event) => onChangeName(event.target.value)}
              placeholder="例如：chapter-outline"
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
              placeholder="输入技能简介"
              rows={4}
              className="leading-6"
            />
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onCancel}
            className={getSurfaceActionClassName({ tone: "default" })}
          >
            取消
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={onConfirm}
            className={getSurfaceActionClassName({ tone: "primary" })}
          >
            {busy ? "创建中..." : "确认创建"}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}
