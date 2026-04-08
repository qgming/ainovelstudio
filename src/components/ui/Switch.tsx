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
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b84e7] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-[#111214]",
        checked ? "bg-[#0f172a] dark:bg-[#f3f4f6]" : "bg-[#d7dde8] dark:bg-[#2a3038]",
        className,
      ].join(" ")}
    >
      <span
        className={[
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform dark:bg-[#111214]",
          checked ? "translate-x-4.5" : "translate-x-0.5",
        ].join(" ")}
      />
    </button>
  );
}
