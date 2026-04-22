import packageJson from "../../../package.json";
import { normalizeVersionLabel } from "../../lib/update/version";
import type { UpdateSummary } from "../../lib/update/types";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

const APP_VERSION = packageJson.version;

function formatPublishedAt(value: string | null) {
  if (!value) {
    return "未提供";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getPackageLabel(packageKind: UpdateSummary["packageKind"]) {
  return packageKind === "apk" ? "APK" : "EXE";
}

type UpdateReleaseDialogProps = {
  onDownload: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  summary: UpdateSummary | null;
};

export function UpdateReleaseDialog({
  onDownload,
  onOpenChange,
  open,
  summary,
}: UpdateReleaseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {summary ? `发现 ${normalizeVersionLabel(summary.version)}` : "发现新版本"}
          </DialogTitle>
          <DialogDescription>
            当前版本 {normalizeVersionLabel(APP_VERSION)}
            {summary ? `，发布时间 ${formatPublishedAt(summary.publishedAt)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {summary ? (
            <div className="rounded-[16px] border border-[#dbe3ee] bg-[#f8fafc] px-4 py-3 dark:border-[#2b313b] dark:bg-[#151a21]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-[#0f172a] dark:text-zinc-100">
                    {normalizeVersionLabel(summary.version)}
                  </p>
                  <p className="mt-1 text-xs text-[#64748b] dark:text-zinc-400">
                    安装包类型：{getPackageLabel(summary.packageKind ?? null)}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm font-medium text-[#0f172a] dark:text-zinc-100">更新日志</p>
            <div className="max-h-[280px] overflow-y-auto rounded-[16px] border border-[#dbe3ee] bg-white px-4 py-3 text-sm leading-6 text-[#334155] dark:border-[#2b313b] dark:bg-[#11151a] dark:text-zinc-300">
              {summary?.notes?.trim() ? (
                <pre className="whitespace-pre-wrap break-words font-sans">
                  {summary.notes.trim()}
                </pre>
              ) : (
                <p>本次版本暂未提供更新日志。</p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            稍后再说
          </Button>
          <Button type="button" onClick={onDownload}>
            下载更新
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
