import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingPage } from "./SettingPage";
import { useThemeStore } from "../stores/themeStore";

vi.mock("../components/settings/SettingSectionContent", () => ({
  SettingSectionContent: ({ sectionKey }: { sectionKey: string }) => (
    <div data-testid="setting-section-content">section:{sectionKey}</div>
  ),
}));

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

function renderSettingPage(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/setting" element={<SettingPage />} />
        <Route path="/setting/:sectionKey" element={<SettingPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SettingPage mobile", () => {
  beforeEach(() => {
    mockViewport(390);
    document.documentElement.className = "";
    window.localStorage.clear();
    useThemeStore.setState({ theme: "light", initialized: true });
  });

  it("移动端设置首页只展示设置选项列表", () => {
    renderSettingPage("/setting");

    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换到深色模式" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入AGENTS" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入用量统计" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入模型设置" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入工具库" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "进入关于我们" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "默认 AGENTS 编辑器" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "打开官网" })).not.toBeInTheDocument();
  });

  it("移动端设置首页可直接切换主题", async () => {
    renderSettingPage("/setting");

    fireEvent.click(screen.getByRole("button", { name: "切换到深色模式" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("button", { name: "切换到浅色模式" })).toBeInTheDocument();
  });

  it("移动端进入详情页后显示返回按钮和对应设置内容", async () => {
    renderSettingPage("/setting/about");

    expect(screen.getByRole("button", { name: "返回设置" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "关于我们" })).toBeInTheDocument();
    expect(await screen.findByTestId("setting-section-content")).toHaveTextContent("section:about");
  });
});
