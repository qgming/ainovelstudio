import { describe, expect, it } from "vitest";
import {
  BUILTIN_AGENT_CARDS,
  getBuiltinAgentCard,
  resolveAgentCard,
} from "./agentCards";

describe("agent cards", () => {
  it("内置卡片只保留目标模式", () => {
    expect(BUILTIN_AGENT_CARDS).toHaveLength(1);
    expect(BUILTIN_AGENT_CARDS[0]?.id).toBe("goal");
  });

  it("已废弃的长篇模式不再解析到内置卡片", () => {
    expect(getBuiltinAgentCard("chapter-write")).toBeNull();
    expect(getBuiltinAgentCard("book-design")).toBeNull();
    expect(getBuiltinAgentCard("style-polish")).toBeNull();
  });

  it("解析目标模式 card", () => {
    const card = getBuiltinAgentCard("goal");

    expect(card?.name).toBe("目标模式");
    expect(card?.banTools).toEqual([]);
    expect(card?.contextPolicyId).toBe("goal");
    expect(card?.tools).toContain("goal_control");
    expect(card?.tools).toContain("workspace_write");
  });

  it("resolveAgentCard 对未知模式可使用 override 兜底", () => {
    const card = resolveAgentCard("unknown-mode", {
      name: "自定义模式",
      writeScopes: ["正文/"],
    });

    expect(card?.name).toBe("自定义模式");
    expect(card?.writeScopes).toEqual(["正文/"]);
  });

  it("resolveAgentCard 在目标模式 + override 时合并字段", () => {
    const card = resolveAgentCard("goal", {
      name: "目标 Pro",
    });

    expect(card?.name).toBe("目标 Pro");
    expect(card?.mode).toBe("goal");
    expect(card?.tools).toContain("goal_control");
  });
});
