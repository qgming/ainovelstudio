import { describe, expect, it } from "vitest";
import { getHeuristicReasoningSupport, getModelsDevReasoningSupport } from "./modelCapabilities";

describe("modelCapabilities", () => {
  it("按常见 reasoning 模型名推断支持思考", () => {
    expect(getHeuristicReasoningSupport("gpt-5.4")).toEqual({
      source: "heuristic",
      supported: true,
    });
    expect(getHeuristicReasoningSupport("openrouter/deepseek-r1")).toEqual({
      source: "heuristic",
      supported: true,
    });
  });

  it("按常见非 reasoning 模型名推断不支持思考", () => {
    expect(getHeuristicReasoningSupport("gpt-4.1")).toEqual({
      source: "heuristic",
      supported: false,
    });
  });

  it("测试环境不访问 models.dev，直接返回启发式结果", async () => {
    await expect(getModelsDevReasoningSupport("o4-mini")).resolves.toEqual({
      source: "heuristic",
      supported: true,
    });
  });
});
