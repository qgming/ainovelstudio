import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ActionMenu } from "./ActionMenu";

const anchorRect = {
  bottom: 532,
  left: 160,
  right: 192,
  top: 500,
};

function GrowingMenu() {
  const [expanded, setExpanded] = useState(false);

  return (
    <ActionMenu anchorRect={anchorRect} onClose={() => undefined} width={220}>
      <div data-scroll-height={expanded ? "480" : "52"}>
        <button type="button" onClick={() => setExpanded((value) => !value)}>
          切换内容
        </button>
        {expanded ? <div>展开后的文件树内容</div> : null}
      </div>
    </ActionMenu>
  );
}

describe("ActionMenu", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 640 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });

    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function scrollHeight(this: HTMLElement) {
      const ownValue = this.dataset.scrollHeight;
      if (ownValue) {
        return Number(ownValue);
      }

      const nestedValue = this.querySelector<HTMLElement>("[data-scroll-height]")?.dataset.scrollHeight;
      return nestedValue ? Number(nestedValue) : 52;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("内容超过窗口半高时启用纵向滚动", async () => {
    render(<GrowingMenu />);

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveStyle({ overflowY: "hidden" });

    fireEvent.click(screen.getByRole("button", { name: "切换内容" }));

    await waitFor(() => {
      expect(menu).toHaveStyle({ maxHeight: "320px" });
      expect(menu).toHaveStyle({ overflowY: "auto" });
    });
  });
});
