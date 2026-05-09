type BookPanelResizeHandleProps = {
  active?: boolean;
  ariaLabel: string;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
};

export function BookPanelResizeHandle({
  active = false,
  ariaLabel,
  onPointerDown,
}: BookPanelResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="group relative flex w-1 shrink-0 cursor-col-resize touch-none items-stretch justify-center bg-transparent"
    >
      <div
        className={[
          "absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all duration-150",
          active
            ? "w-[3px] bg-[#0b84e7] dark:bg-[#7cc4ff]"
            : "w-px bg-[#d7dde5] dark:bg-[#2a3038] group-hover:w-[3px] group-hover:bg-[#0b84e7] dark:group-hover:bg-[#7cc4ff]",
        ].join(" ")}
      />
    </div>
  );
}
