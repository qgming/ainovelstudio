import { describe, expect, it } from "vitest";
import {
  buildCanonDeltaStatusPatchPlan,
  createEmptyCanonDelta,
} from "./canonDelta";

describe("canon delta", () => {
  it("创建空 CanonDelta", () => {
    expect(createEmptyCanonDelta()).toEqual({
      characterUpdates: [],
      continuityRisks: [],
      foreshadowingUpdates: [],
      plotUpdates: [],
      styleNotes: [],
      timelineUpdates: [],
    });
  });

  it("把 CanonDelta 映射为 status JSON patch", () => {
    const patchPlan = buildCanonDeltaStatusPatchPlan(
      {
        characterUpdates: [{ name: "沈砚", state: "受伤" }],
        continuityRisks: [{ issue: "时间线冲突" }],
        foreshadowingUpdates: [{ hook: "黑钟" }],
        plotUpdates: [{ chapter: 1, summary: "主角逃出地牢" }],
        styleNotes: ["对话更短"],
        timelineUpdates: [{ at: "第一日夜", event: "逃离" }],
      },
      "2026-05-09T00:00:00.000Z",
    );

    expect(patchPlan.characterStatePatch).toEqual([
      {
        op: "add",
        path: "/updates/-",
        value: { name: "沈砚", state: "受伤" },
      },
      {
        op: "replace",
        path: "/updatedAt",
        value: "2026-05-09T00:00:00.000Z",
      },
    ]);
    expect(patchPlan.latestPlotPatch).toContainEqual({
      op: "add",
      path: "/recentChapters/-",
      value: { chapter: 1, summary: "主角逃出地牢" },
    });
    expect(patchPlan.continuityIndexPatch).toContainEqual({
      op: "add",
      path: "/continuityRisks/-",
      value: { issue: "时间线冲突" },
    });
  });
});
