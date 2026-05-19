import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
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

const COLLAPSED_HEIGHT_FALLBACK = 40;
const ROW_OFFSET_TOLERANCE = 1;
const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

function areStringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

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
  const controlId = useId();
  const controlRef = useRef<HTMLDivElement | null>(null);
  const [canExpand, setCanExpand] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [collapsedHeight, setCollapsedHeight] = useState(
    COLLAPSED_HEIGHT_FALLBACK,
  );
  const [expandedHeight, setExpandedHeight] = useState(
    COLLAPSED_HEIGHT_FALLBACK,
  );
  const [collapsedVisibleValues, setCollapsedVisibleValues] = useState<Set<string>>(
    () => new Set(),
  );
  const optionKey = useMemo(
    () => options.map((option) => option.value).join("\u001f"),
    [options],
  );

  const measure = useCallback(() => {
    const control = controlRef.current;
    if (!control || typeof window === "undefined") return;

    const buttons = Array.from(
      control.querySelectorAll<HTMLButtonElement>(
        '[data-segmented-control-option="true"]',
      ),
    );

    if (buttons.length === 0) {
      setCanExpand(false);
      setIsExpanded(false);
      setCollapsedHeight(COLLAPSED_HEIGHT_FALLBACK);
      setExpandedHeight(COLLAPSED_HEIGHT_FALLBACK);
      setCollapsedVisibleValues((current) =>
        current.size === 0 ? current : new Set(),
      );
      return;
    }

    const controlRect = control.getBoundingClientRect();
    const buttonRects = buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        bottom: rect.bottom - controlRect.top,
        button,
        top: rect.top - controlRect.top,
      };
    });
    const firstRowTop = buttonRects[0].top;
    const firstRowButtons = buttonRects.filter(
      ({ top }) => Math.abs(top - firstRowTop) <= ROW_OFFSET_TOLERANCE,
    );
    const hasWrapped = buttonRects.some(
      ({ top }) => top - firstRowTop > ROW_OFFSET_TOLERANCE,
    );
    const controlStyle = window.getComputedStyle(control);
    const borderTop = Number.parseFloat(controlStyle.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(controlStyle.borderBottomWidth) || 0;
    const paddingBottom = Number.parseFloat(controlStyle.paddingBottom) || 0;
    const firstRowBottom = firstRowButtons.reduce(
      (maxBottom, { bottom }) => Math.max(maxBottom, bottom),
      0,
    );
    const measuredCollapsedHeight = Math.ceil(
      firstRowBottom + paddingBottom + borderBottom,
    );
    const nextCollapsedHeight = measuredCollapsedHeight > 0
      ? measuredCollapsedHeight
      : COLLAPSED_HEIGHT_FALLBACK;
    const nextExpandedHeight = Math.max(
      nextCollapsedHeight,
      Math.ceil(control.scrollHeight + borderTop + borderBottom),
    );
    const nextCollapsedVisibleValues = new Set(
      firstRowButtons.flatMap(({ button }) => {
        const optionValue = button.dataset.segmentedControlValue;
        return optionValue ? [optionValue] : [];
      }),
    );

    setCanExpand((current) => (current === hasWrapped ? current : hasWrapped));
    setCollapsedHeight((current) =>
      current === nextCollapsedHeight ? current : nextCollapsedHeight,
    );
    setExpandedHeight((current) =>
      current === nextExpandedHeight ? current : nextExpandedHeight,
    );
    setCollapsedVisibleValues((current) =>
      areStringSetsEqual(current, nextCollapsedVisibleValues)
        ? current
        : nextCollapsedVisibleValues,
    );
    if (!hasWrapped) setIsExpanded(false);
  }, []);

  useEffect(() => {
    setCanExpand(false);
    setIsExpanded(false);
    setCollapsedHeight(COLLAPSED_HEIGHT_FALLBACK);
    setExpandedHeight(COLLAPSED_HEIGHT_FALLBACK);
    setCollapsedVisibleValues(new Set());
  }, [optionKey]);

  useIsoLayoutEffect(() => {
    measure();
    if (
      typeof window === "undefined" ||
      typeof window.requestAnimationFrame !== "function"
    ) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frameId);
  }, [canExpand, measure, optionKey, value]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const control = controlRef.current;
    if (!control) return undefined;

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(control);
      if (typeof document !== "undefined") {
        resizeObserver.observe(document.documentElement);
      }
      return () => resizeObserver.disconnect();
    }

    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, optionKey]);

  const controlStyle: CSSProperties | undefined = canExpand
    ? { maxHeight: isExpanded ? expandedHeight : collapsedHeight }
    : undefined;
  const toggleLabel = isExpanded
    ? `收起${ariaLabel}选项`
    : `展开${ariaLabel}选项`;
  const ToggleIcon = isExpanded ? ChevronUp : ChevronDown;

  return (
    <div
      id={controlId}
      ref={controlRef}
      role="group"
      aria-label={ariaLabel}
      style={controlStyle}
      className={cn(
        "relative flex w-full min-w-0 flex-wrap gap-1 rounded-xl border border-border/45 bg-panel-subtle p-1 shadow-inner shadow-black/[0.025]",
        canExpand &&
          "overflow-hidden pr-10 transition-[max-height] duration-200 ease-out will-change-[max-height] motion-reduce:transition-none",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const optionDisabled = disabled || option.disabled;
        const hiddenWhenCollapsed =
          canExpand &&
          !isExpanded &&
          collapsedVisibleValues.size > 0 &&
          !collapsedVisibleValues.has(option.value);

        return (
          <button
            key={option.value}
            type="button"
            data-segmented-control-option="true"
            data-segmented-control-value={option.value}
            aria-hidden={hiddenWhenCollapsed ? true : undefined}
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            disabled={optionDisabled}
            tabIndex={hiddenWhenCollapsed ? -1 : undefined}
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
      {canExpand ? (
        <button
          type="button"
          aria-controls={controlId}
          aria-expanded={isExpanded}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => setIsExpanded((current) => !current)}
          className={cn(
            "absolute right-1 top-1 z-20 inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
            isBusy ? "cursor-wait" : "cursor-pointer",
          )}
        >
          <ToggleIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
