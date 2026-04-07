import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type PageAction = {
  icon: LucideIcon;
  label: string;
  tone?: "default" | "dark" | "primary";
};

type PageShellProps = {
  actions?: PageAction[];
  children: ReactNode;
  description?: string;
  title: string;
};

const actionStyles: Record<NonNullable<PageAction["tone"]>, string> = {
  default:
    "border-[#dde1e7] bg-white text-[#111827] hover:border-[#0b84e7]/40 hover:text-[#0b84e7] dark:border-[#2a2d34] dark:bg-[#17191d] dark:text-zinc-100 dark:hover:border-[#3b3f47] dark:hover:bg-[#1d2026] dark:hover:text-white",
  dark:
    "border-[#445065] bg-[#445065] text-white hover:bg-[#3a465c] dark:border-[#2e323a] dark:bg-[#2e323a] dark:text-zinc-100 dark:hover:bg-[#393e48]",
  primary:
    "border-[#0b84e7] bg-[#0b84e7] text-white hover:bg-[#0a74cb] dark:border-zinc-100 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300",
};

export function PageShell({ actions = [], children, description, title }: PageShellProps) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f7f8fb] px-8 py-10 dark:bg-[#0f1012] sm:px-10">
      <header className="shrink-0 flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-5xl font-bold tracking-[-0.04em] text-[#0f172a] dark:text-zinc-50">
            {title}
          </h1>
          {description ? (
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[#607089] dark:text-zinc-400">
              {description}
            </p>
          ) : null}
        </div>
        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-3 lg:justify-end">
            {actions.map(({ icon: Icon, label, tone = "default" }) => (
              <button
                key={label}
                type="button"
                className={[
                  "inline-flex h-16 items-center gap-3 rounded-[22px] border px-6 text-[19px] font-semibold transition-colors duration-200",
                  actionStyles[tone],
                ].join(" ")}
              >
                <Icon className="h-5 w-5" strokeWidth={2.2} />
                <span>{label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </header>
      <div className="mt-10 min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}
