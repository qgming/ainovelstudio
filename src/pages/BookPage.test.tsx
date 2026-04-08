import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import { BookPage } from "./BookPage";
import { useBookWorkspaceStore } from "../stores/bookWorkspaceStore";

const rootPath = "C:/books/北境余烬";
const chapterPath = `${rootPath}/章节/第一卷/第1章-开篇.md`;
const secondVolumePath = `${rootPath}/章节/第二卷/第2章-并行线.md`;
const tree = {
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
        {
          kind: "directory",
          name: "第二卷",
          path: `${rootPath}/章节/第二卷`,
          children: [
            {
              kind: "file",
              name: "第2章-并行线.md",
              path: secondVolumePath,
              extension: ".md",
            },
          ],
        },
      ],
    },
    {
      kind: "directory",
      name: "大纲",
      path: `${rootPath}/大纲`,
      children: [],
    },
  ],
} as const;

function setupInvokeMock() {
  mockInvoke.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
    switch (command) {
      case "pick_book_directory":
        return rootPath;
      case "read_workspace_tree":
        return tree;
      case "read_text_file":
        return "这是章节初稿";
      case "write_text_file":
        return undefined;
      case "create_book_workspace":
        return `${payload?.parentPath}/北境余烬`;
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

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "书籍文件树" })).toBeInTheDocument();
    expect(screen.getByText("第一卷")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent" })).toBeInTheDocument();
    expect(screen.queryByText("支持消息流、工具调用、子代理和深度思考展示")).not.toBeInTheDocument();
  });

  it("点击文本文件后会自动保存编辑内容", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "第一卷" }));
    fireEvent.click(await screen.findByRole("button", { name: "第1章-开篇.md" }));

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

  it("打开文件时不会收起同级已展开的文件夹", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "第一卷" }));
    fireEvent.click(screen.getByRole("button", { name: "第二卷" }));

    expect(await screen.findByText("第2章-并行线.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "第1章-开篇.md" }));

    expect(await screen.findByRole("textbox", { name: "文件编辑器" })).toHaveValue("这是章节初稿");
    expect(screen.getByText("第2章-并行线.md")).toBeInTheDocument();
  });

  it("支持刷新当前书籍以及单按钮切换全部展开和全部收起", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "第一卷" }));
    fireEvent.click(await screen.findByRole("button", { name: "第1章-开篇.md" }));

    const saveButton = await screen.findByRole("button", { name: "保存当前文件" });
    expect(saveButton).toHaveTextContent("");
    expect(saveButton.className).toContain("h-8");
    expect(saveButton.className).toContain("w-8");
    expect(saveButton.className).toContain("rounded-[8px]");
    expect(saveButton.className).toContain("hover:bg-[#edf1f6]");
  });

  it("已打开书籍后可从顶部重新打开书籍菜单并再次选择书籍", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开书籍菜单" }));

    expect(screen.getByRole("heading", { name: "书籍菜单" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));

    await waitFor(() => {
      const pickDirectoryCalls = mockInvoke.mock.calls.filter(([command]) => command === "pick_book_directory");
      expect(pickDirectoryCalls).toHaveLength(2);
    });
  });

  it("已打开书籍后可从顶部菜单再次触发新建书籍流程", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开书籍菜单" }));
    fireEvent.click(screen.getByRole("button", { name: "新建书籍" }));

    expect(screen.getByRole("heading", { name: "新建书籍" })).toBeInTheDocument();
    expect(screen.getByLabelText("书名")).toBeInTheDocument();
  });

  it("新建书籍时会弹出输入框并调用创建命令", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "新建书籍" }));
    fireEvent.change(screen.getByLabelText("书名"), { target: { value: "北境余烬" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并选择位置" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("create_book_workspace", {
        bookName: "北境余烬",
        parentPath: rootPath,
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
    expect(screen.getByRole("heading", { name: "第1章-开篇.md" })).toBeInTheDocument();
  });

  it("会恢复本地保存的三栏宽度", async () => {
    window.localStorage.setItem(
      "ainovelstudio-book-layout",
      JSON.stringify({ leftPanelWidth: 360, rightPanelWidth: 410 }),
    );

    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();
    expect(screen.getByText("北境余烬").closest("aside")).toHaveStyle({ width: "360px" });
    expect(screen.getByRole("heading", { name: "Agent" }).closest("aside")).toHaveStyle({
      width: "410px",
    });
  });

  it("拖拽分隔条后会调整宽度并持久化到本地", async () => {
    render(<BookPage />);

    fireEvent.click(screen.getByRole("button", { name: "选择书籍" }));

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

    expect(await screen.findByRole("button", { name: "展开 Agent 栏" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Agent" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开 Agent 栏" }));

    expect(await screen.findByRole("heading", { name: "Agent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent" }).closest("aside")).toHaveStyle({
      width: "430px",
    });
  });
});
