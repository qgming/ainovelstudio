import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDetail } from "../lib/workflow/types";
import { useWorkflowStore } from "./workflowStore";

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

const workflowId = "workflow-1";
const runId = "run-1";
const stepRunId = "step-run-1";

function createDetail(): WorkflowDetail {
  return {
    workflow: {
      id: workflowId,
      name: "自动小说",
      description: "",
      basePrompt: "",
      source: "user",
      templateKey: null,
      createdAt: 1,
      updatedAt: 1,
      workspaceBinding: {
        workflowId,
        bookId: "book-1",
        rootPath: "C:/books/demo",
        bookName: "演示书籍",
        boundAt: 1,
      },
      loopConfig: { maxLoops: 1 },
      teamMemberIds: [],
      stepIds: [],
      lastRunId: runId,
      lastRunStatus: "running",
    },
    teamMembers: [],
    steps: [],
    runs: [
      {
        id: runId,
        workflowId,
        status: "running",
        startedAt: 1,
        finishedAt: null,
        workspaceBinding: {
          workflowId,
          bookId: "book-1",
          rootPath: "C:/books/demo",
          bookName: "演示书籍",
          boundAt: 1,
        },
        loopConfigSnapshot: { maxLoops: 1 },
        currentLoopIndex: 1,
        maxLoops: 1,
        currentStepRunId: stepRunId,
        stopReason: null,
        summary: null,
        errorMessage: null,
      },
    ],
    stepRuns: [
      {
        id: stepRunId,
        runId,
        workflowId,
        stepId: "step-1",
        loopIndex: 1,
        attemptIndex: 1,
        memberId: "member-1",
        status: "running",
        startedAt: 1,
        finishedAt: null,
        inputPrompt: "请执行",
        resultText: "",
        resultJson: null,
        messageType: null,
        messageJson: null,
        decision: null,
        parts: [],
        usage: null,
        errorMessage: null,
      },
    ],
  };
}

describe("workflowStore", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useWorkflowStore.setState({
      workflows: [],
      currentDetail: null,
      selectedStepRunId: null,
      status: "idle",
      errorMessage: null,
      isRunning: false,
      activeRunId: null,
      abortController: null,
      inflightToolRequestIds: [],
      finishAfterCurrentLoopRequested: false,
      stopRequested: false,
    });
  });

  it("requestStopRun 会中止当前运行、取消工具请求并保留暂停进度", async () => {
    const abortController = new AbortController();

    useWorkflowStore.setState({
      currentDetail: createDetail(),
      selectedStepRunId: stepRunId,
      isRunning: true,
      activeRunId: runId,
      abortController,
      inflightToolRequestIds: ["tool-read-1", "tool-write-2"],
      finishAfterCurrentLoopRequested: false,
    });

    await useWorkflowStore.getState().requestStopRun();

    expect(abortController.signal.aborted).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("cancel_tool_requests", {
      requestIds: ["tool-read-1", "tool-write-2"],
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      "save_workflow_run",
      expect.objectContaining({
        run: expect.objectContaining({
          id: runId,
          status: "paused",
          stopReason: "paused",
        }),
      }),
    );
    expect(mockInvoke).toHaveBeenCalledWith(
      "save_workflow_step_run",
      expect.objectContaining({
        stepRun: expect.objectContaining({
          id: stepRunId,
          status: "failed",
        }),
      }),
    );
    expect(mockInvoke).not.toHaveBeenCalledWith(
      "delete_workflow_run",
      expect.anything(),
    );

    const state = useWorkflowStore.getState();
    expect(state.activeRunId).toBeNull();
    expect(state.isRunning).toBe(false);
    expect(state.abortController).toBeNull();
    expect(state.inflightToolRequestIds).toEqual([]);
    expect(state.stopRequested).toBe(true);
    expect(state.currentDetail?.runs[0]).toMatchObject({
      id: runId,
      status: "paused",
      stopReason: "paused",
    });
    expect(state.currentDetail?.stepRuns[0]).toMatchObject({
      id: stepRunId,
      status: "failed",
    });
    expect(state.selectedStepRunId).toBe(stepRunId);
    expect(state.currentDetail?.workflow.lastRunId).toBe(runId);
    expect(state.currentDetail?.workflow.lastRunStatus).toBe("paused");
  });
});
