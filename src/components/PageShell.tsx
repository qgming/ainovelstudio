import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

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
  title: ReactNode;
};

const actionStyles: Record<NonNullable<PageAction["tone"]>, string> = {
  default:
    "border-[#d7dde8] bg-transparent text-[#111827] hover:bg-[#edf1f6] dark:border-[#2a3038] dark:text-zinc-100 dark:hover:bg-[#1b1f26]",
  dark:
    "border-[#2c323c] bg-[#2c323c] text-white hover:bg-[#252b34] dark:border-[#f3f4f6] dark:bg-[#f3f4f6] dark:text-[#111827] dark:hover:bg-white",
  primary:
    "border-[#0f172a] bg-[#0f172a] text-white hover:bg-[#1e293b] dark:border-[#f3f4f6] dark:bg-[#f3f4f6] dark:text-[#111827] dark:hover:bg-white",
};

export function PageShell({
  actions = [],
  children,
  contentClassName,
  headerRight,
  title,
}: PageShellProps) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f7f7f8] dark:bg-[#111214]">
      <header className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-1 dark:border-[#20242b] sm:px-5">
        <div className="min-w-0 flex-1">{title}</div>
        {headerRight || actions.length > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {headerRight}
            {actions.map(({ icon: Icon, label, onClick, tone = "default" }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className={[
                  "inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-medium transition-colors duration-200",
                  actionStyles[tone],
                ].join(" ")}
              >
                <Icon className="h-4 w-4" strokeWidth={2.1} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </header>
      <div className={["min-h-0 flex-1 overflow-hidden px-4 py-3 sm:px-5", contentClassName ?? ""].join(" ")}>
        {children}
      </div>
    </section>
  );
}
