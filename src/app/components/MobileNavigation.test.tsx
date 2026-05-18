import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MobileNavigation } from "./MobileNavigation";

describe("MobileNavigation", () => {
  function renderMobileNavigation(initialEntries?: string[]) {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <MobileNavigation />
      </MemoryRouter>,
    );
  }

  it("移动端底部导航包含首页、技能、排行榜和设置入口", () => {
    renderMobileNavigation();

    const labels = screen
      .getAllByRole("link")
      .map((link) => link.getAttribute("aria-label"))
      .filter(Boolean);

    expect(labels).toEqual(["首页", "技能", "排行榜", "设置"]);
  });

  it("移动端会标记当前选中的导航项", () => {
    renderMobileNavigation(["/skills"]);

    expect(screen.getByRole("link", { name: "技能" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "首页" })).not.toHaveAttribute("aria-current");
  });

  it("进入图书详情时隐藏全局底部导航", () => {
    renderMobileNavigation(["/books/book-1"]);

    expect(screen.queryByRole("navigation", { name: "主导航" })).not.toBeInTheDocument();
  });
});
