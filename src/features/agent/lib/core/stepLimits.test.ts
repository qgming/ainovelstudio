import { describe, expect, it } from "vitest";
import { COLLAB_AGENT_STEP_LIMIT, resolveAgentStepLimit } from "./stepLimits";

describe("resolveAgentStepLimit", () => {
  it("协作模式使用 1000 次上限", () => {
    expect(resolveAgentStepLimit("book")).toBe(COLLAB_AGENT_STEP_LIMIT);
  });

  it("YOLO 模式使用无限上限", () => {
    expect(resolveAgentStepLimit("autopilot")).toBeNull();
  });
});
