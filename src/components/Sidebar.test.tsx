import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useThemeStore } from "../stores/themeStore";

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
  beforeEach(() => {
    mockViewport(1280);
    useThemeStore.setState({ theme: "light", initialized: true });
  });

  it("把工作流入口放在首页和技能之间", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    const labels = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label"))
      .filter(Boolean);

    expect(labels.slice(0, 4)).toEqual(["首页", "工作流", "技能", "代理"]);
  });

  it("小窗口下切换为底部导航栏", async () => {
    mockViewport(390);

    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("navigation", { name: "主导航" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "首页" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "工作流" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "技能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "代理" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "设置" })).toBeInTheDocument();
    expect(screen.queryByText("首页")).not.toBeInTheDocument();
    expect(screen.queryByText("工作流")).not.toBeInTheDocument();
    expect(screen.queryByText("技能")).not.toBeInTheDocument();
    expect(screen.queryByText("代理")).not.toBeInTheDocument();
    expect(screen.queryByText("设置")).not.toBeInTheDocument();
  });
});
