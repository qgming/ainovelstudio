import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { ExpansionDetailPage } from "./ExpansionDetailPage";

const { mockInvoke, mockUseExpansionWorkspaceAgent, mockStopAction } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockUseExpansionWorkspaceAgent: vi.fn(),
  mockStopAction: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../hooks/expansion/useExpansionWorkspaceAgent", async () => {
  const actual = await vi.importActual("../hooks/expansion/useExpansionWorkspaceAgent");
  return {
    ...actual,
    useExpansionWorkspaceAgent: mockUseExpansionWorkspaceAgent,
  };
});

const workspaceId = "expansion-header-test";

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

describe("ExpansionDetailPage header actions", () => {
  beforeEach(() => {
    mockViewport(1280);
    mockInvoke.mockReset();
    mockStopAction.mockReset();
    mockInvoke.mockImplementation(async (command: string, payload?: Record<string, unknown>) => {
      switch (command) {
        case "get_expansion_workspace_detail":
          return {
            id: workspaceId,
            name: "测试创作台",
            updatedAt: 1710000000,
            projectEntries: [
              { section: "project", path: "AGENTS.md", name: "AGENTS.md", updatedAt: 1710000000 },
            ],
            settingEntries: [],
            chapterEntries: [],
          };
        case "read_expansion_entry":
          if (payload?.section === "project") {
            return "# AGENTS\n\n- 管理扩写工作区\n";
          }
          return "";
        default:
          return undefined;
      }
    });
  });

  it("运行中时在顶部状态按钮右侧显示终止按钮并触发 stopAction", async () => {
    mockUseExpansionWorkspaceAgent.mockReturnValue({
      activeTask: {
        actionId: "project-batch-outline",
        actionLabel: "批量生成细纲",
        createdAt: Date.now(),
        description: "测试任务",
        statusLabel: "运行中",
        targetLabel: "测试创作台",
      },
      agentParts: [],
      executionPrompt: "测试提示词",
      runStatus: "running",
      runAction: vi.fn(),
      reset: vi.fn(),
      stopAction: mockStopAction,
      stopRequested: false,
    });

    renderPage();

    const stopButton = await screen.findByRole("button", { name: "终止运行" });
    expect(stopButton).toBeInTheDocument();

    fireEvent.click(stopButton);
    expect(mockStopAction).toHaveBeenCalledTimes(1);
  });

  it("非运行中时不显示顶部终止按钮", async () => {
    mockUseExpansionWorkspaceAgent.mockReturnValue({
      activeTask: null,
      agentParts: [],
      executionPrompt: "",
      runStatus: "idle",
      runAction: vi.fn(),
      reset: vi.fn(),
      stopAction: mockStopAction,
      stopRequested: false,
    });

    renderPage();

    expect(await screen.findByText("空闲")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "终止运行" })).not.toBeInTheDocument();
  });
});
