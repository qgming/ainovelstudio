import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BusyButton } from "@shared/ui/busy-button";
import {
  getSurfaceActionClassName,
  getSurfaceActionVariant,
  type SurfaceActionTone,
} from "@shared/ui/action-button";
import { useIsMobile } from "@shared/hooks/useMobile";
import { cn } from "@shared/utils";

type PageAction = {
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  text?: string;
  tone?: SurfaceActionTone;
};

type PageShellProps = {
  actions?: PageAction[];
  children: ReactNode;
  contentClassName?: string;
  headerRight?: ReactNode;
  title?: ReactNode;
};

export function PageShell({
  actions = [],
  children,
  contentClassName,
  headerRight,
  title,
}: PageShellProps) {
  const isMobile = useIsMobile();
  const hasHeaderContent = Boolean(title) || Boolean(headerRight) || actions.length > 0;

  return (
    <section className="editor-shell flex h-full min-h-0 flex-col overflow-hidden">
      {hasHeaderContent ? (
        <header
          className={cn(
            "flex min-h-9 shrink-0 items-center gap-3 bg-app px-4 sm:px-5",
            title ? "justify-between" : "justify-end",
          )}
        >
          {title ? <div className="min-w-0 flex-1">{title}</div> : null}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {headerRight}
            {actions.map(({ busy = false, busyLabel, disabled = false, icon, label, onClick, text, tone = "default" }) => (
              <BusyButton
                key={label}
                aria-label={label}
                busy={busy}
                busyLabel={isMobile ? null : busyLabel}
                title={label}
                disabled={disabled}
                icon={icon}
                onClick={onClick}
                size={isMobile ? "icon-sm" : "sm"}
                variant={getSurfaceActionVariant(tone)}
                className={getSurfaceActionClassName({
                  className: "editor-page-action",
                  iconOnly: isMobile,
                  tone,
                })}
              >
                {isMobile ? null : <span>{text ?? label}</span>}
              </BusyButton>
            ))}
          </div>
        </header>
      ) : null}
      <div
        className={cn("min-h-0 flex-1 overflow-hidden", contentClassName)}
      >
        {children}
      </div>
    </section>
  );
}
