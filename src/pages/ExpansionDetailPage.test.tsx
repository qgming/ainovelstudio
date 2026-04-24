import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    { section: "project", path: "settings.meta.json", name: "settings.meta.json", updatedAt: 1710000000 },
  ],
  settingEntries: [
    { section: "settings", path: "人物/1-主角", name: "主角", entryId: "1", updatedAt: 1710000001 },
  ],
  chapterEntries: [
    { section: "chapters", path: "001/第一章", name: "第一章", entryId: "1", updatedAt: 1710000002 },
  ],
} as const;

const settingJson = `${JSON.stringify({
  id: "1",
  name: "主角",
  content: "一名刚踏上旅程的年轻人。",
}, null, 2)}\n`;

const chapterJson = `${JSON.stringify({
  id: "1",
  name: "第一章",
  outline: "主角接到任务，决定启程。",
  content: "第一章正文",
}, null, 2)}\n`;

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
    mockViewport(1280);
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
            if (payload?.path === "settings.meta.json") {
              return `${JSON.stringify({ categories: ["人物", "世界观"] }, null, 2)}\n`;
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
    expect(screen.getByRole("button", { name: "自由输入" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "章节写作" })).not.toBeInTheDocument();
    expect(screen.getByText("人物")).toBeInTheDocument();
    expect(screen.getByText("世界观")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "在人物内新建设定" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "主角" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "更新设定" })).toBeInTheDocument();
    });

    expect(screen.getAllByText("主角").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "自由输入" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量生成细纲" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "章节写作" })).not.toBeInTheDocument();

    expect(screen.getByText("第一卷")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "第 1 章 · 第一章" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "章节写作" })).toBeInTheDocument();
    });

    expect(screen.getAllByText("第一章").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "设定更新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自由输入" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量生成细纲" })).not.toBeInTheDocument();
    expect(screen.queryByText("基础信息")).not.toBeInTheDocument();
    expect(screen.queryByText("章节 ID")).not.toBeInTheDocument();
    expect(screen.queryByText("名称")).not.toBeInTheDocument();
    expect(screen.queryByText("备注")).not.toBeInTheDocument();
    expect(screen.queryByText("关联设定 ID（逗号分隔）")).not.toBeInTheDocument();
    expect(screen.queryByText("触发工作区操作后，这里会持续记录真实执行步骤。")).not.toBeInTheDocument();
  });

  it("设定编辑器使用整块内容编辑区", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "主角" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "更新设定" })).toBeInTheDocument();
    });

    expect(screen.queryByText("基础信息")).not.toBeInTheDocument();
    expect(screen.queryByText("设定 ID")).not.toBeInTheDocument();
    expect(screen.queryByText("名称")).not.toBeInTheDocument();
    expect(screen.queryByText("内容")).not.toBeInTheDocument();
    expect(screen.queryByText("备注")).not.toBeInTheDocument();
    expect(screen.queryByText("关联正文 ID（逗号分隔）")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("一名刚踏上旅程的年轻人。")).toBeInTheDocument();
  });

  it("批量生成细纲会先展示分卷选择弹窗", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: "批量生成细纲" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "批量生成细纲" }));

    expect(await screen.findByText("选择已有分卷")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "第一卷" })).toBeInTheDocument();
    expect(screen.queryByLabelText("目标分卷编号")).not.toBeInTheDocument();
  });

  it("自由输入按钮会打开提示词输入弹窗", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "自由输入" }));

    expect(await screen.findByLabelText("提示词")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送给 AI" })).toBeInTheDocument();
  });

  it("章节写作会把当前章节细纲注入提示词", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "第 1 章 · 第一章" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "章节写作" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "章节写作" }));

    expect(
      await screen.findByText((_, element) =>
        Boolean(
          element?.tagName.toLowerCase() === "pre" &&
          element?.textContent?.includes("当前章节细纲：") &&
            element.textContent.includes("主角接到任务，决定启程。"),
        ),
      ),
    ).toBeInTheDocument();
  });

  it("章节编辑区使用上下分栏同时显示细纲和正文", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "第 1 章 · 第一章" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "章节写作" })).toBeInTheDocument();
    });

    expect(screen.getByText("细纲")).toBeInTheDocument();
    expect(screen.getByText("正文")).toBeInTheDocument();
    expect(screen.getByText("12 字")).toBeInTheDocument();
    expect(screen.getByText("5 字")).toBeInTheDocument();
    expect(screen.getByDisplayValue("主角接到任务，决定启程。")).toBeInTheDocument();
    expect(screen.getByDisplayValue("第一章正文")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "细纲" })).not.toBeInTheDocument();
  });

  it("章节正文为空时会显示写作提示", async () => {
    mockInvoke.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      switch (command) {
        case "get_expansion_workspace_detail":
          return detail;
        case "read_expansion_entry":
          if (payload?.section === "project") {
            if (payload?.path === "chapters.meta.json") {
              return `${JSON.stringify({ volumes: ["001"] }, null, 2)}\n`;
            }
            if (payload?.path === "settings.meta.json") {
              return `${JSON.stringify({ categories: ["人物", "世界观"] }, null, 2)}\n`;
            }
            return "# AGENTS\n\n- 管理扩写工作区\n";
          }
          if (payload?.section === "settings") {
            return settingJson;
          }
          return `${JSON.stringify({
            id: "1",
            name: "第一章",
            outline: "主角接到任务，决定启程。",
            content: "",
          }, null, 2)}\n`;
        case "write_expansion_entry":
        case "export_expansion_zip":
          return undefined;
        default:
          return undefined;
      }
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "第 1 章 · 第一章" }));

    expect(
      await screen.findByPlaceholderText("当前正文为空。可先补充细纲，再开始写作。"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("主角接到任务，决定启程。")).toBeInTheDocument();
    expect(screen.getByText("12 字")).toBeInTheDocument();
    expect(screen.getByText("0 字")).toBeInTheDocument();
  });

  it("移动端使用专属底部栏切换上下文、编辑和操作面板", async () => {
    mockViewport(390);
    renderPage();

    const mobileNav = await screen.findByRole("navigation", { name: "创作台导航" });
    expect(mobileNav).toBeInTheDocument();
    expect(within(mobileNav).getByText("编辑")).toBeInTheDocument();
    expect(screen.queryByText("工作区操作")).not.toBeInTheDocument();

    fireEvent.click(within(mobileNav).getByRole("button", { name: "上下文" }));
    expect(await screen.findByText("第一卷")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "第 1 章 · 第一章" }));
    expect(await screen.findByDisplayValue("第一章正文")).toBeInTheDocument();

    fireEvent.click(within(mobileNav).getByRole("button", { name: "操作" }));
    expect(await screen.findByText("工作区操作")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "章节写作" })).toBeInTheDocument();
  });
});
