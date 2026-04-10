import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateWorkspaceDirectory,
  mockCreateWorkspaceTextFile,
  mockDeleteWorkspaceEntry,
  mockReadWorkspaceTextFile,
  mockReadWorkspaceTextLine,
  mockReadWorkspaceTree,
  mockRenameWorkspaceEntry,
  mockReplaceWorkspaceTextLine,
  mockSearchWorkspaceContent,
  mockWriteWorkspaceTextFile,
} = vi.hoisted(() => ({
  mockCreateWorkspaceDirectory: vi.fn(),
  mockCreateWorkspaceTextFile: vi.fn(),
  mockDeleteWorkspaceEntry: vi.fn(),
  mockReadWorkspaceTextFile: vi.fn(),
  mockReadWorkspaceTextLine: vi.fn(),
  mockReadWorkspaceTree: vi.fn(),
  mockRenameWorkspaceEntry: vi.fn(),
  mockReplaceWorkspaceTextLine: vi.fn(),
  mockSearchWorkspaceContent: vi.fn(),
  mockWriteWorkspaceTextFile: vi.fn(),
}));

vi.mock("../bookWorkspace/api", () => ({
  createWorkspaceDirectory: mockCreateWorkspaceDirectory,
  createWorkspaceTextFile: mockCreateWorkspaceTextFile,
  deleteWorkspaceEntry: mockDeleteWorkspaceEntry,
  readWorkspaceTextFile: mockReadWorkspaceTextFile,
  readWorkspaceTextLine: mockReadWorkspaceTextLine,
  readWorkspaceTree: mockReadWorkspaceTree,
  renameWorkspaceEntry: mockRenameWorkspaceEntry,
  replaceWorkspaceTextLine: mockReplaceWorkspaceTextLine,
  searchWorkspaceContent: mockSearchWorkspaceContent,
  writeWorkspaceTextFile: mockWriteWorkspaceTextFile,
}));

import { createWorkspaceToolset } from "./tools";

describe("createWorkspaceToolset", () => {
  beforeEach(() => {
    mockCreateWorkspaceDirectory.mockReset();
    mockCreateWorkspaceTextFile.mockReset();
    mockDeleteWorkspaceEntry.mockReset();
    mockReadWorkspaceTextFile.mockReset();
    mockReadWorkspaceTextLine.mockReset();
    mockReadWorkspaceTree.mockReset();
    mockRenameWorkspaceEntry.mockReset();
    mockReplaceWorkspaceTextLine.mockReset();
    mockSearchWorkspaceContent.mockReset();
    mockWriteWorkspaceTextFile.mockReset();
  });

  it("写入文件后会触发工作区刷新回调", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";

    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockWriteWorkspaceTextFile.mockResolvedValue(undefined);

    const result = await toolset.write_file.execute({
      path: "章节/第一章.md",
      contents: "新内容",
    });

    expect(mockWriteWorkspaceTextFile).toHaveBeenCalledWith(rootPath, "章节/第一章.md", "新内容");
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, summary: "已写入 章节/第一章.md" });
  });

  it("内容搜索会返回结构化命中结果", async () => {
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ rootPath });
    const matches = [
      {
        matchType: "directory_name",
        path: "设定/人物档案",
      },
      {
        matchType: "content",
        path: "章节/第一卷/第1章.md",
        lineNumber: 12,
        lineText: "主角在雪夜第一次听见钟声。",
      },
    ];
    mockSearchWorkspaceContent.mockResolvedValue(matches);

    const result = await toolset.search_workspace_content.execute({ query: "钟声", limit: 5 });

    expect(mockSearchWorkspaceContent).toHaveBeenCalledWith(rootPath, "钟声", 5);
    expect(result).toEqual({
      ok: true,
      summary: [
        "共找到 2 条与“钟声”相关的结果：",
        "- [文件夹] 设定/人物档案",
        "- [内容] 章节/第一卷/第1章.md:12 主角在雪夜第一次听见钟声。",
      ].join("\n"),
      data: matches,
    });
  });

  it("行编辑在替换时会更新指定行并触发刷新", async () => {
    const onWorkspaceMutated = vi.fn().mockResolvedValue(undefined);
    const rootPath = "C:/books/北境余烬";
    const toolset = createWorkspaceToolset({ onWorkspaceMutated, rootPath });
    mockReplaceWorkspaceTextLine.mockResolvedValue({
      lineNumber: 8,
      path: "章节/第一卷/第1章.md",
      text: "新的行内容",
    });

    const result = await toolset.line_edit.execute({
      action: "replace",
      contents: "新的行内容",
      lineNumber: 8,
      path: "章节/第一卷/第1章.md",
    });

    expect(mockReplaceWorkspaceTextLine).toHaveBeenCalledWith(
      rootPath,
      "章节/第一卷/第1章.md",
      8,
      "新的行内容",
    );
    expect(onWorkspaceMutated).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      summary: "已更新 章节/第一卷/第1章.md 第 8 行：新的行内容",
      data: {
        lineNumber: 8,
        path: "章节/第一卷/第1章.md",
        text: "新的行内容",
      },
    });
  });
});
