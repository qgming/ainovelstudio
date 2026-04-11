import { describe, expect, it, vi } from "vitest";
import { createEmptyManualTurnContextSelection, resolveManualTurnContext } from "./manualTurnContext";

describe("manual turn context", () => {
  it("创建空选择状态", () => {
    expect(createEmptyManualTurnContextSelection()).toEqual({
      agentIds: [],
      filePaths: [],
      skillIds: [],
    });
  });

  it("解析手动选择的技能、子代理与文件内容", async () => {
    const readFile = vi.fn(async (_rootPath: string, path: string) => `FILE:${path}`);

    const result = await resolveManualTurnContext({
      activeFilePath: "章节/第一章.md",
      draftContent: "ACTIVE_DRAFT",
      enabledAgents: [
        {
          id: "writer-agent",
          name: "续写代理",
          description: "负责续写章节。",
          body: "",
          discoveredAt: 1,
          files: [],
          isBuiltin: true,
          rawMarkdown: "",
          role: "擅长续写与润色",
          sourceKind: "builtin-package",
          sourceLabel: "内置",
          suggestedTools: [],
          tags: [],
          validation: { errors: [], isValid: true, warnings: [] },
          enabled: true,
        },
      ],
      enabledSkills: [
        {
          id: "plot-skill",
          name: "剧情规划",
          description: "拆解章节冲突与节奏。",
          body: "",
          discoveredAt: 1,
          effectivePrompt: "",
          isBuiltin: true,
          rawMarkdown: "",
          references: [],
          sourceKind: "builtin-package",
          sourceLabel: "内置",
          suggestedTools: [],
          tags: [],
          validation: { errors: [], isValid: true, warnings: [] },
          enabled: true,
        },
      ],
      readFile,
      selection: {
        agentIds: ["writer-agent"],
        filePaths: ["章节/第一章.md", "设定/人物.md"],
        skillIds: ["plot-skill"],
      },
      workspaceRootPath: "C:/books/北境余烬",
    });

    expect(result.skills).toEqual([
      {
        description: "拆解章节冲突与节奏。",
        id: "plot-skill",
        name: "剧情规划",
      },
    ]);
    expect(result.agents).toEqual([
      {
        description: "负责续写章节。",
        id: "writer-agent",
        name: "续写代理",
        role: "擅长续写与润色",
      },
    ]);
    expect(result.files).toEqual([
      {
        content: "ACTIVE_DRAFT",
        name: "第一章.md",
        path: "章节/第一章.md",
      },
      {
        content: "FILE:设定/人物.md",
        name: "人物.md",
        path: "设定/人物.md",
      },
    ]);
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith("C:/books/北境余烬", "设定/人物.md");
  });
});
