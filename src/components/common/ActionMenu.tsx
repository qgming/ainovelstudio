import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ActionMenuAnchorRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

type ActionMenuProps = {
  anchorRect: ActionMenuAnchorRect | null;
  children: React.ReactNode;
  maxHeight?: number;
  onClose: () => void;
  width?: number;
};

type ActionMenuItemProps = {
  active?: boolean;
  ariaLabel?: string;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
};

const VIEWPORT_GUTTER = 12;
const MENU_OFFSET = 0;
const MIN_SIDE_WIDTH = 180;
const VIEWPORT_HEIGHT_RATIO_LIMIT = 0.5;
const MENU_ITEM_MIN_HEIGHT = 40;
const MIN_MENU_HEIGHT = 52;

type MenuSide = "bottom" | "left" | "right" | "top";
type ResolvedMenuPosition = {
  left: number;
  maxHeight: number;
  scrollable: boolean;
  side: MenuSide;
  top: number;
  width: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function parsePixels(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getEdgeAlignedHorizontalLeft(anchorRect: ActionMenuAnchorRect, menuWidth: number, viewportWidth: number) {
  const leftAligned = clamp(anchorRect.left, VIEWPORT_GUTTER, viewportWidth - menuWidth - VIEWPORT_GUTTER);
  const rightAligned = clamp(anchorRect.right - menuWidth, VIEWPORT_GUTTER, viewportWidth - menuWidth - VIEWPORT_GUTTER);
  const anchorCenterX = (anchorRect.left + anchorRect.right) / 2;
  return anchorCenterX <= viewportWidth / 2 ? leftAligned : rightAligned;
}

function getEdgeAlignedVerticalTop(anchorRect: ActionMenuAnchorRect, menuHeight: number, viewportHeight: number) {
  const topAligned = clamp(anchorRect.top, VIEWPORT_GUTTER, viewportHeight - menuHeight - VIEWPORT_GUTTER);
  const bottomAligned = clamp(anchorRect.bottom - menuHeight, VIEWPORT_GUTTER, viewportHeight - menuHeight - VIEWPORT_GUTTER);
  const anchorCenterY = (anchorRect.top + anchorRect.bottom) / 2;
  return anchorCenterY <= viewportHeight / 2 ? topAligned : bottomAligned;
}

function getCandidateMetrics(
  anchorRect: ActionMenuAnchorRect,
  side: MenuSide,
  contentHeight: number,
  desiredWidth: number,
  heightLimit: number,
  viewportHeight: number,
  viewportWidth: number,
) {
  const fullWidth = Math.min(desiredWidth, viewportWidth - VIEWPORT_GUTTER * 2);
  const fullHeight = Math.min(contentHeight, viewportHeight - VIEWPORT_GUTTER * 2);

  const availableWidth =
    side === "right"
      ? Math.max(0, viewportWidth - anchorRect.right - VIEWPORT_GUTTER - MENU_OFFSET)
      : side === "left"
        ? Math.max(0, anchorRect.left - VIEWPORT_GUTTER - MENU_OFFSET)
        : viewportWidth - VIEWPORT_GUTTER * 2;
  const availableHeight =
    side === "bottom"
      ? Math.max(0, viewportHeight - anchorRect.bottom - VIEWPORT_GUTTER - MENU_OFFSET)
      : side === "top"
        ? Math.max(0, anchorRect.top - VIEWPORT_GUTTER - MENU_OFFSET)
        : viewportHeight - VIEWPORT_GUTTER * 2;

  const menuWidth =
    side === "left" || side === "right"
      ? Math.max(Math.min(fullWidth, availableWidth), Math.min(MIN_SIDE_WIDTH, viewportWidth - VIEWPORT_GUTTER * 2))
      : fullWidth;
  const cappedHeight = Math.min(fullHeight, heightLimit);
  const menuHeight = Math.max(
    Math.min(cappedHeight, availableHeight),
    Math.min(MIN_MENU_HEIGHT, viewportHeight - VIEWPORT_GUTTER * 2),
  );

  const left =
    side === "right"
      ? clamp(anchorRect.right + MENU_OFFSET, VIEWPORT_GUTTER, viewportWidth - menuWidth - VIEWPORT_GUTTER)
      : side === "left"
        ? clamp(anchorRect.left - menuWidth - MENU_OFFSET, VIEWPORT_GUTTER, viewportWidth - menuWidth - VIEWPORT_GUTTER)
        : getEdgeAlignedHorizontalLeft(anchorRect, menuWidth, viewportWidth);
  const top =
    side === "bottom"
      ? clamp(anchorRect.bottom + MENU_OFFSET, VIEWPORT_GUTTER, viewportHeight - menuHeight - VIEWPORT_GUTTER)
      : side === "top"
        ? clamp(anchorRect.top - menuHeight - MENU_OFFSET, VIEWPORT_GUTTER, viewportHeight - menuHeight - VIEWPORT_GUTTER)
        : getEdgeAlignedVerticalTop(anchorRect, menuHeight, viewportHeight);

  const widthFitRatio = Math.max(0, Math.min(1, availableWidth / Math.max(fullWidth, 1)));
  const heightFitRatio = Math.max(0, Math.min(1, availableHeight / Math.max(fullHeight, 1)));
  const fitRatio = side === "left" || side === "right" ? Math.min(widthFitRatio, 1) * Math.min(heightFitRatio, 1) : Math.min(heightFitRatio, 1);
  const visibleArea = menuWidth * menuHeight;
  const isFullFit = widthFitRatio >= 1 && heightFitRatio >= 1;
  const directionBonus = side === "bottom" ? 40 : side === "top" ? 30 : side === "right" ? 20 : 10;
  const score = (isFullFit ? 1_000_000_000 : 0) + fitRatio * 1_000_000 + visibleArea + directionBonus;

  return {
    left,
    maxHeight: menuHeight,
    scrollable: fullHeight - menuHeight > 1,
    score,
    side,
    top,
    width: menuWidth,
  };
}

function getMenuMetrics(
  anchorRect: ActionMenuAnchorRect,
  contentHeight: number,
  heightLimit: number,
  width: number,
): ResolvedMenuPosition {
  const viewportWidth = typeof window === "undefined" ? width + VIEWPORT_GUTTER * 2 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? Math.max(anchorRect.bottom, anchorRect.top) + 220 : window.innerHeight;

  const candidates: MenuSide[] = ["bottom", "top", "right", "left"];
  return candidates
    .map((side) => getCandidateMetrics(anchorRect, side, contentHeight, width, heightLimit, viewportHeight, viewportWidth))
    .sort((leftCandidate, rightCandidate) => rightCandidate.score - leftCandidate.score)[0];
}

export function ActionMenuItem({
  active = false,
  ariaLabel,
  children,
  disabled = false,
  onClick,
}: ActionMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={[
        "flex min-h-10 w-full items-center rounded-[10px] px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-100",
        active
          ? "bg-[#eaf3ff] font-medium text-black dark:bg-[#162131] dark:text-[#f8fbff]"
          : "text-black hover:bg-[#eef2f7] dark:text-[#e2e8f0] dark:hover:bg-[#171b21]",
      ].join(" ")}
    >
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

export function ActionMenu({
  anchorRect,
  children,
  maxHeight,
  onClose,
  width = 220,
}: ActionMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [position, setPosition] = useState<ResolvedMenuPosition | null>(null);

  const recomputePosition = () => {
    if (!anchorRect || !menuRef.current || !contentRef.current || typeof window === "undefined") {
      setPosition(null);
      return;
    }

    const menuStyle = window.getComputedStyle(menuRef.current);
    const verticalPadding = parsePixels(menuStyle.paddingTop) + parsePixels(menuStyle.paddingBottom);
    const verticalBorder = parsePixels(menuStyle.borderTopWidth) + parsePixels(menuStyle.borderBottomWidth);
    const viewportHeightLimit = Math.floor(window.innerHeight * VIEWPORT_HEIGHT_RATIO_LIMIT);
    const minimumHeight = MENU_ITEM_MIN_HEIGHT + verticalPadding + verticalBorder;
    const contentHeight = Math.max(
      menuRef.current.scrollHeight + verticalBorder,
      contentRef.current.scrollHeight + verticalPadding + verticalBorder,
      minimumHeight,
    );
    const heightLimit = Math.min(viewportHeightLimit, maxHeight ?? Number.POSITIVE_INFINITY);
    setPosition(getMenuMetrics(anchorRect, contentHeight, heightLimit, width));
  };

  const scheduleRecompute = () => {
    if (typeof window === "undefined") {
      return;
    }
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      recomputePosition();
    });
  };

  useEffect(() => {
    if (!anchorRect) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [anchorRect, onClose]);

  useLayoutEffect(() => {
    recomputePosition();
  }, [anchorRect, children, maxHeight, width]);

  useEffect(() => {
    if (!anchorRect || !menuRef.current || !contentRef.current || typeof window === "undefined") {
      return;
    }

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleRecompute);
      resizeObserver.observe(menuRef.current);
      resizeObserver.observe(contentRef.current);
    }

    let mutationObserver: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      mutationObserver = new MutationObserver(scheduleRecompute);
      mutationObserver.observe(menuRef.current, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }

    const handleWindowResize = () => {
      scheduleRecompute();
    };

    window.addEventListener("resize", handleWindowResize);
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [anchorRect, maxHeight, width]);

  if (!anchorRect || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <>
      <button
        type="button"
        aria-label="关闭菜单"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <div
        ref={menuRef}
        role="menu"
        data-side={position?.side}
        style={{
          left: position?.left ?? -9999,
          top: position?.top ?? -9999,
          width: position?.width ?? width,
          maxHeight: position?.maxHeight ?? maxHeight,
          overflowY: position?.scrollable ? "auto" : "hidden",
          visibility: position ? "visible" : "hidden",
        }}
        className="fixed z-50 overflow-x-hidden rounded-[14px] border border-[#e2e8f0] bg-white/96 p-1.5 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur-sm dark:border-[#28303a] dark:bg-[#14181de8] dark:shadow-[0_20px_50px_rgba(0,0,0,0.38)]"
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </>,
    document.body,
  );
}
