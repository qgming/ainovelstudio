import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

	const { mockInvoke, mockWindow } = vi.hoisted(() => ({
	  mockInvoke: vi.fn(),
	  mockWindow: {
	    close: vi.fn(),
	    destroy: vi.fn(),
	    hide: vi.fn(),
	    isMaximized: vi.fn().mockResolvedValue(false),
    maximize: vi.fn(),
    minimize: vi.fn(),
    onCloseRequested: vi.fn().mockResolvedValue(() => {}),
    onResized: vi.fn().mockResolvedValue(() => {}),
    onThemeChanged: vi.fn().mockResolvedValue(() => {}),
    setTheme: vi.fn().mockResolvedValue(undefined),
    theme: vi.fn().mockResolvedValue(null),
    unmaximize: vi.fn(),
  },
}));

const { mockOpenUrl } = vi.hoisted(() => ({
  mockOpenUrl: vi.fn(),
}));

const { updateStoreState } = vi.hoisted(() => ({
  updateStoreState: {
    autoUpdateEnabled: true,
    checkForUpdates: vi.fn(),
    downloadAvailableUpdate: vi.fn(),
    errorMessage: null as string | null,
    initializePreferences: vi.fn(),
    installDownloadedUpdate: vi.fn(),
    pendingInstallVersion: null as string | null,
    progress: null as number | null,
    runStartupUpdateFlow: vi.fn().mockResolvedValue(undefined),
    setAutoUpdateEnabled: vi.fn(),
    status: "idle" as "idle" | "available" | "checking" | "downloading" | "downloaded" | "installing" | "latest" | "error",
    updateSummary: null as { version: string } | null,
  },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => mockWindow,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  isTauri: () => true,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mockOpenUrl,
}));

vi.mock("@lobehub/icons", () => ({
  ProviderIcon: ({ provider }: { provider: string }) => <span data-testid={`provider-icon-${provider}`} />,
  Claude: {
    Color: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-claude" />,
  },
  Gemini: {
    Color: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-gemini" />,
  },
  Qwen: {
    Color: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-qwen" />,
  },
  Zhipu: {
    Color: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-zhipu" />,
  },
  XiaomiMiMo: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-xiaomi-mimo" />,
  SiliconCloud: {
    Color: ({ size }: { size?: number }) => <span data-size={size} data-testid="provider-icon-siliconflow" />,
  },
}));

vi.mock("@features/update/stores/useUpdateStore", () => ({
  useUpdateStore: <T,>(selector: (state: typeof updateStoreState) => T) => selector(updateStoreState),
}));

import App from "./App";
import { useChatRunStore as useAgentStore } from "@features/agent/stores/useChatRunStore";
import { useAgentSettingsStore } from "@features/settings/stores/useAgentSettingsStore";
import { useBookWorkspaceStore } from "@features/books/stores/useBookWorkspaceStore";
import { useThemeStore } from "@shared/theme/useThemeStore";

const rootPath = "C:/books/北境余烬";
const bookId = "book-1";
const chapterPath = `${rootPath}/正文/第一卷/第001章_待命名.md`;
const chatBootstrap = {
  bookId: "__global__",
  sessions: [
    {
      bookId: "__global__",
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
  activeSessionEntries: [],
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

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value,
  });
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}

describe("App shell", () => {
  beforeEach(() => {
    window.location.hash = "";
    setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    setViewportWidth(1280);
    window.localStorage.clear();
    document.documentElement.className = "";
    useThemeStore.setState({ theme: "light", themePreference: "system", initialized: false });
    useBookWorkspaceStore.getState().resetState();
    useAgentStore.getState().reset();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    useAgentSettingsStore.getState().reset();
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "initialize_chat_storage") {
        return chatBootstrap;
      }
      if (command === "list_book_workspaces") {
        return [];
      }
      return undefined;
    });
    mockWindow.close.mockReset();
    mockWindow.destroy.mockReset();
    mockWindow.hide.mockReset();
    mockWindow.hide.mockResolvedValue(undefined);
    mockWindow.isMaximized.mockReset();
    mockWindow.isMaximized.mockResolvedValue(false);
    mockWindow.maximize.mockReset();
    mockWindow.minimize.mockReset();
    mockWindow.onCloseRequested.mockReset();
    mockWindow.onCloseRequested.mockResolvedValue(() => {});
    mockWindow.onResized.mockReset();
    mockWindow.onResized.mockResolvedValue(() => {});
    mockWindow.onThemeChanged.mockReset();
    mockWindow.onThemeChanged.mockResolvedValue(() => {});
    mockWindow.setTheme.mockReset();
    mockWindow.setTheme.mockResolvedValue(undefined);
    mockWindow.theme.mockReset();
    mockWindow.theme.mockResolvedValue(null);
    mockWindow.unmaximize.mockReset();
    mockOpenUrl.mockReset();
    updateStoreState.autoUpdateEnabled = true;
    updateStoreState.pendingInstallVersion = null;
    updateStoreState.progress = null;
    updateStoreState.errorMessage = null;
    updateStoreState.status = "idle";
    updateStoreState.updateSummary = null;
    updateStoreState.checkForUpdates.mockReset();
    updateStoreState.downloadAvailableUpdate.mockReset();
    updateStoreState.initializePreferences.mockReset();
    updateStoreState.installDownloadedUpdate.mockReset();
    updateStoreState.runStartupUpdateFlow.mockReset();
    updateStoreState.runStartupUpdateFlow.mockResolvedValue(undefined);
    updateStoreState.setAutoUpdateEnabled.mockReset();

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
    expect(screen.getByRole("link", { name: "书架" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "技能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "排行榜" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "主题切换" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置" })).toBeInTheDocument();

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
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("terminate_application");
    });

    await waitFor(() => {
      expect(mockWindow.isMaximized).toHaveBeenCalled();
    });
  });

  it("首页检测到新版本时会自动展示更新弹窗", async () => {
    updateStoreState.status = "available";
    updateStoreState.updateSummary = {
      currentVersion: "0.2.3",
      notes: "### 更新内容\n\n- 修复更新日志显示",
      packageKind: "exe",
      publishedAt: null,
      version: "0.2.4",
    } as never;

    render(<App />);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("发现 0.2.4");
    expect(dialog).toHaveTextContent("更新内容");
    expect(dialog).toHaveTextContent("修复更新日志显示");

    fireEvent.click(screen.getByRole("button", { name: "稍后再说" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const homeActions = screen.getByRole("button", { name: "查看 0.2.4 更新" }).parentElement;
    expect(screen.getByRole("button", { name: "查看 0.2.4 更新" })).toBeInTheDocument();
    expect(homeActions?.firstElementChild).toHaveAttribute("aria-label", "查看 0.2.4 更新");
  });

  it("非书架页面检测到新版本时不会显示首页顶部更新按钮", async () => {
    window.location.hash = "#/setting";
    updateStoreState.status = "available";
    updateStoreState.updateSummary = {
      currentVersion: "0.2.3",
      notes: "### 更新内容\n\n- 修复更新日志显示",
      packageKind: "exe",
      publishedAt: null,
      version: "0.2.4",
    } as never;

    render(<App />);

    expect(await screen.findByLabelText("默认 AGENTS 编辑器", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看 0.2.4 更新" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("关闭请求会退出应用", async () => {
    let closeHandler: ((event: { preventDefault: () => void }) => Promise<void>) | undefined;
    mockWindow.onCloseRequested.mockImplementation(async (handler: (event: { preventDefault: () => void }) => Promise<void>) => {
      closeHandler = handler;
      return () => {};
    });

    render(<App />);

    await waitFor(() => {
      expect(closeHandler).toBeDefined();
    });

    const preventDefault = vi.fn();
    await closeHandler?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mockWindow.hide).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("terminate_application");
  });

  it("桌面端会同步 Agent 状态到托盘菜单", async () => {
    useAgentStore.setState({
      activeRunRequestId: "run-1",
      run: {
        id: "session-1",
        messages: [],
        status: "running",
        title: "继续写下一章",
      },
      status: "ready",
    });

    render(<App />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("update_tray_ai_status", {
        statusLabel: "AI 运行中",
      });
    });
  });

  it("Android 环境不会挂载桌面标题栏和关闭拦截", async () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro)");

    render(<App />);

    expect(screen.queryByRole("button", { name: "最小化窗口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "最大化窗口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭窗口" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "首页" })).toBeInTheDocument();
    });

    expect(mockWindow.onCloseRequested).not.toHaveBeenCalled();
  });

  it("窄屏桌面环境会显示底部导航", async () => {
    setViewportWidth(390);

    render(<App />);

    expect(screen.getByRole("button", { name: "最小化窗口" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "首页" })).toBeInTheDocument();
  });

  it("默认进入首页并展示书籍入口动作", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "initialize_chat_storage") {
        return chatBootstrap;
      }
      if (command === "list_book_workspaces") {
        return [{ id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 }];
      }
      return undefined;
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "刷新书架" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入书籍" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建书籍" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book 北境余烬" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更多操作 北境余烬" })).toBeInTheDocument();
  });

  it("首页启动时不会预先初始化技能库和 Agent 设置", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "initialize_chat_storage") {
        return chatBootstrap;
      }
      if (command === "list_book_workspaces") {
        return [];
      }
      return undefined;
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "刷新书架" })).toBeInTheDocument();
    expect(mockInvoke.mock.calls.filter(([command]) => command === "initialize_builtin_skills")).toHaveLength(0);
    expect(mockInvoke.mock.calls.filter(([command]) => command === "scan_installed_skills")).toHaveLength(0);
    expect(mockInvoke.mock.calls.filter(([command]) => command === "read_agent_settings")).toHaveLength(0);
    expect(mockInvoke.mock.calls.filter(([command]) => command === "initialize_default_agent_config")).toHaveLength(0);
  });

  it("首页点击书籍后会进入图书工作区", async () => {
    mockInvoke.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      switch (command) {
        case "initialize_chat_storage":
          return chatBootstrap;
        case "list_book_workspaces":
          return [{ id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 }];
        case "get_book_workspace_summary_by_id":
        case "get_book_workspace_summary":
          return { id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 };
        case "read_workspace_tree":
          return tree;
        case "read_text_file":
          return payload?.path === chapterPath ? "这是章节初稿" : "";
        default:
          return undefined;
      }
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Book 北境余烬" }));

    await waitFor(() => {
      expect(window.location.hash).toContain(`/books/${bookId}`);
    });
    expect(
      await screen.findByRole("tree", { name: "书籍文件树" }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it("首页已有书籍 summary 时，进入工作区不会卡在 by-id 查询", async () => {
    mockInvoke.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      switch (command) {
        case "initialize_chat_storage":
          return chatBootstrap;
        case "list_book_workspaces":
          return [{ id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 }];
        case "get_book_workspace_summary_by_id":
          return new Promise(() => undefined);
        case "read_workspace_tree":
          return tree;
        case "read_text_file":
          return payload?.path === chapterPath ? "这是章节初稿" : "";
        default:
          return undefined;
      }
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Book 北境余烬" }));

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();
    expect(await screen.findByRole("tree", { name: "书籍文件树" })).toBeInTheDocument();
    expect(mockInvoke).not.toHaveBeenCalledWith("get_book_workspace_summary_by_id", {
      bookId,
    });
  });

  it("首页导入 ZIP 书籍后会进入图书工作区", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "initialize_chat_storage":
          return chatBootstrap;
        case "list_book_workspaces":
          return [];
        case "import_book_zip":
          return { id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 };
        case "get_book_workspace_summary_by_id":
          return { id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 };
        case "read_workspace_tree":
          return tree;
        default:
          return undefined;
      }
    });

    render(<App />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();

    const file = new File(["zip-book"], "北境余烬.zip", { type: "application/zip" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => Uint8Array.from([80, 75, 3, 4]).buffer,
    });

    await act(async () => {
      fireEvent.change(input!, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("import_book_zip", {
        archiveBytes: [80, 75, 3, 4],
        fileName: "北境余烬.zip",
      });
    });

    expect(await screen.findByRole("tree", { name: "书籍文件树" })).toBeInTheDocument();
    expect(window.location.hash).toContain(`/books/${bookId}`);
  });

  it("首页图书更多菜单支持导出 ZIP", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "initialize_chat_storage":
          return chatBootstrap;
        case "list_book_workspaces":
          return [{ id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 }];
        case "export_book_zip":
          return "C:/exports/北境余烬.zip";
        default:
          return undefined;
      }
    });

    render(<App />);

    fireEvent.pointerDown(await screen.findByRole("button", { name: "更多操作 北境余烬" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "导出图书" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("export_book_zip", {
        rootPath,
      });
    });

    expect(await screen.findByText("已导出《北境余烬》")).toBeInTheDocument();
  });

  it("首页图书更多菜单支持删除图书", async () => {
    let books = [{ id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 }];
    mockInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "initialize_chat_storage":
          return chatBootstrap;
        case "list_book_workspaces":
          return books;
        case "delete_book_workspace":
          books = [];
          return undefined;
        default:
          return undefined;
      }
    });

    render(<App />);

    fireEvent.pointerDown(await screen.findByRole("button", { name: "更多操作 北境余烬" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "删除图书" }));

    expect(await screen.findByText("删除后不会进入回收站，请确认这是你想要的操作。")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除图书" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("delete_book_workspace", {
        rootPath,
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Book 北境余烬" })).not.toBeInTheDocument();
    });
  });

  it("点击顶部栏主题按钮会在三种主题模式之间循环且不会离开当前页面", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "技能" }));

    await waitFor(() => {
      expect(document.documentElement).toHaveClass("dark");
    });

    const themeButton = screen.getByRole("button", { name: "主题切换" });

    fireEvent.click(themeButton);

    expect(document.documentElement).not.toHaveClass("dark");

    fireEvent.click(themeButton);

    expect(document.documentElement).toHaveClass("dark");

    fireEvent.click(themeButton);

    expect(document.documentElement).toHaveClass("dark");
    expect(await screen.findByRole("button", { name: "刷新技能库" })).toBeInTheDocument();
  });

  it("设置页支持编辑默认 AGENTS，并可切换到工具库", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "设置" }));

    expect(
      await screen.findByLabelText("默认 AGENTS 编辑器", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("AGENTS.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "工具库" }));

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "禁用 读取工作区文件" })).toBeInTheDocument();
    });

    expect(screen.getByText("读取工作区文件")).toBeInTheDocument();
    expect(screen.getByText("局部编辑")).toBeInTheDocument();
    expect(screen.getByText("写入文本")).toBeInTheDocument();
    expect(screen.getByText("搜索工作区")).toBeInTheDocument();
    expect(screen.getByText("浏览工作区")).toBeInTheDocument();
  });

  it("设置页支持一键重置默认 AGENTS 为内置内容并保存", async () => {
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "initialize_chat_storage") {
        return chatBootstrap;
      }
      if (command === "list_book_workspaces") {
        return [];
      }
      if (command === "initialize_default_agent_config" || command === "read_default_agent_config") {
        return {
          initializedFromBuiltin: false,
          markdown: "# 自定义主代理",
          path: "sqlite://config/AGENTS.md",
        };
      }
      if (command === "read_agent_settings") {
        return null;
      }
      if (command === "reset_default_agent_config") {
        return {
          initializedFromBuiltin: true,
          markdown: "# 内置主代理\n\n- 恢复默认。",
          path: "sqlite://config/AGENTS.md",
        };
      }
      return undefined;
    });

    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "设置" }));
    const editor = await screen.findByLabelText("默认 AGENTS 编辑器", {}, { timeout: 5000 });

    await waitFor(() => {
      expect(editor).toHaveValue("# 自定义主代理");
    });

    fireEvent.click(screen.getByRole("button", { name: "重置为内置 AGENTS 并保存" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("reset_default_agent_config");
      expect(editor).toHaveValue("# 内置主代理\n\n- 恢复默认。");
    });
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
    expect(screen.getAllByRole("button", { name: /查看 .* 详情/ }).length).toBeGreaterThan(0);
  });

  it("设置页关于我们展示神笔写作品牌信息", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "设置" }));
    fireEvent.click(await screen.findByRole("button", { name: "关于我们" }));

    expect(await screen.findByRole("heading", { name: "神笔写作" })).toBeInTheDocument();
    expect(screen.getByAltText("神笔写作 Logo")).toBeInTheDocument();
    expect(screen.getByText("0.2.9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "检查更新" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "自动更新" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开官网" })).toHaveAttribute("href", "https://www.qgming.com");
    expect(screen.queryByText("www.qgming.com")).not.toBeInTheDocument();
  });

  it("设置页也可以通过全局状态切换主题", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("link", { name: "设置" }));
    await screen.findByLabelText("默认 AGENTS 编辑器");
    fireEvent.click(screen.getByRole("button", { name: "主题切换" }));

    expect(document.documentElement).not.toHaveClass("dark");
    expect(screen.getByRole("button", { name: "主题切换" })).toBeInTheDocument();
  });

  it("从其他页面进入指定书籍页时，会先显示打开中状态，再稳定进入工作区", async () => {
    window.location.hash = `#/books/${bookId}`;
    let resolveTree!: (value: typeof tree) => void;
    mockInvoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "initialize_chat_storage":
          return chatBootstrap;
        case "get_book_workspace_summary_by_id":
        case "get_book_workspace_summary":
          return { id: bookId, name: "北境余烬", path: rootPath, updatedAt: 1710000000 };
        case "read_workspace_tree":
          return new Promise<typeof tree>((resolve) => {
            resolveTree = resolve;
          });
        default:
          return undefined;
      }
    });

    render(<App />);

    expect(screen.getByText("正在打开书籍工作区...")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "选择书籍" })).not.toBeInTheDocument();
    expect(screen.queryByText("从左侧打开一个文件。")).not.toBeInTheDocument();

    await waitFor(() => {
      const readTreeCalls = mockInvoke.mock.calls.filter(([command]) => command === "read_workspace_tree");
      expect(readTreeCalls).toHaveLength(1);
    });

    await act(async () => {
      resolveTree(tree);
    });

    expect(await screen.findByText("北境余烬")).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "书籍文件树" })).toBeInTheDocument();
  });
});
