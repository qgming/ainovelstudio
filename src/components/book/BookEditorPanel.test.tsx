import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookEditorPanel } from "./BookEditorPanel";

const { writeText } = vi.hoisted(() => ({
  writeText: vi.fn(),
}));

describe("BookEditorPanel", () => {
  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("顶部保存按钮使用纯图标工具栏样式", () => {
    render(
      <BookEditorPanel
        activeFileName="第001章_待命名.md"
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

  it("复制按钮会将当前内容写入剪切板", () => {
    render(
      <BookEditorPanel
        activeFileName="第001章_待命名.md"
        busy={false}
        content="这是章节内容"
        isDirty={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制当前内容" }));

    expect(writeText).toHaveBeenCalledWith("这是章节内容");
  });

  it("markdown 文件支持在编辑与预览之间切换", () => {
    render(
      <BookEditorPanel
        activeFileName="第001章_待命名.md"
        busy={false}
        content={"# 标题\n\n- 条目一"}
        isDirty={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "文件编辑器" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "切换到 Markdown 预览" }));

    expect(screen.queryByRole("textbox", { name: "文件编辑器" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "标题" })).toBeInTheDocument();
    expect(screen.getByText("条目一").tagName).toBe("LI");

    fireEvent.click(screen.getByRole("button", { name: "切换到文本编辑" }));

    expect(screen.getByRole("textbox", { name: "文件编辑器" })).toBeInTheDocument();
  });

  it("非 markdown 文件不显示预览切换按钮", () => {
    render(
      <BookEditorPanel
        activeFileName="创作状态追踪器.json"
        busy={false}
        content='{"chapter":"001"}'
        isDirty={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "切换到 Markdown 预览" })).not.toBeInTheDocument();
  });
});
