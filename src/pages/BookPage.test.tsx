import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/bookWorkspace/types";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import { BookPage } from "./BookPage";
import { useBookWorkspaceStore } from "../stores/bookWorkspaceStore";

const bookId = "book-1";
const rootPath = "C:/books/北境余烬";
const otherBookId = "book-2";
const otherRootPath = "C:/books/星河回声";
const chapterPath = `${rootPath}/正文/第一卷/第001章_待命名.md`;
const secondVolumePath = `${rootPath}/正文/第二卷/第002章_并行线.md`;
const trackerPath = `${rootPath}/正文/创作状态追踪器.json`;
const otherChapterPath = `${otherRootPath}/正文/第一卷/第001章_启程.md`;
const tree = {
  kind: "directory",
  name: "北境余烬",
  path: rootPath,
  children: [
    {
      kind: "directory",
      name: "正文",
      path: `${rootPath}/正文`,
      children: [
        {
          kind: "directory",
          name: "第一卷",
          path: `${rootPath}/正文/第一卷`,
          children: [
            {
              kind: "file",
              name: "第001章_待命名.md",
              path: chapterPath,
              extension: ".md",
            },
          ],
        },
        {
          kind: "directory",
          name: "第二卷",
          path: `${rootPath}/正文/第二卷`,
          children: [
            {
              kind: "file",
              name: "第002章_并行线.md",
              path: secondVolumePath,
              extension: ".md",
            },
          ],
        },
        {
          kind: "file",
          name: "创作状态追踪器.json",
          path: trackerPath,
          extension: ".json",
        },
      ],
    },
    {
      kind: "file",
      name: "05-完整大纲.md",
      path: `${rootPath}/05-完整大纲.md`,
      extension: ".md",
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
      name: "正文",
      path: `${otherRootPath}/正文`,
      children: [
        {
          kind: "directory",
          name: "第一卷",
          path: `${otherRootPath}/正文/第一卷`,
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

function setupInvokeMock() {
  mockInvoke.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
    switch (command) {
      case "list_book_workspaces":
        return [{ id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 }];
      case "get_book_workspace_summary":
        if (payload?.rootPath === otherRootPath) {
          return { id: otherBookId, name: "星河回声", path: otherRootPath, updatedAt: 1710000001 };
        }
        return { id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 };
      case "get_book_workspace_summary_by_id":
        if (payload?.bookId === otherBookId) {
          return { id: otherBookId, name: "星河回声", path: otherRootPath, updatedAt: 1710000001 };
        }
        return { id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 };
      case "read_workspace_tree":
        return payload?.rootPath === otherRootPath ? otherTree : tree;
      case "read_text_file":
        if (payload?.path === trackerPath) {
          return '{"currentChapter":"第001章"}';
        }
        if (payload?.path === otherChapterPath) {
          return "这是另一部书的正文";
        }
        return "这是章节初稿";
      case "write_text_file":
        return undefined;
      case "create_book_workspace":
        return { id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 };
      default:
        return undefined;
    }
  });
}

describe("BookPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useBookWorkspaceStore.getState().resetState();
    mockInvoke.mockReset();
    setupInvokeMock();
  });

  it("未打开书籍时显示选择和新建按钮", () => {
    render(<BookPage />);

    expect(screen.getByRole("button", { name: "选择书籍" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建书籍" })).toBeInTheDocument();
  });

  it("选择书籍后显示三栏中的文件树和 Agent 工作台", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "书籍文件树" })).toBeInTheDocument();
    expect(screen.getByText("第一卷")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent" })).toBeInTheDocument();
    expect(screen.queryByText("支持消息流、工具调用、子代理和深度思考展示")).not.toBeInTheDocument();
  });

  it("点击文本文件后会自动保存编辑内容", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));
    fireEvent.click(await screen.findByRole("button", { name: "第一卷" }));
    fireEvent.click(await screen.findByRole("button", { name: "第001章_待命名.md" }));

    expect(await screen.findByRole("textbox", { name: "文件编辑器" })).toHaveValue("这是章节初稿");

    fireEvent.change(screen.getByRole("textbox", { name: "文件编辑器" }), {
      target: { value: "这是章节终稿" },
    });

    await waitFor(
      () => {
        expect(mockInvoke).toHaveBeenCalledWith("write_text_file", {
          contents: "这是章节终稿",
          path: chapterPath,
          rootPath,
        });
      },
      { timeout: 2000 },
    );
  });

  it("可以打开并编辑 json 文件", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));
    fireEvent.click(await screen.findByRole("button", { name: "创作状态追踪器.json" }));

    expect(await screen.findByRole("textbox", { name: "文件编辑器" })).toHaveValue(
      '{"currentChapter":"第001章"}',
    );

    fireEvent.change(screen.getByRole("textbox", { name: "文件编辑器" }), {
      target: { value: '{"currentChapter":"第002章"}' },
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("write_text_file", {
        contents: '{"currentChapter":"第002章"}',
        path: trackerPath,
        rootPath,
      });
    });
  });

  it("打开文件时不会收起同级已展开的文件夹", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));
    fireEvent.click(await screen.findByRole("button", { name: "第一卷" }));
    fireEvent.click(screen.getByRole("button", { name: "第二卷" }));

    expect(await screen.findByText("第002章_并行线.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "第001章_待命名.md" }));

    expect(await screen.findByRole("textbox", { name: "文件编辑器" })).toHaveValue("这是章节初稿");
    expect(screen.getByText("第002章_并行线.md")).toBeInTheDocument();
  });

  it("文件树节点通过更多菜单收纳目录与文件操作", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));
    fireEvent.click(await screen.findByRole("button", { name: "第一卷" }));

    fireEvent.click(screen.getByRole("button", { name: "第一卷 更多操作" }));

    expect(screen.getByRole("menuitem", { name: "新建文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建文件" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "第001章_待命名.md 更多操作" }));

    expect(screen.queryByRole("menuitem", { name: "新建文件夹" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "新建文件" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });

  it("支持刷新当前书籍以及单按钮切换全部展开和全部收起", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));

    expect(await screen.findByText("第一卷")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开全部文件夹" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开全部文件夹" }));
    expect(screen.getByRole("button", { name: "折叠全部文件夹" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "折叠全部文件夹" }));
    expect(screen.queryByText("第一卷")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开全部文件夹" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "刷新当前书籍" }));

    await waitFor(() => {
      const readTreeCalls = mockInvoke.mock.calls.filter(([command]) => command === "read_workspace_tree");
      expect(readTreeCalls).toHaveLength(2);
    });

    expect(await screen.findByText("第一卷")).toBeInTheDocument();
  });

  it("编辑区顶部保存按钮使用纯图标工具栏样式", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));
    fireEvent.click(await screen.findByRole("button", { name: "第一卷" }));
    fireEvent.click(await screen.findByRole("button", { name: "第001章_待命名.md" }));

    const saveButton = await screen.findByRole("button", { name: "保存当前文件" });
    expect(saveButton).toHaveTextContent("");
    expect(saveButton.className).toContain("h-8");
    expect(saveButton.className).toContain("w-8");
    expect(saveButton.className).toContain("rounded-[8px]");
    expect(saveButton.className).toContain("hover:bg-[#edf1f6]");
  });

  it("markdown 文件可切换到预览渲染视图", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));
    fireEvent.click(await screen.findByRole("button", { name: "第一卷" }));
    fireEvent.click(await screen.findByRole("button", { name: "第001章_待命名.md" }));

    fireEvent.change(await screen.findByRole("textbox", { name: "文件编辑器" }), {
      target: { value: "# 开篇\n\n- 第一幕" },
    });

    fireEvent.click(screen.getByRole("button", { name: "切换到 Markdown 预览" }));

    expect(screen.queryByRole("textbox", { name: "文件编辑器" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "开篇" })).toBeInTheDocument();
    expect(screen.getByText("第一幕").tagName).toBe("LI");
  });

  it("已打开书籍后左上角改为返回首页按钮，不再打开书籍菜单", async () => {
    const handleNavigateHome = vi.fn();
    render(<BookPage onNavigateHome={handleNavigateHome} />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开书籍菜单" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "返回首页" }));

    expect(handleNavigateHome).toHaveBeenCalledTimes(1);
  });

  it("已打开书籍后左上角仍显示书名，但不再提供顶部新建书籍菜单", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回首页" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开书籍菜单" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "新建书籍" })).not.toBeInTheDocument();
  });

  it("新建书籍时会弹出输入框并调用创建命令", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "新建书籍" }));
    fireEvent.change(screen.getByLabelText("书名"), { target: { value: "北境余烬" } });
    fireEvent.click(screen.getByRole("button", { name: "创建书籍" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_book_workspace", {
        bookName: "北境余烬",
        parentPath: "",
      });
    });
  });

  it("启动时会恢复上次打开的书籍和文件", async () => {
    window.localStorage.setItem(
      "ainovelstudio-book-workspace",
      JSON.stringify({ rootPath, selectedFilePath: chapterPath }),
    );

    render(<BookPage />);

    expect(await screen.findByRole("textbox", { name: "文件编辑器" })).toHaveValue("这是章节初稿");
    expect(screen.getByRole("heading", { name: "第001章_待命名.md" })).toBeInTheDocument();
  });

  it("会恢复本地保存的三栏宽度", async () => {
    window.localStorage.setItem(
      "ainovelstudio-book-layout",
      JSON.stringify({ leftPanelWidth: 360, rightPanelWidth: 410 }),
    );

    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();
    expect(screen.getByText("北境余烬").closest("aside")).toHaveStyle({ width: "360px" });
    expect(screen.getByRole("heading", { name: "Agent" }).closest("aside")).toHaveStyle({
      width: "410px",
    });
  });

  it("拖拽分隔条后会调整宽度并持久化到本地", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();

    const panels = screen.getByTestId("book-workspace-panels");
    Object.defineProperty(panels, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 800,
        height: 800,
        left: 0,
        right: 1200,
        top: 0,
        width: 1200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerDown(screen.getByRole("separator", { name: "调整目录栏宽度" }), {
      clientX: 310,
    });
    fireEvent.pointerMove(window, { clientX: 390 });
    fireEvent.pointerUp(window);

    await waitFor(() => {
      expect(screen.getByText("北境余烬").closest("aside")).toHaveStyle({ width: "390px" });
      expect(JSON.parse(window.localStorage.getItem("ainovelstudio-book-layout") ?? "null")).toEqual({
        lastExpandedLeftPanelWidth: 390,
        lastExpandedRightPanelWidth: 320,
        leftCollapsed: false,
        leftPanelWidth: 390,
        rightCollapsed: false,
        rightPanelWidth: 320,
      });
    });
  });

  it("目录栏拖到折叠阈值后会收起成贴边按钮并记住上次展开宽度", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();

    const panels = screen.getByTestId("book-workspace-panels");
    Object.defineProperty(panels, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        bottom: 800,
        height: 800,
        left: 0,
        right: 1200,
        top: 0,
        width: 1200,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.pointerDown(screen.getByRole("separator", { name: "调整目录栏宽度" }), {
      clientX: 310,
    });
    fireEvent.pointerMove(window, { clientX: 140 });
    fireEvent.pointerUp(window);

    await waitFor(() => {
      expect(screen.queryByText("北境余烬")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "展开目录栏" })).toBeInTheDocument();
      expect(JSON.parse(window.localStorage.getItem("ainovelstudio-book-layout") ?? "null")).toEqual({
        lastExpandedLeftPanelWidth: 310,
        lastExpandedRightPanelWidth: 320,
        leftCollapsed: true,
        leftPanelWidth: 310,
        rightCollapsed: false,
        rightPanelWidth: 320,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "展开目录栏" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();
    expect(screen.getByText("北境余烬").closest("aside")).toHaveStyle({ width: "310px" });
  });

  it("启动时会恢复已折叠的 Agent 栏，并可点击贴边按钮展开", async () => {
    window.localStorage.setItem(
      "ainovelstudio-book-layout",
      JSON.stringify({
        lastExpandedLeftPanelWidth: 310,
        lastExpandedRightPanelWidth: 430,
        leftCollapsed: false,
        leftPanelWidth: 310,
        rightCollapsed: true,
        rightPanelWidth: 430,
      }),
    );

    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "北境余烬" }));

    expect(await screen.findByRole("button", { name: "展开 Agent 栏" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Agent" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开 Agent 栏" }));

    expect(await screen.findByRole("heading", { name: "Agent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent" }).closest("aside")).toHaveStyle({
      width: "430px",
    });
  });

  it("按请求的 bookId 打开时，不会先把路由回写成旧书", async () => {
    useBookWorkspaceStore.setState({
      rootBookId: bookId,
      rootBookName: "北境余烬",
      rootNode: tree as unknown as TreeNode,
      rootPath,
    });
    const handleWorkspaceBookChange = vi.fn();

    render(<BookPage requestedBookId={otherBookId} onWorkspaceBookChange={handleWorkspaceBookChange} />);

    expect(screen.getByText("正在打开书籍工作区...")).toBeInTheDocument();
    expect(handleWorkspaceBookChange).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText("星河回声")).toBeInTheDocument();
    });

    expect(handleWorkspaceBookChange).not.toHaveBeenCalled();
    expect(useBookWorkspaceStore.getState().rootBookId).toBe(otherBookId);
  });
});

