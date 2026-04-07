export type BookPanelLayout = {
  leftPanelWidth: number;
  rightPanelWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  lastExpandedLeftPanelWidth: number;
  lastExpandedRightPanelWidth: number;
};

export const BOOK_PANEL_LAYOUT_STORAGE_KEY = "ainovelstudio-book-layout";
export const DEFAULT_BOOK_PANEL_LAYOUT: BookPanelLayout = {
  leftPanelWidth: 310,
  rightPanelWidth: 320,
  leftCollapsed: false,
  rightCollapsed: false,
  lastExpandedLeftPanelWidth: 310,
  lastExpandedRightPanelWidth: 320,
};
export const MIN_TREE_PANEL_WIDTH = 180;
export const MAX_TREE_PANEL_WIDTH = 520;
export const TREE_PANEL_COLLAPSE_THRESHOLD = 160;
export const MIN_AGENT_PANEL_WIDTH = 200;
export const MAX_AGENT_PANEL_WIDTH = 560;
export const AGENT_PANEL_COLLAPSE_THRESHOLD = 180;
export const MIN_EDITOR_PANEL_WIDTH = 320;
export const COLLAPSED_PANEL_TOGGLE_WIDTH = 22;
export const RESIZE_HANDLE_WIDTH = 12;

function isValidWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function getStoredBookPanelLayout(): BookPanelLayout | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(BOOK_PANEL_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<BookPanelLayout>;
    const leftPanelWidth = parsed.leftPanelWidth;
    const rightPanelWidth = parsed.rightPanelWidth;
    if (!isValidWidth(leftPanelWidth) || !isValidWidth(rightPanelWidth)) {
      return null;
    }

    const lastExpandedLeftPanelWidth = isValidWidth(parsed.lastExpandedLeftPanelWidth)
      ? parsed.lastExpandedLeftPanelWidth
      : leftPanelWidth;
    const lastExpandedRightPanelWidth = isValidWidth(parsed.lastExpandedRightPanelWidth)
      ? parsed.lastExpandedRightPanelWidth
      : rightPanelWidth;

    return {
      leftPanelWidth,
      rightPanelWidth,
      leftCollapsed: parsed.leftCollapsed === true,
      rightCollapsed: parsed.rightCollapsed === true,
      lastExpandedLeftPanelWidth,
      lastExpandedRightPanelWidth,
    };
  } catch {
    return null;
  }
}

export function setStoredBookPanelLayout(layout: BookPanelLayout) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(BOOK_PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}
