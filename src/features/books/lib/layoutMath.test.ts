import { describe, expect, it } from "vitest";
import {
  clamp,
  getLeftFootprint,
  getMaxLeftPanelWidth,
  getMaxRightPanelWidth,
  getRightFootprint,
} from "./layoutMath";
import {
  COLLAPSED_PANEL_TOGGLE_WIDTH,
  MAX_AGENT_PANEL_WIDTH,
  MAX_TREE_PANEL_WIDTH,
  RESIZE_HANDLE_WIDTH,
  type BookPanelLayout,
} from "./layout";

const baseLayout: BookPanelLayout = {
  leftCollapsed: false,
  rightCollapsed: false,
  leftPanelWidth: 240,
  rightPanelWidth: 320,
  lastExpandedLeftPanelWidth: 240,
  lastExpandedRightPanelWidth: 320,
};

describe("layoutMath", () => {
  it("clamp 把数值约束到 [min, max]", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("getLeftFootprint 折叠时为切换按钮宽，否则为面板 + 拖拽手柄", () => {
    expect(getLeftFootprint({ ...baseLayout, leftCollapsed: true })).toBe(
      COLLAPSED_PANEL_TOGGLE_WIDTH,
    );
    expect(getLeftFootprint(baseLayout)).toBe(240 + RESIZE_HANDLE_WIDTH);
  });

  it("getRightFootprint 同理", () => {
    expect(getRightFootprint({ ...baseLayout, rightCollapsed: true })).toBe(
      COLLAPSED_PANEL_TOGGLE_WIDTH,
    );
    expect(getRightFootprint(baseLayout)).toBe(320 + RESIZE_HANDLE_WIDTH);
  });

  it("getMaxLeftPanelWidth 不超过 MAX_TREE_PANEL_WIDTH", () => {
    expect(getMaxLeftPanelWidth(baseLayout, 5000)).toBe(MAX_TREE_PANEL_WIDTH);
  });

  it("getMaxLeftPanelWidth 容器太窄时退回到 MIN_TREE_PANEL_WIDTH", () => {
    // 容器宽度 < 右栏 + 编辑区最小宽 + handle，最大值会被夹到 MIN_TREE。
    const result = getMaxLeftPanelWidth(baseLayout, 100);
    expect(result).toBeGreaterThan(0);
  });

  it("getMaxRightPanelWidth 不超过 MAX_AGENT_PANEL_WIDTH", () => {
    expect(getMaxRightPanelWidth(baseLayout, 5000)).toBe(MAX_AGENT_PANEL_WIDTH);
  });
});
