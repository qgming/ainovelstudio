import { useEffect } from "react";
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
const MENU_OFFSET = 8;
const MAX_VISIBLE_MENU_ITEMS = 10;
const MENU_ITEM_MIN_HEIGHT = 40;
const MENU_ITEM_GAP = 4;
const MENU_CONTAINER_PADDING = 12;

function getMenuPosition(anchorRect: ActionMenuAnchorRect, width: number) {
  const viewportWidth = typeof window === "undefined" ? width + VIEWPORT_GUTTER * 2 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? anchorRect.bottom + MENU_OFFSET : window.innerHeight;
  const anchorCenter = (anchorRect.left + anchorRect.right) / 2;
  const shouldAlignLeftEdge = anchorCenter <= viewportWidth / 2;
  const preferredLeft = shouldAlignLeftEdge ? anchorRect.left : anchorRect.right - width;
  const maxLeft = Math.max(VIEWPORT_GUTTER, viewportWidth - width - VIEWPORT_GUTTER);
  const left = Math.min(Math.max(preferredLeft, VIEWPORT_GUTTER), maxLeft);
  const top = Math.min(anchorRect.bottom + MENU_OFFSET, Math.max(VIEWPORT_GUTTER, viewportHeight - 220));
  return { left, top, viewportHeight };
}

function getMenuMaxHeight(viewportHeight: number, top: number) {
  const preferredHeight =
    MAX_VISIBLE_MENU_ITEMS * MENU_ITEM_MIN_HEIGHT +
    (MAX_VISIBLE_MENU_ITEMS - 1) * MENU_ITEM_GAP +
    MENU_CONTAINER_PADDING;
  const availableHeight = Math.max(MENU_ITEM_MIN_HEIGHT + MENU_CONTAINER_PADDING, viewportHeight - top - VIEWPORT_GUTTER);
  return Math.min(preferredHeight, availableHeight);
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

export function ActionMenu({ anchorRect, children, onClose, width = 220 }: ActionMenuProps) {
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

  if (!anchorRect || typeof document === "undefined") {
    return null;
  }

  const position = getMenuPosition(anchorRect, width);
  const maxHeight = getMenuMaxHeight(position.viewportHeight, position.top);

  return createPortal(
    <>
      <button
        type="button"
        aria-label="关闭菜单"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-transparent"
      />
      <div
        role="menu"
        style={{ left: position.left, top: position.top, width, maxHeight }}
        className="fixed z-50 overflow-y-auto rounded-[14px] border border-[#e2e8f0] bg-white/96 p-1.5 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur-sm dark:border-[#28303a] dark:bg-[#14181de8] dark:shadow-[0_20px_50px_rgba(0,0,0,0.38)]"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
