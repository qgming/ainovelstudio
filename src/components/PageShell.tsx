import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageAction = {
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
  const hasHeaderContent = Boolean(title) || Boolean(headerRight) || actions.length > 0;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f7f7f8] dark:bg-[#111214]">
      {hasHeaderContent ? (
        <header
          className={[
            "flex min-h-10 shrink-0 items-center gap-3 border-b border-[#e2e8f0] px-4 py-1 dark:border-[#20242b] sm:px-5",
            title ? "justify-between" : "justify-end",
          ].join(" ")}
        >
          {title ? <div className="min-w-0 flex-1">{title}</div> : null}
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {headerRight}
            {actions.map(({ icon: Icon, label, onClick, tone = "default" }) => (
              <Button
                key={label}
                onClick={onClick}
                size="sm"
                variant={actionVariants[tone]}
                className="gap-1.5"
              >
                <Icon className="h-4 w-4" strokeWidth={2.1} />
                <span>{label}</span>
              </Button>
            ))}
          </div>
        </header>
      ) : null}
      <div
        className={[
          "min-h-0 flex-1 overflow-hidden",
          contentClassName ?? "",
        ].join(" ")}
      >
        {children}
      </div>
    </section>
  );
}
