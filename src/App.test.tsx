import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockWindow } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockWindow: {
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    maximize: vi.fn(),
    minimize: vi.fn(),
    onResized: vi.fn().mockResolvedValue(() => {}),
    unmaximize: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mockWindow,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

import App from "./App";
import { BUILTIN_TOOLS } from "./lib/agent/toolDefs";
import { useAgentStore } from "./stores/agentStore";
import { useAgentSettingsStore } from "./stores/agentSettingsStore";
import { useBookWorkspaceStore } from "./stores/bookWorkspaceStore";
import { useThemeStore } from "./stores/themeStore";

const rootPath = "C:/books/北境余烬";
const chapterPath = `${rootPath}/04_正文/第一卷/第001章_待命名.md`;
const chatBootstrap = {
  sessions: [
    {
      id: "session-1",
      title: "新对话",
      summary: "",
      status: "idle",
      createdAt: "1",
      updatedAt: "1",
      lastMessageAt: null,
      pinned: false,
      archived: false,
    },
  ],
  activeSessionId: "session-1",
  activeSessionMessages: [],
  activeSessionDraft: "",
};
const tree = {
  kind: "directory",
  name: "北境余烬",
  path: rootPath,
  children: [
    {
      kind: "file",
      name: "第001章_待命名.md",
      path: chapterPath,
      extension: ".md",
    },
  ],
} as const;

describe("App shell", () => {
  beforeEach(() => {
    window.location.hash = "";
    window.localStorage.clear();
    document.documentElement.className = "";
    useThemeStore.setState({ theme: "light", initialized: false });
    useBookWorkspaceStore.getState().resetState();
    useAgentStore.getState().reset();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    useAgentSettingsStore.getState().reset();
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "initialize_chat_storage") {
        return chatBootstrap;
      }
      return undefined;
    });
    mockWindow.close.mockReset();
    mockWindow.isMaximized.mockReset();
    mockWindow.isMaximized.mockResolvedValue(false);
    mockWindow.maximize.mockReset();
    mockWindow.minimize.mockReset();
    mockWindow.onResized.mockReset();
    mockWindow.onResized.mockResolvedValue(() => {});
    mockWindow.unmaximize.mockReset();

    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-color-scheme: dark)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("显示自定义标题栏并提供窗口控制按钮", async () => {
    render(<App />);

    expect(screen.getByText("神笔写作")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "最小化窗口" }));
    fireEvent.click(screen.getByRole("button", { name: "最大化窗口" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "还原窗口" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "还原窗口" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭窗口" }));

    expect(mockWindow.minimize).toHaveBeenCalledTimes(1);
    expect(mockWindow.maximize).toHaveBeenCalledTimes(1);
    expect(mockWindow.unmaximize).toHaveBeenCalledTimes(1);
    expect(mockWindow.close).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(mockWindow.isMaximized).toHaveBeenCalled();
    });
  });

  it("默认显示书籍空状态，并且可以切换到技能页", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "选择书籍" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "技能" }));

    expect(screen.getByRole("heading", { name: "技能中心" })).toBeInTheDocument();
    expect(screen.queryByText(/已启用 \d+ 个技能/)).not.toBeInTheDocument();
  });

  it("可以切换到代理页", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "代理" }));

    expect(await screen.findByRole("heading", { name: "代理中心" })).toBeInTheDocument();
  });

  it("点击侧边栏主题按钮会切换深色模式且不会离开当前页面", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "技能" }));

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
    });

    fireEvent.click(screen.getByRole("button", { name: "主题切换" }));

    expect(document.documentElement).not.toHaveClass("dark");
    expect(screen.getByRole("heading", { name: "技能中心" })).toBeInTheDocument();
  });

  it("设置页支持编辑默认 AGENTS，并可切换到工具库", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "设置" }));

    expect(await screen.findByLabelText("默认 AGENTS 编辑器")).toBeInTheDocument();
    expect(screen.getByText("AGENTS.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "工具库" }));

    await waitFor(() => {
      expect(
        screen.getByText(new RegExp(`内置工具 · 已启用 ${BUILTIN_TOOLS.length}`)),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("读取文件")).toBeInTheDocument();
    expect(screen.getByText("行编辑")).toBeInTheDocument();
    expect(screen.getByText("内容搜索")).toBeInTheDocument();
    expect(screen.getByText("读取目录树")).toBeInTheDocument();
  });

  it("设置页会主动初始化模型配置并回填已保存的 key、url 和 model", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "initialize_chat_storage") {
        return chatBootstrap;
      }
      if (command === "initialize_default_agent_config") {
        return {
          initializedFromBuiltin: true,
          markdown: "# 文件主代理",
          path: "C:/Program Files/ainovelstudio/resources/config/AGENTS.md",
        };
      }
      if (command === "read_default_agent_config") {
        return {
          initializedFromBuiltin: true,
          markdown: "# 文件主代理",
          path: "C:/Program Files/ainovelstudio/resources/config/AGENTS.md",
        };
      }
      if (command === "read_agent_settings") {
        return {
          config: {
            apiKey: "saved-key",
            baseURL: "https://example.com/v1",
            model: "saved-model",
          },
          enabledTools: {},
        };
      }
      return undefined;
    });

    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "模型设置" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("https://example.com/v1")).toBeInTheDocument();
      expect(screen.getByDisplayValue("saved-model")).toBeInTheDocument();
      expect(screen.getByDisplayValue("saved-key")).toBeInTheDocument();
    });
  });

  it("设置页模型设置展示推荐供应商卡片", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "模型设置" }));

    expect(await screen.findByRole("button", { name: "使用 OpenAI 地址" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 Claude 地址" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 智谱 AI 地址" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 小米 MiMo 地址" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 硅基流动 地址" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 Moonshot AI 地址" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 LongCat 地址" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 ByteDance 地址" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 Gemini 地址" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 Qwen 地址" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "查看详情" }).length).toBeGreaterThan(0);
  });

  it("设置页关于我们展示神笔写作品牌信息", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "关于我们" }));

    expect(await screen.findByRole("heading", { name: "神笔写作" })).toBeInTheDocument();
    expect(screen.getByAltText("神笔写作 Logo")).toBeInTheDocument();
    expect(screen.getByText("版本 0.1.1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开官网" })).toHaveAttribute("href", "https://www.qgming.com");
    expect(screen.queryByText("www.qgming.com")).not.toBeInTheDocument();
  });

  it("设置页也可以通过全局状态切换主题", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "基本设置" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeInTheDocument();
    });

    expect(screen.queryByText(/主题、模型 provider/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "切换到浅色模式" }));

    expect(document.documentElement).not.toHaveClass("dark");
    expect(screen.getByRole("button", { name: "切换到深色模式" })).toBeInTheDocument();
  });

  it("从其他页面进入书籍页时，恢复中的工作区不会闪出空状态或编辑器空占位", async () => {
    window.location.hash = "#/skills";
    window.localStorage.setItem(
      "ainovelstudio-book-workspace",
      JSON.stringify({ rootPath, selectedFilePath: chapterPath }),
    );

    let resolveFile!: (value: string) => void;
    mockInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "initialize_chat_storage":
          return chatBootstrap;
        case "read_workspace_tree":
          return tree;
        case "read_text_file":
          return new Promise<string>((resolve) => {
            resolveFile = resolve;
          });
        default:
          return undefined;
      }
    });

    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "首页" }));

    expect(screen.getByText("正在恢复书籍工作区...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择书籍" })).not.toBeInTheDocument();
    expect(screen.queryByText("从左侧打开一个文件。")).not.toBeInTheDocument();

    await waitFor(() => {
      const readFileCalls = mockInvoke.mock.calls.filter(([command]) => command === "read_text_file");
      expect(readFileCalls).toHaveLength(1);
    });

    await act(async () => {
      resolveFile("这是章节初稿");
    });

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "第001章_待命名.md" })).toBeInTheDocument();
  });
});


