import packageJson from "../../../../package.json";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeVersionLabel } from "@features/update/lib/version";
import type { UpdateSummary } from "@features/update/types";
import { Button } from "@shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/ui/dialog";

const APP_VERSION = packageJson.version;

const markdownComponents = {
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-foreground underline underline-offset-3 hover:opacity-80"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-3 border-l-2 border-border-strong pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode }) => (
    <code
      {...props}
      className={`rounded bg-muted px-1.5 py-0.5 font-mono text-[0.92em] text-foreground ${className ?? ""}`.trim()}
    >
      {children}
    </code>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="mb-3 text-lg font-semibold text-foreground">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="mb-2 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
  hr: () => <hr className="my-4 border-border" />,
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-1 pl-1 last:mb-0">{children}</li>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 last:mb-0">{children}</p>,
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="mb-3 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[0.92em] leading-6 text-foreground last:mb-0">
      {children}
    </pre>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="mb-3 overflow-x-auto rounded-md border border-border last:mb-0">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  td: ({ children }: { children?: React.ReactNode }) => <td className="border-t border-border px-2 py-1.5 align-top">{children}</td>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="bg-muted/60 px-2 py-1.5 font-semibold text-foreground">{children}</th>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
} as const;

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
      <DialogContent className="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-5 pb-3 pt-5 pr-12">
          <DialogTitle>
            {summary ? `发现 ${normalizeVersionLabel(summary.version)}` : "发现新版本"}
          </DialogTitle>
          <DialogDescription>
            当前版本 {normalizeVersionLabel(APP_VERSION)}
            {summary ? `，发布时间 ${formatPublishedAt(summary.publishedAt)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
          {summary ? (
            <div className="rounded-lg border border-border bg-panel-subtle px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {normalizeVersionLabel(summary.version)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    安装包类型：{getPackageLabel(summary.packageKind ?? null)}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">更新日志</p>
            <div className="rounded-lg border border-border bg-background px-4 py-3 text-sm leading-6 text-muted-foreground">
              {summary?.notes?.trim() ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                  {summary.notes.trim()}
                </ReactMarkdown>
              ) : (
                <p>本次版本暂未提供更新日志。</p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="shrink-0">
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
