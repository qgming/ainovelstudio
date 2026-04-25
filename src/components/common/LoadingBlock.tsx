/**
 * 通用加载块：spinner + 标题 + 可选副标题，居中显示。
 * 用于替代各页面分散的"正在加载…"文案。
 */

import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/utils";

export type LoadingBlockProps = {
  /** 主标题，如"正在加载工作流详情..."。 */
  title: string;
  /** 可选副标题，进一步说明等待原因。 */
  description?: string;
  /** 容器额外类名。 */
  className?: string;
};

export function LoadingBlock({ title, description, className }: LoadingBlockProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex h-full min-h-0 items-center justify-center px-6",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{title}</p>
        {description ? (
          <p className="max-w-md text-xs text-muted-foreground/80">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
