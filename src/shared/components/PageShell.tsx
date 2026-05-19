import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BusyButton } from "@shared/ui/busy-button";
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
  tone?: "default" | "dark" | "primary";
};

type PageShellProps = {
  actions?: PageAction[];
  children: ReactNode;
  contentClassName?: string;
  headerRight?: ReactNode;
  title?: ReactNode;
};

const actionVariants: Record<NonNullable<PageAction["tone"]>, "outline" | "secondary" | "default"> = {
  default: "outline",
  dark: "secondary",
  primary: "default",
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
                variant={actionVariants[tone]}
                className={cn(
                  "editor-page-action shadow-[0_8px_18px_rgba(15,23,42,0.045)] hover:shadow-[0_10px_22px_rgba(15,23,42,0.07)] dark:shadow-none dark:hover:shadow-none",
                  isMobile ? "h-9 w-9 rounded-xl px-0" : "h-9 rounded-xl gap-1.5 px-3.5 text-[13px]",
                  tone === "default" && "border-border/55 bg-panel text-foreground hover:border-border/75 hover:bg-panel-subtle dark:bg-panel dark:hover:bg-panel-subtle",
                  tone === "dark" && "border-border/55 bg-secondary text-foreground hover:border-border/75 hover:bg-accent",
                  tone === "primary" && "border-primary/25 bg-primary text-primary-foreground shadow-[0_8px_18px_color-mix(in_oklab,var(--color-primary)_14%,transparent)] hover:border-primary/28 hover:bg-primary/92 hover:shadow-[0_10px_22px_color-mix(in_oklab,var(--color-primary)_18%,transparent)] dark:shadow-none dark:hover:shadow-none",
                )}
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
