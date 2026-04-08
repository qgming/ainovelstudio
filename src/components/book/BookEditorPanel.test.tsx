import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BookEditorPanel } from "./BookEditorPanel";

describe("BookEditorPanel", () => {
  it("顶部保存按钮使用纯图标工具栏样式", () => {
    render(
      <BookEditorPanel
        activeFileName="第1章-开篇.md"
        busy={false}
        content="这是章节内容"
        isDirty={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const saveButton = screen.getByRole("button", { name: "保存当前文件" });
    expect(saveButton).toHaveTextContent("");
    expect(saveButton.className).toContain("h-8");
    expect(saveButton.className).toContain("w-8");
    expect(saveButton.className).toContain("rounded-[8px]");
    expect(saveButton.className).toContain("hover:bg-[#edf1f6]");
  });
});
