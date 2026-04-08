import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import { useBookWorkspaceStore } from "./bookWorkspaceStore";

const rootPath = "C:/books/北境余烬";
const chapterPath = `${rootPath}/章节/第一卷/第1章-开篇.md`;

const initialTree = {
  kind: "directory",
  name: "北境余烬",
  path: rootPath,
  children: [
    {
      kind: "directory",
      name: "章节",
      path: `${rootPath}/章节`,
      children: [
        {
          kind: "directory",
          name: "第一卷",
          path: `${rootPath}/章节/第一卷`,
          children: [
            {
              kind: "file",
              name: "第1章-开篇.md",
              path: chapterPath,
              extension: ".md",
            },
          ],
        },
      ],
    },
  ],
} as const;

describe("bookWorkspaceStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useBookWorkspaceStore.getState().resetState();
    mockInvoke.mockReset();
  });

  it("刷新工作区时会读取当前文件的最新内容", async () => {
    let readTextFileValue = "这是章节初稿";

    window.localStorage.setItem(
      "ainovelstudio-book-workspace",
      JSON.stringify({ rootPath, selectedFilePath: chapterPath }),
    );

    mockInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "read_workspace_tree":
          return initialTree;
        case "read_text_file":
          return readTextFileValue;
        default:
          return undefined;
      }
    });

    await useBookWorkspaceStore.getState().initializeWorkspace();

    expect(useBookWorkspaceStore.getState().draftContent).toBe("这是章节初稿");

    readTextFileValue = "这是 AI 改写后的内容";

    await useBookWorkspaceStore.getState().refreshWorkspace();

    expect(useBookWorkspaceStore.getState().draftContent).toBe("这是 AI 改写后的内容");
    expect(useBookWorkspaceStore.getState().activeFilePath).toBe(chapterPath);
  });
});
