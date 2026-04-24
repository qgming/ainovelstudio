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
    expect(result.summary).toContain("已批量写入 1 个章节结构");
  });
});
