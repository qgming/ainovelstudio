/**
 * 书籍工作区面板布局数学：clamp、左右栏占位、最大宽度计算。
 *
 * 之前内联在 BookPage 顶部，与 React 渲染混杂。抽出后纯函数易测试。
 */

import {
  COLLAPSED_PANEL_TOGGLE_WIDTH,
  MAX_AGENT_PANEL_WIDTH,
  MAX_TREE_PANEL_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  MIN_EDITOR_PANEL_WIDTH,
  MIN_TREE_PANEL_WIDTH,
  RESIZE_HANDLE_WIDTH,
  type BookPanelLayout,
} from "./layout";

/** 把数值约束到 [min, max] 之间。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 左栏在容器中实际占用的水平空间（折叠时为切换按钮宽度）。 */
export function getLeftFootprint(layout: BookPanelLayout): number {
  return layout.leftCollapsed
    ? COLLAPSED_PANEL_TOGGLE_WIDTH
    : layout.leftPanelWidth + RESIZE_HANDLE_WIDTH;
}

/** 右栏在容器中实际占用的水平空间。 */
export function getRightFootprint(layout: BookPanelLayout): number {
  return layout.rightCollapsed
    ? COLLAPSED_PANEL_TOGGLE_WIDTH
    : layout.rightPanelWidth + RESIZE_HANDLE_WIDTH;
}

/** 给定容器宽度，左栏的最大允许宽度（保留中间编辑区与右栏空间）。 */
export function getMaxLeftPanelWidth(
  layout: BookPanelLayout,
  containerWidth: number,
): number {
  return Math.min(
    MAX_TREE_PANEL_WIDTH,
    Math.max(
      MIN_TREE_PANEL_WIDTH,
      containerWidth -
        getRightFootprint(layout) -
        MIN_EDITOR_PANEL_WIDTH -
        RESIZE_HANDLE_WIDTH,
    ),
  );
}

/** 给定容器宽度，右栏的最大允许宽度。 */
export function getMaxRightPanelWidth(
  layout: BookPanelLayout,
  containerWidth: number,
): number {
  return Math.min(
    MAX_AGENT_PANEL_WIDTH,
    Math.max(
      MIN_AGENT_PANEL_WIDTH,
      containerWidth -
        getLeftFootprint(layout) -
        MIN_EDITOR_PANEL_WIDTH -
        RESIZE_HANDLE_WIDTH,
    ),
  );
}
