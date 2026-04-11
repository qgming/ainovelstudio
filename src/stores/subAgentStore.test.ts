import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/agents/api", () => ({
  clearAgentPreferences: vi.fn().mockResolvedValue(undefined),
  createAgent: vi.fn(),
  deleteInstalledAgent: vi.fn(),
  importAgentZip: vi.fn(),
  initializeBuiltinAgents: vi.fn(),
  pickAgentArchive: vi.fn(),
  readAgentPreferences: vi.fn().mockResolvedValue({ enabledById: {} }),
  scanInstalledAgents: vi.fn(),
  writeAgentPreferences: vi.fn().mockResolvedValue({ enabledById: {} }),
}));

import { clearAgentPreferences, writeAgentPreferences } from "../lib/agents/api";
import { getResolvedAgents, useSubAgentStore } from "./subAgentStore";

describe("subAgentStore", () => {
  beforeEach(async () => {
    vi.mocked(clearAgentPreferences).mockClear();
    vi.mocked(writeAgentPreferences).mockClear();
    vi.mocked(writeAgentPreferences).mockResolvedValue({ enabledById: {} });
    useSubAgentStore.setState({
      errorMessage: null,
      lastScannedAt: null,
      manifests: [
        {
          id: "editor",
          name: "编辑",
          description: "审查叙事节奏与章节衔接",
          body: "编辑代理",
          defaultEnabled: true,
          discoveredAt: 1,
          isBuiltin: false,
          rawMarkdown: "# 编辑",
          sourceKind: "installed-package",
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
          defaultEnabled: true,
          discoveredAt: 1,
          isBuiltin: false,
          rawMarkdown: "# 写作",
          sourceKind: "installed-package",
          suggestedTools: [],
          tags: ["writing"],
          validation: { errors: [], isValid: true, warnings: [] },
          role: "writer",
          dispatchHint: "当用户需要创作时使用",
        },
      ],
      preferences: { enabledById: {} },
      status: "ready",
    });
    await useSubAgentStore.getState().reset();
    useSubAgentStore.setState((state) => ({ ...state, manifests: [
      {
        id: "editor",
        name: "编辑",
        description: "审查叙事节奏与章节衔接",
        body: "编辑代理",
        defaultEnabled: true,
        discoveredAt: 1,
        isBuiltin: false,
        rawMarkdown: "# 编辑",
        sourceKind: "installed-package",
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
        defaultEnabled: true,
        discoveredAt: 1,
        isBuiltin: false,
        rawMarkdown: "# 写作",
        sourceKind: "installed-package",
        suggestedTools: [],
        tags: ["writing"],
        validation: { errors: [], isValid: true, warnings: [] },
        role: "writer",
        dispatchHint: "当用户需要创作时使用",
      },
    ], status: "ready" }));
  });

  it("包含 2 个代理 manifest", () => {
    const { manifests } = useSubAgentStore.getState();
    expect(manifests).toHaveLength(2);
    expect(manifests.map((a) => a.id)).toEqual(["editor", "writer"]);
  });

  it("默认启用来自内置默认清单的代理", () => {
    const resolved = getResolvedAgents(useSubAgentStore.getState());
    expect(resolved.find((a) => a.id === "editor")?.enabled).toBe(true);
    expect(resolved.find((a) => a.id === "writer")?.enabled).toBe(true);
  });

  it("toggleAgent 切换启用状态并写入 SQLite", async () => {
    await useSubAgentStore.getState().toggleAgent("writer");
    expect(vi.mocked(writeAgentPreferences)).toHaveBeenCalledWith({
      enabledById: { writer: false },
    });
    expect(useSubAgentStore.getState().preferences.enabledById.writer).toBe(false);

    await useSubAgentStore.getState().toggleAgent("writer");
    expect(useSubAgentStore.getState().preferences.enabledById.writer).toBe(true);
  });

  it("reset 清空偏好后回到默认启用策略", async () => {
    useSubAgentStore.setState({ preferences: { enabledById: { writer: false } } });

    await useSubAgentStore.getState().reset();

    expect(vi.mocked(clearAgentPreferences)).toHaveBeenCalled();
    expect(getResolvedAgents(useSubAgentStore.getState()).find((a) => a.id === "writer")?.enabled).toBe(true);
  });
});
