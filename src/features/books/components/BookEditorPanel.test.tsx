import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookEditorPanel } from "./BookEditorPanel";

const { toastSuccess, writeText } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccess,
  },
}));

describe("BookEditorPanel", () => {
  beforeEach(() => {
    toastSuccess.mockReset();
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
    expect(saveButton.getAttribute("data-size")).toBe("icon-sm");
    expect(saveButton.getAttribute("data-variant")).toBe("ghost");
    expect(saveButton.className).toContain("size-7");
    expect(saveButton.className).toContain("rounded-md");
  });

  it("复制按钮会将当前内容写入剪切板并提示已复制", async () => {
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
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith("已复制");
    });
  });

  it("顶部显示小说口径的当前内容字数", () => {
    render(
      <BookEditorPanel
        activeFileName="第001章_待命名.md"
        busy={false}
        content="你好，world 123！"
        isDirty={false}
        onChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const wordCount = screen.getByLabelText("当前内容字数");
    expect(wordCount).toHaveTextContent("4 字");
    expect(wordCount).toHaveClass("editor-status-chip");
  });

  it("文件名和字数工具栏位于编辑区顶部", () => {
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

    const heading = screen.getByRole("heading", { name: "第001章_待命名.md" });
    const toolbar = heading.closest("header");
    const editor = screen.getByRole("textbox", { name: "文件编辑器" });

    expect(toolbar).not.toBeNull();
    if (!toolbar) {
      throw new Error("toolbar should exist");
    }
    expect(toolbar.className).toContain("rounded-[8px]");
    expect(toolbar.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
