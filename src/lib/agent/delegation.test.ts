import { describe, expect, it } from "vitest";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import { selectSubAgentForPrompt } from "./delegation";

function createAgent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    id: "plot-agent",
    name: "剧情代理",
    description: "负责剧情推进与人物动机分析",
    role: "剧情",
    tags: ["剧情", "动机"],
    sourceLabel: "内置",
    body: "专注处理剧情与人物动机。",
    toolsPreview: "可读取章节文件",
    memoryPreview: "记住当前故事走向",
    suggestedTools: ["read_file"],
    enabled: true,
    files: ["manifest.json", "AGENTS.md", "TOOLS.md", "MEMORY.md"],
    sourceKind: "builtin-package",
    dispatchHint: "当用户询问剧情推进时",
    validation: { errors: [], isValid: true, warnings: [] },
    discoveredAt: Date.now(),
    isBuiltin: true,
    manifestFilePath: "agents/plot-agent/manifest.json",
    maxTurns: 5,
    ...overrides,
  };
}

describe("subagent delegation", () => {
  it("普通请求默认不委派子代理", () => {
    const agent = createAgent();

    expect(selectSubAgentForPrompt("继续写这一章", [agent])).toBeNull();
  });

  it("命中专项任务和标签时委派子代理", () => {
    const agent = createAgent();

    expect(selectSubAgentForPrompt("帮我分析主角动机", [agent])?.id).toBe(agent.id);
  });

  it("用户明确要求代理介入时委派子代理", () => {
    const agent = createAgent();

    expect(selectSubAgentForPrompt("请让剧情代理帮我拆解这一章的冲突", [agent])?.id).toBe(agent.id);
  });
});
