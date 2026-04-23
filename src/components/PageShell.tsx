import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "../hooks/use-mobile";
import { cn } from "@/lib/utils";

type PageAction = {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
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
            "flex min-h-10 shrink-0 items-center gap-3 border-b border-border bg-panel-subtle px-4 py-1.5 sm:px-5",
            title ? "justify-between" : "justify-end",
          )}
        >
          {title ? <div className="min-w-0 flex-1">{title}</div> : null}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {headerRight}
            {actions.map(({ disabled = false, icon: Icon, label, onClick, tone = "default" }) => (
              <Button
                key={label}
                aria-label={label}
                title={label}
                disabled={disabled}
                onClick={onClick}
                size={isMobile ? "icon-sm" : "sm"}
                variant={actionVariants[tone]}
                className={cn(
                  isMobile ? "px-0" : "gap-1.5",
                  tone === "dark" && "border-border bg-secondary text-foreground",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={2.1} />
                {isMobile ? null : <span>{label}</span>}
              </Button>
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
