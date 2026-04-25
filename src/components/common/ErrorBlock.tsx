/**
 * 通用错误块：AlertCircle + 标题 + 可选详情 + 可选操作按钮。
 * 用于替代各页面"未找到 / 加载失败"分支的散写法。
 */

import { AlertCircle } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export type ErrorBlockProps = {
  /** 主标题，如"未找到该工作流"。 */
  title: string;
  /** 可选详情，通常是 errorMessage。 */
  description?: string | null;
  /** 可选操作按钮文本。 */
  actionLabel?: string;
  /** 操作按钮点击回调。 */
  onAction?: () => void;
  /** 容器额外类名。 */
  className?: string;
};

export function ErrorBlock({
  title,
  description,
  actionLabel,
  onAction,
  className,
}: ErrorBlockProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex h-full min-h-0 items-center justify-center px-6",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? (
          <pre className="mx-auto max-w-2xl whitespace-pre-wrap break-words rounded-lg border border-border bg-panel p-3 text-left text-sm leading-6 text-muted-foreground">
            {description}
          </pre>
        ) : null}
        {actionLabel && onAction ? (
          <Button type="button" variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
