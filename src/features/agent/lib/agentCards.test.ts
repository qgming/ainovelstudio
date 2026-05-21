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
    expect(card?.tools).toContain("workspace_search");
    expect(card?.writeScopes).toContain(".project/status/");
    expect(card?.writeScopes).not.toContain(".project/runs/");
  });

  it("解析 YOLO card", () => {
    const card = getBuiltinAgentCard("autopilot");

    expect(card?.name).toBe("YOLO 全自动目标");
    expect(card?.banTools).toEqual([]);
    expect(card?.contextPolicyId).toBe("autopilot");
    expect(card?.tools).toContain("yolo_control");
    expect(card?.tools).toContain("workspace_write");
    expect(card?.tools).toContain("workspace_write");
  });

  it("支持用户覆盖内置 card 字段", () => {
    const card = resolveAgentCard("chapter-write", {
      name: "自定义章节生产",
      writeScopes: ["正文/"],
    });

    expect(card?.name).toBe("自定义章节生产");
    expect(card?.mode).toBe("chapter-write");
    expect(card?.writeScopes).toEqual(["正文/"]);
    expect(card?.tools).toContain("workspace_search");
  });

  it("card 策略不再按模式过滤已启用工具", () => {
    const tools = applyAgentCardToolPolicy("style-polish", [
      "workspace_read",
      "workspace_edit",
      "workspace_write",
      "text_stats",
    ]);

    expect(tools).toEqual(["workspace_read", "workspace_edit", "workspace_write", "text_stats"]);
  });

  it("YOLO 工具策略保留全部已启用工具", () => {
    const tools = applyAgentCardToolPolicy("autopilot", [
      "ask_user",
      "update_plan",
      "yolo_control",
      "workspace_read",
      "workspace_write",
      "workspace_json",
    ]);

    expect(tools).toEqual(["ask_user", "update_plan", "yolo_control", "workspace_read", "workspace_write", "workspace_json"]);
  });
});
