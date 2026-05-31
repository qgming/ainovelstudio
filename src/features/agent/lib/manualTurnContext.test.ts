import { describe, expect, it, vi } from "vitest";
import { createEmptyManualTurnContextSelection, resolveManualTurnContext } from "./manualTurnContext";

describe("manual turn context", () => {
  it("创建空选择状态", () => {
    expect(createEmptyManualTurnContextSelection()).toEqual({
      filePaths: [],
      skillIds: [],
    });
  });

  it("解析手动选择的技能与文件路径，不读取文件内容", async () => {
    const readFile = vi.fn(async (_rootPath: string, path: string) => `FILE:${path}`);

    const result = await resolveManualTurnContext({
      activeFilePath: "章节/第一章.md",
      draftContent: "ACTIVE_DRAFT",
      enabledSkills: [
        {
          id: "plot-skill",
          name: "剧情规划",
          description: "拆解章节冲突与节奏。",
          body: "",
          discoveredAt: 1,
          effectivePrompt: "",
          rawMarkdown: "",
          isBuiltin: true,
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
        filePaths: ["章节/第一章.md", "设定/人物.md"],
        skillIds: ["plot-skill"],
      },
      workspaceBookId: "C:/books/北境余烬",
    });

    expect(result.skills).toEqual([
      {
        description: "拆解章节冲突与节奏。",
        id: "plot-skill",
        name: "剧情规划",
      },
    ]);
    expect(result.files).toEqual([
      {
        name: "第一章.md",
        path: "章节/第一章.md",
      },
      {
        name: "人物.md",
        path: "设定/人物.md",
      },
    ]);
    expect(readFile).not.toHaveBeenCalled();
  });
});
