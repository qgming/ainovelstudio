import type { CanonDelta } from "./longformTypes";

export type CanonDeltaStatusPatchPlan = {
  characterStatePatch: unknown[];
  continuityIndexPatch: unknown[];
  latestPlotPatch: unknown[];
};

function appendOps(path: string, values: unknown[]) {
  return values.map((value) => ({
    op: "add" as const,
    path,
    value,
  }));
}

function replaceUpdatedAt(timestamp: string) {
  return {
    op: "replace" as const,
    path: "/updatedAt",
    value: timestamp,
  };
}

export function createEmptyCanonDelta(): CanonDelta {
  return {
    characterUpdates: [],
    continuityRisks: [],
    foreshadowingUpdates: [],
    plotUpdates: [],
    styleNotes: [],
    timelineUpdates: [],
  };
}

export function buildCanonDeltaStatusPatchPlan(
  delta: CanonDelta,
  timestamp = new Date().toISOString(),
): CanonDeltaStatusPatchPlan {
  return {
    characterStatePatch: [
      ...appendOps("/updates/-", delta.characterUpdates),
      replaceUpdatedAt(timestamp),
    ],
    continuityIndexPatch: [
      ...appendOps("/foreshadowing/-", delta.foreshadowingUpdates),
      ...appendOps("/continuityRisks/-", delta.continuityRisks),
      replaceUpdatedAt(timestamp),
    ],
    latestPlotPatch: [
      ...appendOps("/recentChapters/-", delta.plotUpdates),
      ...appendOps("/timelineUpdates/-", delta.timelineUpdates),
      replaceUpdatedAt(timestamp),
    ],
  };
}
