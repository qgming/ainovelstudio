import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normalizeVersionLabel } from "@features/update/lib/version";
import type { UpdateSummary } from "@features/update/types";
import { getSurfaceActionClassName } from "@shared/ui/action-button";
import { Button } from "@shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@shared/ui/dialog";

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
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          <div className="text-sm leading-6 text-muted-foreground">
            {summary?.notes?.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {summary.notes.trim()}
              </ReactMarkdown>
            ) : (
              <p>本次版本暂未提供更新日志。</p>
            )}
          </div>
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className={getSurfaceActionClassName({ tone: "default" })}
          >
            稍后再说
          </Button>
          <Button
            type="button"
            onClick={onDownload}
            className={getSurfaceActionClassName({ tone: "primary" })}
          >
            下载更新
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
