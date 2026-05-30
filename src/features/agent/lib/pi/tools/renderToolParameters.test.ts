import { describe, expect, it } from "vitest";
import { Type } from "@earendil-works/pi-ai";
import { renderToolParameters } from "./renderToolParameters";
import { ALL_TOOL_SPECS } from "./schemas";

describe("renderToolParameters", () => {
  it("必填字段无 ?，可选字段有 ?", () => {
    const schema = Type.Object({
      path: Type.String({ description: "必填路径" }),
      anchor: Type.Optional(Type.String({ description: "可选锚点" })),
    });
    const lines = renderToolParameters(schema);
    expect(lines).toContain("  - path：必填路径");
    expect(lines).toContain("  - anchor?：可选锚点");
  });

  it("带 default 的字段渲染为可选（? 标记），与旧 zod isOptional 一致", () => {
    const schema = Type.Object({
      action: Type.Union([Type.Literal("a"), Type.Literal("b")], { default: "a", description: "动作" }),
    });
    const lines = renderToolParameters(schema);
    expect(lines).toEqual(["  - action?：动作"]);
  });

  it("workspace_read.mode（带 default）应渲染为 mode?", () => {
    const lines = renderToolParameters(ALL_TOOL_SPECS.workspace_read.parameters);
    const modeLine = lines.find((line) => line.startsWith("  - mode"));
    expect(modeLine?.startsWith("  - mode?：")).toBe(true);
    // path 必填，无 ?
    const pathLine = lines.find((line) => line.startsWith("  - path"));
    expect(pathLine?.startsWith("  - path：")).toBe(true);
  });

  it("workspace_write.action（带 default）应渲染为 action?", () => {
    const lines = renderToolParameters(ALL_TOOL_SPECS.workspace_write.parameters);
    expect(lines.some((line) => line.startsWith("  - action?："))).toBe(true);
  });

  it("数组元素的嵌套子字段也渲染（workspace_json.patch[].op）", () => {
    const lines = renderToolParameters(ALL_TOOL_SPECS.workspace_json.parameters);
    const joined = lines.join("\n");
    // patch 是可选数组；其元素 op 必填（无 default、无 optional）
    expect(joined).toContain("    - patch[].op：");
    expect(joined).toContain("    - patch[].from?：");
  });
});
