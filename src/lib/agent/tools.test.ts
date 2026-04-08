import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateWorkspaceDirectory, mockCreateWorkspaceTextFile, mockDeleteWorkspaceEntry, mockReadWorkspaceTextFile, mockReadWorkspaceTree, mockRenameWorkspaceEntry, mockWriteWorkspaceTextFile } = vi.hoisted(() => ({
  mockCreateWorkspaceDirectory: vi.fn(),
  mockCreateWorkspaceTextFile: vi.fn(),
  mockDeleteWorkspaceEntry: vi.fn(),
  mockReadWorkspaceTextFile: vi.fn(),
  mockReadWorkspaceTree: vi.fn(),
  mockRenameWorkspaceEntry: vi.fn(),
  mockWriteWorkspaceTextFile: vi.fn(),
}));

vi.mock("../bookWorkspace/api", () => ({
  createWorkspaceDirectory: mockCreateWorkspaceDirectory,
  createWorkspaceTextFile: mockCreateWorkspaceTextFile,
  deleteWorkspaceEntry: mockDeleteWorkspaceEntry,
  readWorkspaceTextFile: mockReadWorkspaceTextFile,
  readWorkspaceTree: mockReadWorkspaceTree,
  renameWorkspaceEntry: mockRenameWorkspaceEntry,
  writeWorkspaceTextFile: mockWriteWorkspaceTextFile,
}));

import { createWorkspaceToolset } from "./tools";

describe("createWorkspaceToolset", () => {
  beforeEach(() => {
    mockCreateWorkspaceDirectory.mockReset();
    mockCreateWorkspaceTextFile.mockReset();
    mockDeleteWorkspaceEntry.mockReset();
    mockReadWorkspaceTextFile.mockReset();
    mockReadWorkspaceTree.mockReset();
    mockRenameWorkspaceEntry.mockReset();
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
});
