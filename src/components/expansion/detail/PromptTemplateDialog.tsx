/**
 * 扩写模式：编辑某个 action 的提示词主体对话框。
 *
 * 用户只能编辑指令主体；动态变量（当前目标 / 当前文件 / 当前章节细纲等）
 * 由代码硬编码注入到头部，对话框不展示，避免误改。
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../../ui/button";
import { BusyButton } from "../../ui/busy-button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../ui/dialog";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import { DEFAULT_PROMPT_BODIES } from "../../../lib/expansion/promptTemplates";
import type { ExpansionWorkspaceActionId } from "./ExpansionWorkspacePanel";

const TEXTAREA_ID = "expansion-prompt-body";

type PromptTemplateDialogProps = {
  actionId: ExpansionWorkspaceActionId;
  actionLabel: string;
  initialBody: string;
  onCancel: () => void;
  onReset: () => Promise<void> | void;
  onSave: (body: string) => Promise<void> | void;
};

export function PromptTemplateDialog({
  actionId,
  actionLabel,
  initialBody,
  onCancel,
  onReset,
  onSave,
}: PromptTemplateDialogProps) {
  const [value, setValue] = useState(initialBody);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(initialBody);
  }, [actionId, initialBody]);

  async function handleSave() {
    setBusy(true);
    try {
      await onSave(value);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    try {
      await onReset();
      setValue(DEFAULT_PROMPT_BODIES[actionId]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden border-border-strong bg-panel p-0 sm:max-w-2xl"
      >
        <DialogHeader className="border-b border-border bg-panel-subtle px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="truncate text-[14px] font-medium tracking-[0.01em] text-foreground">
              编辑提示词：{actionLabel}
            </DialogTitle>
            <Button
              type="button"
              aria-label="关闭弹窗"
              title="关闭弹窗"
              onClick={() => {
                if (!busy) onCancel();
              }}
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              disabled={busy}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 py-4">
          <Label htmlFor={TEXTAREA_ID} className="text-xs text-muted-foreground">
            指令主体（运行时会自动在最前拼接当前目标 / 当前文件 / 当前章节细纲等动态变量）
          </Label>
          <Textarea
            id={TEXTAREA_ID}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-h-[360px] flex-1 resize-none font-mono text-xs leading-6"
            disabled={busy}
            placeholder="请输入要发给 AI 的指令主体。"
          />
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-panel-subtle px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleReset()}
            disabled={busy}
          >
            恢复默认
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={busy}
            >
              取消
            </Button>
            <BusyButton
              type="button"
              size="sm"
              busy={busy}
              busyLabel="保存中..."
              onClick={() => void handleSave()}
            >
              保存
            </BusyButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
