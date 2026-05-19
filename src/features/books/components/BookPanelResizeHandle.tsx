import { cn } from "@shared/utils";

type BookPanelResizeHandleProps = {
  active?: boolean;
  ariaLabel: string;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  side?: "left" | "right";
};

export function BookPanelResizeHandle({
  active = false,
  ariaLabel,
  onPointerDown,
  side = "right",
}: BookPanelResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className={cn(
        "group absolute inset-y-0 z-10 w-4 cursor-col-resize touch-none",
        side === "right" ? "right-0" : "left-0",
      )}
    >
      <div
        className={cn(
          "absolute top-1/2 h-[72px] -translate-y-1/2 rounded-full transition-all duration-150",
          side === "right" ? "right-0" : "left-0",
          active
            ? "w-1 bg-primary"
            : "w-0.5 bg-transparent group-hover:bg-primary/80",
        )}
      />
    </div>
  );
}
