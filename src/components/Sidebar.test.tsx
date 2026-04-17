import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useThemeStore } from "../stores/themeStore";

describe("Sidebar", () => {
  beforeEach(() => {
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
});
