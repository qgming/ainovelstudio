import { ChevronLeft, ChevronRight } from "lucide-react";
import { COLLAPSED_PANEL_TOGGLE_WIDTH } from "../../lib/bookWorkspace/layout";

type BookCollapsedPanelToggleProps = {
  ariaLabel: string;
  onClick: () => void;
  side: "left" | "right";
};

export function BookCollapsedPanelToggle({
  ariaLabel,
  onClick,
  side,
}: BookCollapsedPanelToggleProps) {
  const Icon = side === "left" ? ChevronRight : ChevronLeft;
  const sideClass =
    side === "left"
      ? "left-0 rounded-r-full border-l-0"
      : "right-0 rounded-l-full border-r-0";

  return (
    <div
      style={{ width: COLLAPSED_PANEL_TOGGLE_WIDTH }}
      className="relative flex h-full shrink-0 bg-app"
    >
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className={[
          "group absolute top-[30%] z-10 flex -translate-y-1/2 items-center justify-center border text-white shadow-[0_10px_24px_rgba(11,132,231,0.24)] transition-all duration-150 hover:scale-[1.03] hover:shadow-[0_14px_28px_rgba(11,132,231,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b84e7]/35 dark:text-[#0b1624] dark:shadow-[0_10px_24px_rgba(124,196,255,0.22)] dark:hover:shadow-[0_14px_28px_rgba(124,196,255,0.3)] dark:focus-visible:ring-[#7cc4ff]/35",
          "h-12 w-[18px] border-[#0975cd] bg-[#0b84e7] dark:border-[#7cc4ff] dark:bg-[#7cc4ff]",
          sideClass,
        ].join(" ")}
      >
        <Icon className="h-4 w-4 transition-transform duration-150 group-hover:scale-110" />
      </button>
    </div>
  );
}
