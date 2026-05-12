import { AlertCircle, ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@shared/ui/button";
import { cn } from "@shared/utils";

type CollapsibleErrorNoticeProps = {
  className?: string;
  message: string;
  onDismiss?: () => void;
};

export function CollapsibleErrorNotice({
  className,
  message,
  onDismiss,
}: CollapsibleErrorNoticeProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "flex shrink-0 items-start gap-3 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className,
      )}
      role="alert"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={cn(
            "block leading-6",
            expanded ? "whitespace-pre-wrap break-words" : "truncate",
          )}
        >
          {message}
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          aria-label={expanded ? "收起错误详情" : "展开错误详情"}
          title={expanded ? "收起错误详情" : "展开错误详情"}
          onClick={() => setExpanded((current) => !current)}
          variant="ghost"
          size="icon-xs"
          className="h-7 w-7 text-destructive hover:bg-destructive/10"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              expanded ? "rotate-180" : "rotate-0",
            )}
          />
        </Button>
        {onDismiss ? (
          <Button
            type="button"
            aria-label="关闭错误提示"
            title="关闭错误提示"
            onClick={onDismiss}
            variant="ghost"
            size="icon-xs"
            className="h-7 w-7 text-destructive hover:bg-destructive/10"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

