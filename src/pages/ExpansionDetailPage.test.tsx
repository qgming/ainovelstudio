import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { ExpansionDetailPage } from "./ExpansionDetailPage";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

const workspaceId = "expansion-1";

const detail = {
  id: workspaceId,
  name: "测试扩写",
  updatedAt: 1710000000,
  projectEntries: [
    { section: "project", path: "AGENTS.md", name: "AGENTS.md", updatedAt: 1710000000 },
    { section: "project", path: "chapters.meta.json", name: "chapters.meta.json", updatedAt: 1710000000 },
  ],
  settingEntries: [
    { section: "settings", path: "1-主角", name: "主角", entryId: "1", updatedAt: 1710000001 },
  ],
  chapterEntries: [
    { section: "chapters", path: "001/第一章", name: "第一章", entryId: "1", updatedAt: 1710000002 },
  ],
} as const;

const settingJson = `${JSON.stringify({
  id: "1",
  name: "主角",
  content: "一名刚踏上旅程的年轻人。",
  notes: "主角信息",
  linkedChapterIds: ["1"],
}, null, 2)}\n`;

const chapterJson = `${JSON.stringify({
  id: "1",
  name: "第一章",
  linkedSettingIds: ["1"],
  outline: "主角接到任务，决定启程。",
  content: "第一章正文",
  notes: "开篇建立目标",
}, null, 2)}\n`;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/expansions/${workspaceId}`]}>
      <TooltipProvider>
        <Routes>
          <Route path="/expansions/:workspaceId" element={<ExpansionDetailPage />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("ExpansionDetailPage", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      switch (command) {
        case "get_expansion_workspace_detail":
          return detail;
        case "read_expansion_entry":
          if (payload?.section === "project") {
            if (payload?.path === "chapters.meta.json") {
              return `${JSON.stringify({ volumes: ["001"] }, null, 2)}\n`;
            }
            return "# AGENTS\n\n- 管理扩写工作区\n";
          }
          if (payload?.section === "settings") {
            return settingJson;
          }
          return chapterJson;
        case "write_expansion_entry":
        case "export_expansion_zip":
          return undefined;
        default:
          return undefined;
      }
    });
  });

  it("会根据当前选中的文件类型切换右侧操作按钮", async () => {
    renderPage();

    expect(await screen.findByText("工作区操作")).toBeInTheDocument();
    expect(screen.getByText("正在打开")).toBeInTheDocument();
    expect(screen.getAllByText("AGENTS.md").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "批量生成细纲" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量生成设定" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "章节写作" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "主角" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "更新设定" })).toBeInTheDocument();
    });

    expect(screen.getAllByText("主角").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "批量生成细纲" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "章节写作" })).not.toBeInTheDocument();

    expect(screen.getByText("第一卷")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "第 1 章 · 第一章" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "章节写作" })).toBeInTheDocument();
    });

    expect(screen.getAllByText("第一章").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "设定更新" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量生成细纲" })).not.toBeInTheDocument();
    expect(screen.queryByText("基础信息")).not.toBeInTheDocument();
    expect(screen.queryByText("章节 ID")).not.toBeInTheDocument();
    expect(screen.queryByText("名称")).not.toBeInTheDocument();

    const outlineTitle = screen.getByText("细纲");
    const contentTitle = screen.getByText("正文");
    const notesTitle = screen.getByText("备注");
    const linkedSettingsTitle = screen.getByText("关联设定 ID（逗号分隔）");

    expect(outlineTitle.compareDocumentPosition(contentTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(contentTitle.compareDocumentPosition(notesTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notesTitle.compareDocumentPosition(linkedSettingsTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.queryByText("触发工作区操作后，这里会持续记录真实执行步骤。")).not.toBeInTheDocument();
  });

  it("设定编辑器只展示内容备注和关联正文", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "主角" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "更新设定" })).toBeInTheDocument();
    });

    expect(screen.queryByText("基础信息")).not.toBeInTheDocument();
    expect(screen.queryByText("设定 ID")).not.toBeInTheDocument();
    expect(screen.queryByText("名称")).not.toBeInTheDocument();

    const contentTitle = screen.getByText("内容");
    const notesTitle = screen.getByText("备注");
    const linkedChaptersTitle = screen.getByText("关联正文 ID（逗号分隔）");

    expect(contentTitle.compareDocumentPosition(notesTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notesTitle.compareDocumentPosition(linkedChaptersTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("批量生成细纲会先展示分卷选择弹窗", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: "批量生成细纲" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "批量生成细纲" }));

    expect(await screen.findByText("选择已有分卷")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第一卷" })).toBeInTheDocument();
    expect(screen.queryByLabelText("目标分卷编号")).not.toBeInTheDocument();
  });
});
