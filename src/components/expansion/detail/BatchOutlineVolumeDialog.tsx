/** 批量生成细纲对话框：选择目标分卷 → 触发批量生成。 */
import { Button } from "../../ui/button";
import { BusyButton } from "../../ui/busy-button";
import { DialogShell } from "../../dialogs/DialogShell";
import { formatVolumeLabel, normalizeVolumeId } from "../../../lib/expansion/metaCodec";

type BatchOutlineVolumeDialogProps = {
  busy: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onConfirm: () => void;
  value: string;
  volumeIds: string[];
};

export function BatchOutlineVolumeDialog({
  busy,
  onCancel,
  onChange,
  onConfirm,
  value,
  volumeIds,
}: BatchOutlineVolumeDialogProps) {
  return (
    <DialogShell title="批量生成细纲" onClose={onCancel}>
      <div className="flex flex-1 flex-col gap-5">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">选择已有分卷</p>
          <div className="flex flex-wrap gap-2">
            {volumeIds.length > 0 ? (
              volumeIds.map((volumeId) => {
                const active = normalizeVolumeId(value) === volumeId;
                return (
                  <Button
                    key={volumeId}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => onChange(volumeId)}
                    className="h-9 gap-1.5"
                  >
                    <span>{formatVolumeLabel(volumeId)}</span>
                  </Button>
                );
              })
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                当前还没有分卷，先点击左侧分卷区域右上角创建分卷。
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            取消
          </Button>
          <BusyButton
            type="button"
            size="sm"
            busy={busy}
            busyLabel="处理中..."
            disabled={volumeIds.length === 0}
            onClick={onConfirm}
          >
            开始生成
          </BusyButton>
        </div>
      </div>
    </DialogShell>
  );
}
