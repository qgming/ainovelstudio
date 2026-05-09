import { render, screen } from "@testing-library/react";
import { Plus, RefreshCw } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PageShell } from "./PageShell";

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

describe("PageShell", () => {
  beforeEach(() => {
    mockViewport(1280);
  });

  it("桌面端顶部操作按钮保留图标和文字", () => {
    render(
      <PageShell
        title={<div>书架</div>}
        actions={[
          { icon: RefreshCw, label: "刷新书架", onClick: vi.fn() },
          { icon: Plus, label: "新建书籍", tone: "primary", onClick: vi.fn() },
        ]}
      >
        <div>content</div>
      </PageShell>,
    );

    expect(screen.getByRole("button", { name: "刷新书架" })).toHaveTextContent("刷新书架");
    expect(screen.getByRole("button", { name: "新建书籍" })).toHaveTextContent("新建书籍");
  });

  it("移动端顶部操作按钮切换为纯图标", () => {
    mockViewport(390);

    render(
      <PageShell
        title={<div>书架</div>}
        actions={[
          { icon: RefreshCw, label: "刷新书架", onClick: vi.fn() },
          { icon: Plus, label: "新建书籍", tone: "primary", onClick: vi.fn() },
        ]}
      >
        <div>content</div>
      </PageShell>,
    );

    expect(screen.getByRole("button", { name: "刷新书架" })).not.toHaveTextContent("刷新书架");
    expect(screen.getByRole("button", { name: "新建书籍" })).not.toHaveTextContent("新建书籍");
  });
});
