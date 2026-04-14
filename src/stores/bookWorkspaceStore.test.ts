import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import { useBookWorkspaceStore } from "./bookWorkspaceStore";

const rootPath = "C:/books/北境余烬";
const bookId = "book-1";
const chapterPath = `${rootPath}/04_正文/第一卷/第001章_待命名.md`;
const otherRootPath = "C:/books/星河回声";
const otherBookId = "book-2";
const otherChapterPath = `${otherRootPath}/04_正文/第一卷/第001章_启程.md`;

const initialTree = {
  kind: "directory",
  name: "北境余烬",
  path: rootPath,
  children: [
    {
      kind: "directory",
      name: "04_正文",
      path: `${rootPath}/04_正文`,
      children: [
        {
          kind: "directory",
          name: "第一卷",
          path: `${rootPath}/04_正文/第一卷`,
          children: [
            {
              kind: "file",
              name: "第001章_待命名.md",
              path: chapterPath,
              extension: ".md",
            },
          ],
        },
      ],
    },
  ],
} as const;

const otherTree = {
  kind: "directory",
  name: "星河回声",
  path: otherRootPath,
  children: [
    {
      kind: "directory",
      name: "04_正文",
      path: `${otherRootPath}/04_正文`,
      children: [
        {
          kind: "directory",
          name: "第一卷",
          path: `${otherRootPath}/04_正文/第一卷`,
          children: [
            {
              kind: "file",
              name: "第001章_启程.md",
              path: otherChapterPath,
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
        case "get_book_workspace_summary":
          return { id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 };
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

  it("按 bookId 打开书籍时会保留该书的身份，不会再回退到 path summary", async () => {
    mockInvoke.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      switch (command) {
        case "get_book_workspace_summary_by_id":
          return { id: otherBookId, name: "星河回声", path: otherRootPath, updatedAt: 1710000001 };
        case "get_book_workspace_summary":
          return { id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 };
        case "read_workspace_tree":
          return payload?.rootPath === otherRootPath ? otherTree : initialTree;
        case "read_text_file":
          return "这是另一部书的正文";
        default:
          return undefined;
      }
    });

    await useBookWorkspaceStore.getState().selectWorkspaceByBookId(otherBookId);

    expect(useBookWorkspaceStore.getState().rootBookId).toBe(otherBookId);
    expect(useBookWorkspaceStore.getState().rootBookName).toBe("星河回声");
    expect(useBookWorkspaceStore.getState().rootPath).toBe(otherRootPath);
    expect(mockInvoke).not.toHaveBeenCalledWith("get_book_workspace_summary", {
      rootPath: otherRootPath,
    });
  });
});
