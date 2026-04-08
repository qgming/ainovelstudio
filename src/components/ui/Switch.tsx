import type { MouseEvent } from "react";

type SwitchProps = {
  checked: boolean;
  className?: string;
  disabled?: boolean;
  label?: string;
  onChange: (checked: boolean) => void;
};

export function Switch({ checked, className = "", disabled = false, label, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!disabled) {
          onChange(!checked);
        }
      }}
      className={[
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b84e7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f7f8] disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-[#111214]",
        checked
          ? "border-[#0b84e7] bg-[#0b84e7] dark:border-[#60a5fa] dark:bg-[#60a5fa]"
          : "border-[#cbd5e1] bg-[#e2e8f0] dark:border-[#2a3038] dark:bg-[#1b1f26]",
        className,
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 dark:bg-[#f8fafc]",
          checked ? "translate-x-5" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}
