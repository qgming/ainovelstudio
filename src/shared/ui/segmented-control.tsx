import type { ReactNode } from "react";
import { cn } from "@shared/utils";

export type SegmentedControlOption<TValue extends string> = {
  ariaLabel?: string;
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  value: TValue;
};

type SegmentedControlProps<TValue extends string> = {
  ariaLabel: string;
  buttonClassName?: string;
  className?: string;
  disabled?: boolean;
  isBusy?: boolean;
  onValueChange: (value: TValue) => void;
  options: readonly SegmentedControlOption<TValue>[];
  value: TValue;
};

export function SegmentedControl<TValue extends string>({
  ariaLabel,
  buttonClassName,
  className,
  disabled = false,
  isBusy = false,
  onValueChange,
  options,
  value,
}: SegmentedControlProps<TValue>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex w-full min-w-0 flex-wrap gap-1 rounded-xl border border-border/45 bg-panel-subtle p-1 shadow-inner shadow-black/[0.025]",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const optionDisabled = disabled || option.disabled;

        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            disabled={optionDisabled}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border px-3 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60",
              isBusy ? "disabled:cursor-wait" : "disabled:cursor-not-allowed",
              selected
                ? "border-border/55 bg-card text-foreground shadow-[0_8px_18px_rgba(15,23,42,0.08)] dark:bg-panel dark:shadow-none"
                : "border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground dark:hover:bg-panel",
              buttonClassName,
            )}
          >
            {option.icon ? (
              <span
                aria-hidden="true"
                className="inline-flex shrink-0 items-center [&_svg]:h-3.5 [&_svg]:w-3.5"
              >
                {option.icon}
              </span>
            ) : null}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
