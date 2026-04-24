import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExpansionSemanticToolset } from "./semanticToolset";

const apiMocks = vi.hoisted(() => ({
  createExpansionEntry: vi.fn(),
  getExpansionWorkspaceDetail: vi.fn(),
  readExpansionEntry: vi.fn(),
  writeExpansionEntry: vi.fn(),
}));

vi.mock("./api", () => apiMocks);

describe("createExpansionSemanticToolset", () => {
  beforeEach(() => {
    apiMocks.createExpansionEntry.mockReset();
    apiMocks.getExpansionWorkspaceDetail.mockReset();
    apiMocks.readExpansionEntry.mockReset();
    apiMocks.writeExpansionEntry.mockReset();
  });

  it("批量生成新章节时不会按草稿顺序复用已有 id", async () => {
    apiMocks.getExpansionWorkspaceDetail.mockResolvedValue({
      id: "workspace-1",
      name: "测试项目",
      updatedAt: 1710000000,
      projectEntries: [
        { section: "project", path: "outline.md", name: "outline.md", updatedAt: 1710000000 },
      ],
      settingEntries: [],
      chapterEntries: [
        { section: "chapters", path: "001/旧章节", name: "旧章节", entryId: "1", updatedAt: 1710000000 },
      ],
    });
    apiMocks.createExpansionEntry.mockResolvedValue({
      section: "chapters",
      path: "001/新章节",
      name: "新章节",
      entryId: "2",
      updatedAt: 1710000001,
    });

    const tools = createExpansionSemanticToolset({ workspaceId: "workspace-1" });
    const result = await tools.expansion_chapter_batch_outline.execute({
      chapters: [{ name: "新章节", outline: "细纲" }],
      volumeId: "001",
    });

    expect(apiMocks.createExpansionEntry).toHaveBeenCalledWith(
      "workspace-1",
      "chapters",
      "新章节",
      "001",
    );
    expect(apiMocks.writeExpansionEntry).toHaveBeenCalledTimes(1);
    expect(apiMocks.writeExpansionEntry).toHaveBeenCalledWith(
      "workspace-1",
      "chapters",
      "001/新章节",
      expect.stringContaining('"id": "2"'),
    );
    expect(apiMocks.writeExpansionEntry.mock.calls[0]?.[3]).not.toContain("notes");
    expect(apiMocks.writeExpansionEntry.mock.calls[0]?.[3]).not.toContain("linkedSettingIds");
    expect(result.summary).toContain("已批量写入 1 个章节结构");
  });

  it("未显式传入章节草稿时会生成 Markdown 细纲占位内容", async () => {
    apiMocks.getExpansionWorkspaceDetail.mockResolvedValue({
      id: "workspace-1",
      name: "测试项目",
      updatedAt: 1710000000,
      projectEntries: [
        { section: "project", path: "outline.md", name: "outline.md", updatedAt: 1710000000 },
      ],
      settingEntries: [],
      chapterEntries: [],
    });
    apiMocks.readExpansionEntry.mockResolvedValue("# 大纲\n\n## 第一章 初入异界\n");
    apiMocks.createExpansionEntry.mockResolvedValue({
      section: "chapters",
      path: "001/第一章 初入异界",
      name: "第一章 初入异界",
      entryId: "1",
      updatedAt: 1710000001,
    });

    const tools = createExpansionSemanticToolset({ workspaceId: "workspace-1" });
    await tools.expansion_chapter_batch_outline.execute({});

    expect(apiMocks.writeExpansionEntry.mock.calls[0]?.[3]).toContain('"outline": "## 情节点');
  });

  it("章节正文写入只更新 content 时会保留现有 outline", async () => {
    apiMocks.getExpansionWorkspaceDetail.mockResolvedValue({
      id: "workspace-1",
      name: "测试项目",
      updatedAt: 1710000000,
      projectEntries: [],
      settingEntries: [],
      chapterEntries: [
        { section: "chapters", path: "001/第一章", name: "第一章", entryId: "1", updatedAt: 1710000000 },
      ],
    });
    apiMocks.readExpansionEntry.mockResolvedValue(
      `${JSON.stringify({
        id: "1",
        name: "第一章",
        outline: "## 情节点\n\n- 旧细纲",
        content: "旧正文",
      }, null, 2)}\n`,
    );

    const tools = createExpansionSemanticToolset({ workspaceId: "workspace-1" });
    const result = await tools.expansion_chapter_write_content.execute({
      chapterId: "1",
      content: "新正文",
    });

    expect(apiMocks.writeExpansionEntry).toHaveBeenCalledWith(
      "workspace-1",
      "chapters",
      "001/第一章",
      expect.stringContaining('"outline": "## 情节点\\n\\n- 旧细纲"'),
    );
    expect(apiMocks.writeExpansionEntry.mock.calls[0]?.[3]).toContain('"content": "新正文"');
    expect(result.data).toEqual({
      chapterPath: "001/第一章",
      updatedFields: ["content"],
    });
  });

  it("章节字段写入支持按属性追加 Markdown 内容", async () => {
    apiMocks.getExpansionWorkspaceDetail.mockResolvedValue({
      id: "workspace-1",
      name: "测试项目",
      updatedAt: 1710000000,
      projectEntries: [],
      settingEntries: [],
      chapterEntries: [
        { section: "chapters", path: "001/第一章", name: "第一章", entryId: "1", updatedAt: 1710000000 },
      ],
    });
    apiMocks.readExpansionEntry.mockResolvedValue(
      `${JSON.stringify({
        id: "1",
        name: "第一章",
        outline: "## 情节点\n\n- 旧细纲",
        content: "第一段正文",
      }, null, 2)}\n`,
    );

    const tools = createExpansionSemanticToolset({ workspaceId: "workspace-1" });
    await tools.expansion_chapter_write_content.execute({
      chapterPath: "001/第一章",
      updates: [
        {
          field: "content",
          mode: "append",
          value: "第二段正文",
        },
      ],
    });

    expect(apiMocks.writeExpansionEntry.mock.calls[0]?.[3]).toContain(
      '"content": "第一段正文\\n\\n第二段正文"',
    );
    expect(apiMocks.writeExpansionEntry.mock.calls[0]?.[3]).toContain(
      '"outline": "## 情节点\\n\\n- 旧细纲"',
    );
  });
});
