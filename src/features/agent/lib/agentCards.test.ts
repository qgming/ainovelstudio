import { describe, expect, it } from "vitest";
import {
  applyAgentCardToolPolicy,
  getBuiltinAgentCard,
  resolveAgentCard,
} from "./agentCards";

describe("agent cards", () => {
  it("解析内置长篇模式卡片", () => {
    const card = getBuiltinAgentCard("chapter-write");

    expect(card?.name).toBe("章节生产");
    expect(card?.tools).toContain("canon_query");
    expect(card?.writeScopes).toContain(".project/status/");
    expect(card?.writeScopes).not.toContain(".project/runs/");
    expect(card?.allowedSubagents).toContain("连续性检查");
  });

  it("解析严格工作流 card", () => {
    const card = getBuiltinAgentCard("flow");

    expect(card?.name).toBe("严格工作流");
    expect(card?.contextPolicyId).toBe("flow");
    expect(card?.tools).toContain("mode_control");
    expect(card?.tools).toContain("json");
    expect(card?.writeScopes).toContain(".project/status/");
    expect(card?.writeScopes).not.toContain(".project/runs/");
  });

  it("解析 YOLO card", () => {
    const card = getBuiltinAgentCard("autopilot");

    expect(card?.name).toBe("YOLO 全自动目标");
    expect(card?.banTools).toEqual([]);
    expect(card?.contextPolicyId).toBe("autopilot");
    expect(card?.tools).toContain("mode_control");
    expect(card?.tools).toContain("create");
    expect(card?.tools).toContain("write");
  });

  it("支持用户覆盖内置 card 字段", () => {
    const card = resolveAgentCard("chapter-write", {
      name: "自定义章节生产",
      writeScopes: ["正文/"],
    });

    expect(card?.name).toBe("自定义章节生产");
    expect(card?.mode).toBe("chapter-write");
    expect(card?.writeScopes).toEqual(["正文/"]);
    expect(card?.tools).toContain("canon_query");
  });

  it("card 策略不再按模式过滤已启用工具", () => {
    const tools = applyAgentCardToolPolicy("style-polish", [
      "read",
      "edit",
      "write",
      "word_count",
      "canon_query",
    ]);

    expect(tools).toEqual(["read", "edit", "write", "word_count", "canon_query"]);
  });

  it("YOLO 工具策略保留全部已启用工具", () => {
    const tools = applyAgentCardToolPolicy("autopilot", [
      "ask",
      "todo",
      "mode_control",
      "read",
      "write",
      "json",
    ]);

    expect(tools).toEqual(["ask", "todo", "mode_control", "read", "write", "json"]);
  });
});
