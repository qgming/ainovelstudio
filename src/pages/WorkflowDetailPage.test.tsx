import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowBasicsInput } from "../lib/workflow/api";
import type {
  WorkflowDetail,
  WorkflowStepDefinition,
  WorkflowWorkspaceBinding,
} from "../lib/workflow/types";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../lib/workflow/engine", () => ({
  resumeWorkflowRun: vi.fn(),
  startWorkflowRun: vi.fn(),
}));

import { WorkflowDetailPage } from "./WorkflowDetailPage";
import { resumeWorkflowRun, startWorkflowRun } from "../lib/workflow/engine";
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

function createWorkflowDetail(steps: WorkflowDetail["steps"] = [
  {
    id: "step-start",
    workflowId,
    type: "start",
    name: "开始",
    order: 0,
    nextStepId: null,
  },
]): WorkflowDetail {
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
      stepIds: steps.map((step) => step.id),
      lastRunId: null,
      lastRunStatus: "idle",
    },
    teamMembers: [],
    steps,
    runs: [],
    stepRuns: [],
  };
}

function createPausedWorkflowDetail() {
  const detail = createWorkflowDetail();
  return {
    ...detail,
    workflow: {
      ...detail.workflow,
      lastRunId: "run-paused",
      lastRunStatus: "paused" as const,
    },
    runs: [
      {
        id: "run-paused",
        workflowId,
        status: "paused" as const,
        startedAt: 1710000000000,
        finishedAt: 1710000001000,
        workspaceBinding: initialBinding,
        loopConfigSnapshot: { maxLoops: 1 },
        currentLoopIndex: 1,
        maxLoops: 1,
        currentStepRunId: null,
        stopReason: "paused" as const,
        summary: "工作流已暂停，可稍后从当前进度继续。",
        errorMessage: null,
      },
    ],
  } satisfies WorkflowDetail;
}

type RenderPageOverrides = {
  bindWorkspace?: (
    workflowId: string,
    binding: Omit<WorkflowWorkspaceBinding, "workflowId" | "boundAt">,
  ) => Promise<void>;
  saveWorkflowBasics?: (
    workflowId: string,
    payload: WorkflowBasicsInput,
  ) => Promise<void>;
  updateStep?: (
    workflowId: string,
    stepId: string,
    payload: Partial<WorkflowStepDefinition>,
  ) => Promise<void>;
};

describe("WorkflowDetailPage", () => {
  beforeEach(() => {
    mockViewport(1280);
    mockInvoke.mockReset();
    vi.mocked(resumeWorkflowRun).mockReset();
    vi.mocked(startWorkflowRun).mockReset();
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

  function renderPage(detail: WorkflowDetail, overrides?: RenderPageOverrides) {
    const loadWorkflowDetail = vi.fn(async () => undefined);
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
      finishAfterCurrentLoopRequested: false,
      stopRequested: false,
      loadWorkflowDetail,
      saveWorkflowBasics: overrides?.saveWorkflowBasics ?? vi.fn(async () => undefined),
      bindWorkspace: overrides?.bindWorkspace ?? vi.fn(async () => undefined),
      updateLoopConfig: vi.fn(async () => undefined),
      addTeamMember: vi.fn(async () => undefined),
      updateTeamMember: vi.fn(async () => undefined),
      removeTeamMember: vi.fn(async () => undefined),
      addAgentStep: vi.fn(async () => undefined),
      updateStep: overrides?.updateStep ?? vi.fn(async () => undefined),
      removeStep: vi.fn(async () => undefined),
      reorderSteps: vi.fn(async () => undefined),
      selectStepRun: vi.fn(),
      requestFinishAfterCurrentLoop: vi.fn(),
      requestStopRun: vi.fn(async () => undefined),
      clearFinishAfterCurrentLoopRequest: vi.fn(),
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

    return { loadWorkflowDetail };
  }

  it("更换书籍时会自动保存左侧基本设置", async () => {
    const detail = createWorkflowDetail();
    const saveWorkflowBasics = vi.fn(async () => undefined);
    const bindWorkspace = vi.fn(async () => undefined);
    const { loadWorkflowDetail } = renderPage(detail, { saveWorkflowBasics, bindWorkspace });

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

  it("切换节点时保留未保存草稿且不会自动保存", async () => {
    const detail = createWorkflowDetail([
      {
        id: "step-start",
        workflowId,
        type: "start",
        name: "开始节点",
        order: 0,
        nextStepId: "step-end",
      },
      {
        id: "step-end",
        workflowId,
        type: "end",
        name: "结束节点",
        order: 1,
        stopReason: "completed",
        summaryTemplate: "",
        loopBehavior: "finish",
        loopTargetStepId: null,
      },
    ]);
    const updateStep = vi.fn(async () => undefined);

    renderPage(detail, { updateStep });

    fireEvent.change(screen.getByDisplayValue("开始节点"), {
      target: { value: "开始节点草稿" },
    });

    expect(screen.getByText("当前有未保存的节点改动。点击右上角保存后才会写回工作流。")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("结束节点")[0]);
    expect(await screen.findByDisplayValue("结束节点")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("开始节点")[0]);

    expect(await screen.findByDisplayValue("开始节点草稿")).toBeInTheDocument();
    expect(updateStep).not.toHaveBeenCalled();
  });

  it("移动端使用专属底部栏切换设置、工作流和运行面板", async () => {
    mockViewport(390);
    const detail = createWorkflowDetail();

    renderPage(detail);

    const mobileNav = await screen.findByRole("navigation", { name: "工作流详情导航" });
    expect(mobileNav).toBeInTheDocument();
    expect(within(mobileNav).getByText("工作流")).toBeInTheDocument();

    fireEvent.click(within(mobileNav).getByRole("button", { name: "设置" }));
    expect(screen.getByText("基本设置")).toBeInTheDocument();

    fireEvent.click(within(mobileNav).getByRole("button", { name: "运行" }));
    expect(screen.getByText("运行后，这里会显示执行时间线。")).toBeInTheDocument();
  });

  it("存在暂停运行时显示继续与重新运行操作", async () => {
    const detail = createPausedWorkflowDetail();
    renderPage(detail);

    fireEvent.click(await screen.findByRole("button", { name: "继续" }));

    await waitFor(() => {
      expect(resumeWorkflowRun).toHaveBeenCalledWith(workflowId, "run-paused");
    });
    expect(screen.getByRole("button", { name: "重新运行" })).toBeInTheDocument();
    expect(startWorkflowRun).not.toHaveBeenCalled();
  });

  it("运行中显示本轮后结束按钮，并在已请求后禁用", async () => {
    const detail = createWorkflowDetail();
    const requestFinishAfterCurrentLoop = vi.fn();
    useWorkflowStore.setState({
      workflows: [detail.workflow],
      currentDetail: detail,
      selectedStepRunId: null,
      status: "ready",
      errorMessage: null,
      isRunning: true,
      activeRunId: "run-active",
      abortController: null,
      inflightToolRequestIds: [],
      finishAfterCurrentLoopRequested: false,
      stopRequested: false,
      loadWorkflowDetail: vi.fn(async () => undefined),
      saveWorkflowBasics: vi.fn(async () => undefined),
      bindWorkspace: vi.fn(async () => undefined),
      updateLoopConfig: vi.fn(async () => undefined),
      addTeamMember: vi.fn(async () => undefined),
      updateTeamMember: vi.fn(async () => undefined),
      removeTeamMember: vi.fn(async () => undefined),
      updateStep: vi.fn(async () => undefined),
      removeStep: vi.fn(async () => undefined),
      reorderSteps: vi.fn(async () => undefined),
      saveRun: vi.fn(async () => undefined),
      saveStepRun: vi.fn(async () => undefined),
      selectStepRun: vi.fn(),
      setRunningState: vi.fn(),
      trackInflightToolRequest: vi.fn(),
      requestFinishAfterCurrentLoop,
      requestStopRun: vi.fn(async () => undefined),
      clearFinishAfterCurrentLoopRequest: vi.fn(),
      clearStopRequest: vi.fn(),
      parseReviewResult: vi.fn(() => null),
      initialize: vi.fn(async () => undefined),
      refreshList: vi.fn(async () => undefined),
      createWorkflow: vi.fn(async () => detail.workflow),
      exportWorkflowZip: vi.fn(async () => null),
      deleteWorkflowById: vi.fn(async () => undefined),
      addStep: vi.fn(async () => undefined),
      addAgentStep: vi.fn(async () => undefined),
    });

    render(
      <MemoryRouter initialEntries={[`/workflows/${workflowId}`]}>
        <Routes>
          <Route path="/workflows/:workflowId" element={<WorkflowDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "本轮后结束" }));
    expect(requestFinishAfterCurrentLoop).toHaveBeenCalledTimes(1);

    useWorkflowStore.setState({ finishAfterCurrentLoopRequested: true });

    expect(await screen.findByRole("button", { name: "本轮后结束中" })).toBeDisabled();
  });
});
