/**
 * useBookPanelResize：管理书籍工作区左右栏指针拖拽调宽。
 *
 * 之前 BookPage 中 startResize 函数 ~110 行 + 相关 ref 与展开 helper 都内联。
 * 抽到 hook 后页面只需消费 panelLayout / startResize 等接口。
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AGENT_PANEL_COLLAPSE_THRESHOLD,
  DEFAULT_BOOK_PANEL_LAYOUT,
  MAX_AGENT_PANEL_WIDTH,
  MAX_TREE_PANEL_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  MIN_TREE_PANEL_WIDTH,
  TREE_PANEL_COLLAPSE_THRESHOLD,
  getStoredBookPanelLayout,
  setStoredBookPanelLayout,
  type BookPanelLayout,
} from "../../lib/bookWorkspace/layout";
import {
  clamp,
  getMaxLeftPanelWidth,
  getMaxRightPanelWidth,
} from "../../lib/bookWorkspace/layoutMath";

export type ResizeHandle = "left" | "right" | null;

export function useBookPanelResize() {
  const [panelLayout, setPanelLayout] = useState<BookPanelLayout>(
    () => getStoredBookPanelLayout() ?? DEFAULT_BOOK_PANEL_LAYOUT,
  );
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandle>(null);
  const panelLayoutRef = useRef(panelLayout);
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const cleanupResizeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    panelLayoutRef.current = panelLayout;
  }, [panelLayout]);

  // 卸载时若仍在拖拽，需清理 listeners。
  useEffect(() => {
    return () => {
      cleanupResizeRef.current?.();
    };
  }, []);

  function persistPanelLayout(nextLayout: BookPanelLayout) {
    panelLayoutRef.current = nextLayout;
    setStoredBookPanelLayout(nextLayout);
  }

  /** 从折叠态展开左栏，按容器宽度限制最大值。 */
  function expandLeftPanel() {
    const panels = panelsRef.current;
    const current = panelLayoutRef.current;
    const containerWidth = panels?.getBoundingClientRect().width ?? 0;
    const maxLeftWidth =
      containerWidth > 0
        ? getMaxLeftPanelWidth({ ...current, leftCollapsed: false }, containerWidth)
        : MAX_TREE_PANEL_WIDTH;
    const nextLeftWidth = clamp(
      current.lastExpandedLeftPanelWidth,
      MIN_TREE_PANEL_WIDTH,
      maxLeftWidth,
    );
    const nextLayout = {
      ...current,
      leftCollapsed: false,
      leftPanelWidth: nextLeftWidth,
      lastExpandedLeftPanelWidth: nextLeftWidth,
    };
    setPanelLayout(nextLayout);
    persistPanelLayout(nextLayout);
  }

  /** 从折叠态展开右栏。 */
  function expandRightPanel() {
    const panels = panelsRef.current;
    const current = panelLayoutRef.current;
    const containerWidth = panels?.getBoundingClientRect().width ?? 0;
    const maxRightWidth =
      containerWidth > 0
        ? getMaxRightPanelWidth({ ...current, rightCollapsed: false }, containerWidth)
        : MAX_AGENT_PANEL_WIDTH;
    const nextRightWidth = clamp(
      current.lastExpandedRightPanelWidth,
      MIN_AGENT_PANEL_WIDTH,
      maxRightWidth,
    );
    const nextLayout = {
      ...current,
      rightCollapsed: false,
      rightPanelWidth: nextRightWidth,
      lastExpandedRightPanelWidth: nextRightWidth,
    };
    setPanelLayout(nextLayout);
    persistPanelLayout(nextLayout);
  }

  /** 启动一次指针拖拽：注册 window 上的 move/up/cancel 监听并按 handle 改写 layout。 */
  function startResize(handle: Exclude<ResizeHandle, null>) {
    return (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const panels = panelsRef.current;
      if (!panels) return;

      cleanupResizeRef.current?.();

      const rect = panels.getBoundingClientRect();
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setPanelLayout((current) => {
          if (handle === "left") {
            const candidateWidth = moveEvent.clientX - rect.left;
            // 拖到阈值以下视为折叠。
            if (candidateWidth <= TREE_PANEL_COLLAPSE_THRESHOLD) {
              const nextLayout = { ...current, leftCollapsed: true };
              panelLayoutRef.current = nextLayout;
              return nextLayout;
            }
            const maxLeftWidth = getMaxLeftPanelWidth(current, rect.width);
            const nextLeftWidth = clamp(candidateWidth, MIN_TREE_PANEL_WIDTH, maxLeftWidth);
            if (
              nextLeftWidth === current.leftPanelWidth &&
              current.leftCollapsed === false &&
              nextLeftWidth === current.lastExpandedLeftPanelWidth
            ) {
              return current;
            }
            const nextLayout = {
              ...current,
              leftCollapsed: false,
              leftPanelWidth: nextLeftWidth,
              lastExpandedLeftPanelWidth: nextLeftWidth,
            };
            panelLayoutRef.current = nextLayout;
            return nextLayout;
          }

          // handle === "right"
          const candidateWidth = rect.right - moveEvent.clientX;
          if (candidateWidth <= AGENT_PANEL_COLLAPSE_THRESHOLD) {
            const nextLayout = { ...current, rightCollapsed: true };
            panelLayoutRef.current = nextLayout;
            return nextLayout;
          }
          const maxRightWidth = getMaxRightPanelWidth(current, rect.width);
          const nextRightWidth = clamp(candidateWidth, MIN_AGENT_PANEL_WIDTH, maxRightWidth);
          if (
            nextRightWidth === current.rightPanelWidth &&
            current.rightCollapsed === false &&
            nextRightWidth === current.lastExpandedRightPanelWidth
          ) {
            return current;
          }
          const nextLayout = {
            ...current,
            rightCollapsed: false,
            rightPanelWidth: nextRightWidth,
            lastExpandedRightPanelWidth: nextRightWidth,
          };
          panelLayoutRef.current = nextLayout;
          return nextLayout;
        });
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        cleanupResizeRef.current = null;
        setActiveResizeHandle(null);
        setStoredBookPanelLayout(panelLayoutRef.current);
      };

      const handlePointerUp = () => cleanup();

      cleanupResizeRef.current = cleanup;
      setActiveResizeHandle(handle);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      event.preventDefault();
    };
  }

  return {
    panelLayout,
    activeResizeHandle,
    panelsRef,
    expandLeftPanel,
    expandRightPanel,
    startResize,
  };
}
