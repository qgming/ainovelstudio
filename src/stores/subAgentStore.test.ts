import { beforeEach, describe, expect, it } from "vitest";
import { getResolvedAgents, useSubAgentStore } from "./subAgentStore";

describe("subAgentStore", () => {
  beforeEach(() => {
    useSubAgentStore.setState({
      errorMessage: null,
      lastScannedAt: null,
      manifests: [
        {
          id: "editor",
          name: "编辑",
          description: "审查叙事节奏与章节衔接",
          body: "编辑代理",
          discoveredAt: 1,
          isBuiltin: true,
          rawMarkdown: "# 编辑",
          sourceKind: "builtin-package",
          suggestedTools: [],
          tags: ["edit"],
          validation: { errors: [], isValid: true, warnings: [] },
          role: "editor",
          dispatchHint: "当用户需要审稿时使用",
        },
        {
          id: "writer",
          name: "写作",
          description: "负责正文创作",
          body: "写作代理",
          discoveredAt: 1,
          isBuiltin: true,
          rawMarkdown: "# 写作",
          sourceKind: "builtin-package",
          suggestedTools: [],
          tags: ["writing"],
          validation: { errors: [], isValid: true, warnings: [] },
          role: "writer",
          dispatchHint: "当用户需要创作时使用",
        },
      ],
      preferences: {
        enabledById: {
          editor: true,
          writer: false,
        },
      },
      status: "ready",
    });
  });

  it("包含 2 个代理 manifest", () => {
    const { manifests } = useSubAgentStore.getState();
    expect(manifests).toHaveLength(2);
    expect(manifests.map((a) => a.id)).toEqual(["editor", "writer"]);
  });

  it("根据 preferences 解析启用状态", () => {
    const resolved = getResolvedAgents(useSubAgentStore.getState());
    expect(resolved.find((a) => a.id === "editor")?.enabled).toBe(true);
    expect(resolved.find((a) => a.id === "writer")?.enabled).toBe(false);
  });

  it("toggleAgent 切换启用状态", () => {
    useSubAgentStore.getState().toggleAgent("writer");
    expect(useSubAgentStore.getState().preferences.enabledById.writer).toBe(true);

    useSubAgentStore.getState().toggleAgent("writer");
    expect(useSubAgentStore.getState().preferences.enabledById.writer).toBe(false);
  });

  it("sourceKind 为 builtin-package", () => {
    const { manifests } = useSubAgentStore.getState();
    expect(manifests.every((a) => a.sourceKind === "builtin-package")).toBe(true);
  });
});
