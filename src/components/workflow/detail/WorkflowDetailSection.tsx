import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";

type WorkflowDetailSectionProps = {
  actions?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
  className?: string;
  title: string;
};

export function WorkflowDetailSection({
  actions,
  bodyClassName,
  children,
  className,
  title,
}: WorkflowDetailSectionProps) {
  return (
    <section className={cn("flex min-h-0 flex-col bg-app", className)}>
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">{title}</h2>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn("min-h-0 px-3 py-3", bodyClassName)}>{children}</div>
    </section>
  );
}
