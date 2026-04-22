import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TooltipProvider } from "./ui/tooltip";
import { useThemeStore } from "../stores/themeStore";
import { useUpdateStore } from "../stores/updateStore";

function mockViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)" ? width < 768 : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe("Sidebar", () => {
  function renderSidebar(initialEntries?: string[]) {
    return render(
      <TooltipProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Sidebar />
        </MemoryRouter>
      </TooltipProvider>,
    );
  }

  beforeEach(() => {
    mockViewport(1280);
    useThemeStore.setState({ theme: "light", initialized: true });
    useUpdateStore.setState({
      autoUpdateEnabled: true,
      errorMessage: null,
      initialized: true,
      status: "idle",
      updateSummary: null,
    });
  });

  it("把工作流入口放在首页和技能之间", () => {
    renderSidebar();

    const labels = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label"))
      .filter(Boolean);

    expect(labels.slice(0, 4)).toEqual(["首页", "工作流", "技能", "代理"]);
  });

  it("桌面侧边栏只保留主题按钮和导航入口", () => {
    renderSidebar();

    const themeButton = screen.getByRole("button", { name: "主题切换" });
    const homeLink = screen.getByRole("link", { name: "首页" });

    expect(themeButton).toBeInTheDocument();
    expect(themeButton.querySelector("svg")).toHaveClass("size-5");
    expect(homeLink.querySelector("svg")).toHaveClass("size-5");
    expect(screen.queryByRole("button", { name: "立即同步" })).not.toBeInTheDocument();
  });

  it("检测到新版本时会显示位于主题切换上方的独立更新按钮", () => {
    useUpdateStore.setState({
      autoUpdateEnabled: true,
      errorMessage: null,
      initialized: true,
      status: "available",
      updateSummary: {
        currentVersion: "0.1.8",
        downloadUrl: "https://example.com/ainovelstudio_0.1.9_windows_x64.exe",
        notes: "修复更新流程",
        packageKind: "exe",
        publishedAt: "2026-04-22T06:30:00Z",
        version: "0.1.9",
      },
    });

    renderSidebar();

    const updateButton = screen.getByRole("button", { name: "查看 0.1.9 更新" });
    const themeButton = screen.getByRole("button", { name: "主题切换" });

    expect(updateButton).toBeInTheDocument();
    expect(themeButton).toBeInTheDocument();
    expect(updateButton.compareDocumentPosition(themeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("只有当前选中的桌面导航项显示左侧线条", () => {
    renderSidebar(["/skills"]);

    expect(screen.getByRole("link", { name: "技能" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "技能" })).toHaveClass("text-primary");
    expect(screen.getByRole("link", { name: "首页" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "首页" })).not.toHaveClass("text-primary");
    expect(screen.getByRole("link", { name: "工作流" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "工作流" })).not.toHaveClass("text-primary");
    expect(screen.getByRole("link", { name: "代理" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "代理" })).not.toHaveClass("text-primary");
  });

  it("小窗口下切换为底部导航栏", async () => {
    mockViewport(390);

    renderSidebar();

    expect(await screen.findByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "首页" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "工作流" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "技能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "代理" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置" })).toBeInTheDocument();
  });

  it("移动端进入图书或工作流详情时隐藏全局底部导航", () => {
    mockViewport(390);

    const { rerender } = render(
      <TooltipProvider>
        <MemoryRouter initialEntries={["/books/book-1"]}>
          <Sidebar />
        </MemoryRouter>
      </TooltipProvider>,
    );

    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <MemoryRouter initialEntries={["/workflows/workflow-1"]}>
          <Sidebar />
        </MemoryRouter>
      </TooltipProvider>,
    );

    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
  });
});
