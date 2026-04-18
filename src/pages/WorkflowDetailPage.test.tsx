import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDetail } from "../lib/workflow/types";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../lib/workflow/engine", () => ({
  startWorkflowRun: vi.fn(),
}));

import { WorkflowDetailPage } from "./WorkflowDetailPage";
import { useSubAgentStore } from "../stores/subAgentStore";
import { useWorkflowStore } from "../stores/workflowStore";

const workflowId = "workflow-1";
const initialBinding = {
  workflowId,
  bookId: "book-1",
  rootPath: "C:/books/北境余烬",
  bookName: "北境余烬",
  boundAt: 1710000000000,
} as const;

function createWorkflowDetail(): WorkflowDetail {
  return {
    workflow: {
      id: workflowId,
      name: "测试工作流",
      description: "",
      basePrompt: "",
      source: "user",
      templateKey: null,
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
      workspaceBinding: initialBinding,
      loopConfig: { maxLoops: 1 },
      teamMemberIds: [],
      stepIds: ["step-start"],
      lastRunId: null,
      lastRunStatus: "idle",
    },
    teamMembers: [],
    steps: [
      {
        id: "step-start",
        workflowId,
        type: "start",
        name: "开始",
        order: 0,
        nextStepId: null,
      },
    ],
    runs: [],
    stepRuns: [],
  };
}

describe("WorkflowDetailPage", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === "list_book_workspaces") {
        return [
          { id: "book-1", name: "北境余烬", path: "C:/books/北境余烬", updatedAt: 1710000000000 },
          { id: "book-2", name: "星河回声", path: "C:/books/星河回声", updatedAt: 1710000001000 },
        ];
      }
      return undefined;
    });
  });

  it("更换书籍时会自动保存左侧基本设置", async () => {
    const detail = createWorkflowDetail();
    const loadWorkflowDetail = vi.fn(async () => undefined);
    const saveWorkflowBasics = vi.fn(async () => undefined);
    const bindWorkspace = vi.fn(async () => undefined);

    useWorkflowStore.setState({
      workflows: [detail.workflow],
      currentDetail: detail,
      selectedStepRunId: null,
      status: "ready",
      errorMessage: null,
      isRunning: false,
      activeRunId: null,
      abortController: null,
      inflightToolRequestIds: [],
      stopRequested: false,
      loadWorkflowDetail,
      saveWorkflowBasics,
      bindWorkspace,
      updateLoopConfig: vi.fn(async () => undefined),
      addTeamMember: vi.fn(async () => undefined),
      updateTeamMember: vi.fn(async () => undefined),
      removeTeamMember: vi.fn(async () => undefined),
      addAgentStep: vi.fn(async () => undefined),
      updateStep: vi.fn(async () => undefined),
      removeStep: vi.fn(async () => undefined),
      reorderSteps: vi.fn(async () => undefined),
      selectStepRun: vi.fn(),
      requestStopRun: vi.fn(async () => undefined),
    });
    useSubAgentStore.setState({
      status: "ready",
      manifests: [],
      preferences: { enabledById: {} },
      errorMessage: null,
      lastScannedAt: null,
      initialize: vi.fn(async () => undefined),
    });

    render(
      <MemoryRouter initialEntries={[`/workflows/${workflowId}`]}>
        <Routes>
          <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByDisplayValue("测试工作流"), {
      target: { value: "切换书籍后自动保存" },
    });

    fireEvent.click(screen.getByRole("button", { name: "更换绑定书籍" }));
    fireEvent.click(await screen.findByRole("button", { name: "星河回声" }));

    await waitFor(() => {
      expect(saveWorkflowBasics).toHaveBeenCalledWith(workflowId, {
        name: "切换书籍后自动保存",
        basePrompt: "",
      });
    });

    await waitFor(() => {
      expect(bindWorkspace).toHaveBeenCalledWith(workflowId, {
        bookId: "book-2",
        rootPath: "C:/books/星河回声",
        bookName: "星河回声",
      });
    });

    expect(loadWorkflowDetail).toHaveBeenCalledWith(workflowId);
  });
});
