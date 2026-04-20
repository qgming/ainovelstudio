import { create } from "zustand";
import { cancelToolRequests } from "../lib/bookWorkspace/api";
import {
  addWorkflowAgentStep,
  addWorkflowStep,
  addWorkflowTeamMember,
  bindWorkflowWorkspace,
  createWorkflow,
  deleteWorkflow as deleteWorkflowApi,
  exportWorkflowZip as exportWorkflowZipApi,
  getWorkflowDetail,
  initializeBuiltinWorkflows,
  listWorkflows,
  parseWorkflowReviewResult,
  removeWorkflowStep,
  removeWorkflowTeamMember,
  reorderWorkflowSteps,
  reorderWorkflowTeamMembers,
  saveWorkflowBasics,
  saveWorkflowRun,
  saveWorkflowStepRun,
  updateWorkflowLoopConfig,
  updateWorkflowStep,
  updateWorkflowTeamMember,
  type WorkflowBasicsInput,
} from "../lib/workflow/api";
import type {
  Workflow,
  WorkflowDetail,
  WorkflowLoopConfig,
  WorkflowReviewResult,
  WorkflowRun,
  WorkflowStepDefinition,
  WorkflowStepInput,
  WorkflowStepRun,
  WorkflowTeamMember,
  WorkflowWorkspaceBinding,
} from "../lib/workflow/types";

function formatWorkflowError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  return fallbackMessage;
}

type WorkflowStoreState = {
  workflows: Workflow[];
  currentDetail: WorkflowDetail | null;
  selectedStepRunId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  errorMessage: string | null;
  isRunning: boolean;
  activeRunId: string | null;
  abortController: AbortController | null;
  inflightToolRequestIds: string[];
  stopRequested: boolean;
};

type WorkflowStoreActions = {
  initialize: () => Promise<void>;
  refreshList: () => Promise<void>;
  createWorkflow: (name: string) => Promise<Workflow>;
  exportWorkflowZip: (workflowId: string) => Promise<string | null>;
  deleteWorkflowById: (workflowId: string) => Promise<void>;
  loadWorkflowDetail: (workflowId: string) => Promise<void>;
  saveWorkflowBasics: (workflowId: string, payload: WorkflowBasicsInput) => Promise<void>;
  bindWorkspace: (workflowId: string, binding: Omit<WorkflowWorkspaceBinding, "workflowId" | "boundAt">) => Promise<void>;
  updateLoopConfig: (workflowId: string, loopConfig: WorkflowLoopConfig) => Promise<void>;
  addTeamMember: (
    workflowId: string,
    payload: Pick<WorkflowTeamMember, "agentId" | "name" | "roleLabel" | "responsibilityPrompt" | "allowedToolIds">,
  ) => Promise<void>;
  updateTeamMember: (
    workflowId: string,
    memberId: string,
    payload: Partial<Pick<WorkflowTeamMember, "agentId" | "name" | "roleLabel" | "responsibilityPrompt" | "allowedToolIds">>,
  ) => Promise<void>;
  removeTeamMember: (workflowId: string, memberId: string) => Promise<void>;
  reorderTeamMembers: (workflowId: string, orderedMemberIds: string[]) => Promise<void>;
  addStep: (workflowId: string, step: WorkflowStepInput) => Promise<void>;
  addAgentStep: (workflowId: string, agentId: string, agentName: string) => Promise<void>;
  updateStep: (workflowId: string, stepId: string, payload: Partial<WorkflowStepDefinition>) => Promise<void>;
  removeStep: (workflowId: string, stepId: string) => Promise<void>;
  reorderSteps: (workflowId: string, orderedStepIds: string[]) => Promise<void>;
  saveRun: (run: WorkflowRun) => Promise<void>;
  saveStepRun: (stepRun: WorkflowStepRun) => Promise<void>;
  selectStepRun: (stepRunId: string | null) => void;
  setRunningState: (status: {
    activeRunId: string | null;
    isRunning: boolean;
    stopRequested?: boolean;
    abortController?: AbortController | null;
    inflightToolRequestIds?: string[];
  }) => void;
  trackInflightToolRequest: (requestId: string, action: "start" | "finish") => void;
  requestStopRun: () => Promise<void>;
  clearStopRequest: () => void;
  parseReviewResult: (text: string) => WorkflowReviewResult | null;
};

export type WorkflowStore = WorkflowStoreState & WorkflowStoreActions;

function buildInitialState(): WorkflowStoreState {
  return {
    workflows: [],
    currentDetail: null,
    selectedStepRunId: null,
    status: "idle",
    errorMessage: null,
    isRunning: false,
    activeRunId: null,
    abortController: null,
    inflightToolRequestIds: [],
    stopRequested: false,
  };
}

function updatePausedRunInDetail(
  detail: WorkflowDetail | null,
  runId: string,
  selectedStepRunId: string | null,
) {
  if (!detail) {
    return {
      currentDetail: detail,
      selectedStepRunId,
    };
  }

  const now = Date.now();
  const nextDetail: WorkflowDetail = {
    ...detail,
    workflow: {
      ...detail.workflow,
      lastRunId: runId,
      lastRunStatus: "paused",
    },
    runs: detail.runs.map((run) =>
      run.id === runId
        ? {
            ...run,
            errorMessage: null,
            finishedAt: now,
            status: "paused",
            stopReason: "paused",
            summary: "工作流已暂停，可稍后从当前进度继续。",
          }
        : run,
    ),
    stepRuns: detail.stepRuns.map((stepRun) =>
      stepRun.runId === runId && stepRun.status === "running"
        ? {
            ...stepRun,
            errorMessage: "工作流已暂停，继续时会重新执行该步骤。",
            finishedAt: now,
            status: "failed",
          }
        : stepRun,
    ),
  };

  return {
    currentDetail: nextDetail,
    selectedStepRunId,
  };
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  ...buildInitialState(),
  initialize: async () => {
    if (get().status === "ready" || get().status === "loading") {
      return;
    }
    set({ status: "loading", errorMessage: null });
    try {
      await initializeBuiltinWorkflows();
      const workflows = await listWorkflows();
      set({ workflows, status: "ready", errorMessage: null });
    } catch (error) {
      set({ status: "error", errorMessage: formatWorkflowError(error, "加载工作流列表失败。") });
    }
  },
  refreshList: async () => {
    set({ status: "loading", errorMessage: null });
    try {
      await initializeBuiltinWorkflows();
      const workflows = await listWorkflows();
      set({ workflows, status: "ready", errorMessage: null });
    } catch (error) {
      set({ status: "error", errorMessage: formatWorkflowError(error, "刷新工作流列表失败。") });
    }
  },
  createWorkflow: async (name) => {
    const workflow = await createWorkflow(name);
    const workflows = await listWorkflows();
    set({ workflows, status: "ready", errorMessage: null });
    return workflow;
  },
  exportWorkflowZip: async (workflowId) => {
    try {
      const savedPath = await exportWorkflowZipApi(workflowId);
      set((state) => ({ ...state, errorMessage: null }));
      return savedPath;
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatWorkflowError(error, "导出工作流失败。"),
      }));
      throw error;
    }
  },
  deleteWorkflowById: async (workflowId) => {
    try {
      await deleteWorkflowApi(workflowId);
      const workflows = await listWorkflows();
      set((state) => ({
        ...state,
        workflows,
        currentDetail: state.currentDetail?.workflow.id === workflowId ? null : state.currentDetail,
        selectedStepRunId: state.currentDetail?.workflow.id === workflowId ? null : state.selectedStepRunId,
        errorMessage: null,
        status: "ready",
      }));
    } catch (error) {
      set((state) => ({
        ...state,
        errorMessage: formatWorkflowError(error, "删除工作流失败。"),
      }));
      throw error;
    }
  },
  loadWorkflowDetail: async (workflowId) => {
    set({ status: "loading", errorMessage: null, currentDetail: null, selectedStepRunId: null });
    try {
      const [workflows, detail] = await Promise.all([listWorkflows(), getWorkflowDetail(workflowId)]);
      set({
        workflows,
        currentDetail: detail,
        selectedStepRunId: detail.stepRuns[0]?.id ?? null,
        status: "ready",
        errorMessage: null,
      });
    } catch (error) {
      try {
        await initializeBuiltinWorkflows();
        const [workflows, detail] = await Promise.all([listWorkflows(), getWorkflowDetail(workflowId)]);
        set({
          workflows,
          currentDetail: detail,
          selectedStepRunId: detail.stepRuns[0]?.id ?? null,
          status: "ready",
          errorMessage: null,
        });
        return;
      } catch {
        try {
          const workflows = await listWorkflows();
          set({
            workflows,
            currentDetail: null,
            selectedStepRunId: null,
            status: "error",
            errorMessage: formatWorkflowError(error, "加载工作流详情失败。"),
          });
        } catch {
          set({
            currentDetail: null,
            selectedStepRunId: null,
            status: "error",
            errorMessage: formatWorkflowError(error, "加载工作流详情失败。"),
          });
        }
      }
    }
  },
  saveWorkflowBasics: async (workflowId, payload) => {
    const detail = await saveWorkflowBasics(workflowId, payload);
    const workflows = await listWorkflows();
    set({ workflows, currentDetail: detail, errorMessage: null, status: "ready" });
  },
  bindWorkspace: async (workflowId, binding) => {
    const detail = await bindWorkflowWorkspace(workflowId, binding);
    const workflows = await listWorkflows();
    set({ workflows, currentDetail: detail, errorMessage: null, status: "ready" });
  },
  updateLoopConfig: async (workflowId, loopConfig) => {
    const detail = await updateWorkflowLoopConfig(workflowId, loopConfig);
    const workflows = await listWorkflows();
    set({ workflows, currentDetail: detail, errorMessage: null, status: "ready" });
  },
  addTeamMember: async (workflowId, payload) => {
    const detail = await addWorkflowTeamMember(workflowId, payload);
    const workflows = await listWorkflows();
    set({ workflows, currentDetail: detail, errorMessage: null, status: "ready" });
  },
  updateTeamMember: async (workflowId, memberId, payload) => {
    const detail = await updateWorkflowTeamMember(workflowId, memberId, payload);
    set({ currentDetail: detail, errorMessage: null, status: "ready" });
  },
  removeTeamMember: async (workflowId, memberId) => {
    const detail = await removeWorkflowTeamMember(workflowId, memberId);
    set({ currentDetail: detail, errorMessage: null, status: "ready" });
  },
  reorderTeamMembers: async (workflowId, orderedMemberIds) => {
    const detail = await reorderWorkflowTeamMembers(workflowId, orderedMemberIds);
    set({ currentDetail: detail, errorMessage: null, status: "ready" });
  },
  addStep: async (workflowId, step) => {
    const detail = await addWorkflowStep(workflowId, step);
    set({ currentDetail: detail, errorMessage: null, status: "ready" });
  },
  addAgentStep: async (workflowId, agentId, agentName) => {
    const detail = await addWorkflowAgentStep(workflowId, agentId, agentName);
    set({ currentDetail: detail, errorMessage: null, status: "ready" });
  },
  updateStep: async (workflowId, stepId, payload) => {
    const detail = await updateWorkflowStep(workflowId, stepId, payload);
    set({ currentDetail: detail, errorMessage: null, status: "ready" });
  },
  removeStep: async (workflowId, stepId) => {
    const detail = await removeWorkflowStep(workflowId, stepId);
    set({ currentDetail: detail, errorMessage: null, status: "ready" });
  },
  reorderSteps: async (workflowId, orderedStepIds) => {
    const detail = await reorderWorkflowSteps(workflowId, orderedStepIds);
    set({ currentDetail: detail, errorMessage: null, status: "ready" });
  },
  saveRun: async (run) => {
    await saveWorkflowRun(run);
    const detail = await getWorkflowDetail(run.workflowId);
    set((state) => ({
      currentDetail: detail,
      selectedStepRunId: state.selectedStepRunId ?? detail.stepRuns[0]?.id ?? null,
      errorMessage: null,
      status: "ready",
    }));
  },
  saveStepRun: async (stepRun) => {
    await saveWorkflowStepRun(stepRun);
    const detail = await getWorkflowDetail(stepRun.workflowId);
    set({
      currentDetail: detail,
      selectedStepRunId: stepRun.id,
      errorMessage: null,
      status: "ready",
    });
  },
  selectStepRun: (stepRunId) => set({ selectedStepRunId: stepRunId }),
  setRunningState: ({
    activeRunId,
    isRunning,
    stopRequested = false,
    abortController,
    inflightToolRequestIds,
  }) =>
    set((state) => ({
      activeRunId,
      isRunning,
      stopRequested,
      abortController:
        abortController === undefined ? state.abortController : abortController,
      inflightToolRequestIds:
        inflightToolRequestIds === undefined ? state.inflightToolRequestIds : inflightToolRequestIds,
    })),
  trackInflightToolRequest: (requestId, action) =>
    set((state) => ({
      inflightToolRequestIds:
        action === "start"
          ? Array.from(new Set([...state.inflightToolRequestIds, requestId]))
          : state.inflightToolRequestIds.filter((candidate) => candidate !== requestId),
    })),
  requestStopRun: async () => {
    const state = get();
    const runId = state.activeRunId;
    if (!runId) {
      set({
        stopRequested: true,
        isRunning: false,
        abortController: null,
        inflightToolRequestIds: [],
      });
      return;
    }

    state.abortController?.abort();
    const requestIds = [...state.inflightToolRequestIds];
    set((current) => ({
      ...updatePausedRunInDetail(current.currentDetail, runId, current.selectedStepRunId),
      activeRunId: null,
      isRunning: false,
      abortController: null,
      inflightToolRequestIds: [],
      stopRequested: true,
    }));

    const pausedRun = get().currentDetail?.runs.find((run) => run.id === runId);
    const failedStepRuns =
      get().currentDetail?.stepRuns.filter(
        (stepRun) => stepRun.runId === runId && stepRun.status === "failed",
      ) ?? [];
    await Promise.allSettled([
      cancelToolRequests(requestIds),
      pausedRun ? saveWorkflowRun(pausedRun) : Promise.resolve(),
      ...failedStepRuns.map((stepRun) => saveWorkflowStepRun(stepRun)),
    ]);
  },
  clearStopRequest: () => set({ stopRequested: false }),
  parseReviewResult: (text) => parseWorkflowReviewResult(text),
}));
