/**
 * BusyButton：在 disabled 之外补 aria-busy，并在 busy 时替换图标为 LoaderCircle 自旋。
 *
 * 使用约定：
 *   <BusyButton busy={saveBusy} icon={Save} busyLabel="保存中...">
 *     保存
 *   </BusyButton>
 *
 * 之前各页面用 `<Button disabled>` 控制点击，但缺少可访问性反馈，文案也分散。
 */

import { LoaderCircle, type LucideIcon } from "lucide-react";
import { forwardRef, type ComponentProps, type ReactNode } from "react";
import { Button } from "./button";
import { cn } from "../../lib/utils";

type BaseButtonProps = ComponentProps<typeof Button>;

export type BusyButtonProps = Omit<BaseButtonProps, "children"> & {
  /** 是否处于运行态：busy=true 时按钮禁用 + spinner 替换图标。 */
  busy?: boolean;
  /** 可选图标（idle 时显示）；busy 时统一替换为 LoaderCircle。 */
  icon?: LucideIcon;
  /** idle 时的文本子节点。 */
  children?: ReactNode;
  /** busy 时显示的文本，默认在原 children 末尾追加"中..."。 */
  busyLabel?: ReactNode;
  /** 图标尺寸的 Tailwind 类，默认 h-4 w-4。 */
  iconClassName?: string;
};

export const BusyButton = forwardRef<HTMLButtonElement, BusyButtonProps>(function BusyButton(
  {
    busy = false,
    disabled,
    icon: Icon,
    iconClassName,
    children,
    busyLabel,
    "aria-label": ariaLabel,
    ...rest
  },
  ref,
) {
  const ResolvedIcon = busy ? LoaderCircle : Icon;
  const label = busy ? (busyLabel ?? children) : children;
  return (
    <Button
      ref={ref}
      {...rest}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
      disabled={disabled || busy}
    >
      {ResolvedIcon ? (
        <ResolvedIcon
          className={cn("h-4 w-4", busy && "animate-spin", iconClassName)}
          aria-hidden="true"
        />
      ) : null}
      {label}
    </Button>
  );
});
