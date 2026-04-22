import {
  Flag,
  GitBranch,
  Pause,
  Play,
  RotateCcw,
  Settings2,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { BookshelfDialog } from "../components/dialogs/BookshelfDialog";
import { WorkflowBuilderColumn } from "../components/workflow/detail/WorkflowBuilderColumn";
import { WorkflowRunsColumn } from "../components/workflow/detail/WorkflowRunsColumn";
import { WorkflowSettingsColumn } from "../components/workflow/detail/WorkflowSettingsColumn";
import { listBookWorkspaces } from "../lib/bookWorkspace/api";
import { cn } from "../lib/utils";
import { resumeWorkflowRun, startWorkflowRun } from "../lib/workflow/engine";
import { useIsMobile } from "../hooks/use-mobile";
import type {
  WorkflowLoopConfig,
  WorkflowStepDefinition,
  WorkflowStepRun,
  WorkflowStepType,
  WorkflowTeamMember,
  WorkflowWorkspaceBinding,
} from "../lib/workflow/types";
import { getResolvedAgents, useSubAgentStore } from "../stores/subAgentStore";
import { useWorkflowStore } from "../stores/workflowStore";

type StepDraftSnapshot = {
  agentId: string;
  step: WorkflowStepDefinition;
};

type MobileWorkflowTab = "settings" | "workflow" | "runs";

function DetailTitle({ currentLabel }: { currentLabel: string }) {
  return (
    <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
      <Link to="/workflows" className="transition-colors hover:text-muted-foreground">
        工作流库
      </Link>
      <span className="px-1.5 text-muted-foreground">/</span>
      <span>{currentLabel}</span>
    </div>
  );
}

function getReadableError(error: unknown, fallback = "操作失败，请重试。") {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function formatDateTime(value: number | null) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function buildLoopDraft(loopConfig: WorkflowLoopConfig) {
  return {
    maxLoopsMode: loopConfig.maxLoops === null ? "infinite" : "finite",
    maxLoopsValue: loopConfig.maxLoops === null ? "1" : String(loopConfig.maxLoops),
  } as const;
}

function stripWorkspaceBinding(binding: WorkflowWorkspaceBinding | null) {
  if (!binding) {
    return null;
  }
  return {
    bookId: binding.bookId,
    rootPath: binding.rootPath,
    bookName: binding.bookName,
  };
}

function isSameWorkspaceBinding(
  left: ReturnType<typeof stripWorkspaceBinding>,
  right: ReturnType<typeof stripWorkspaceBinding>,
) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.bookId === right.bookId && left.rootPath === right.rootPath && left.bookName === right.bookName;
}

function normalizeLoopValue(mode: "finite" | "infinite", value: string) {
  if (mode === "infinite") {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function isMemberStep(
  step: WorkflowStepDefinition,
): step is Extract<WorkflowStepDefinition, { type: "agent_task" | "decision" }> {
  return step.type === "agent_task" || step.type === "decision";
}

function getMemberById(members: WorkflowTeamMember[], memberId: string | null) {
  if (!memberId) {
    return null;
  }
  return members.find((item) => item.id === memberId) ?? null;
}

function buildHiddenMemberName(agentName: string, members: WorkflowTeamMember[]) {
  const count = members.filter((item) => item.name.startsWith(`${agentName} 节点`)).length + 1;
  return count === 1 ? `${agentName} 节点` : `${agentName} 节点 ${count}`;
}

function formatStepLinks(step: WorkflowStepDefinition, steps: WorkflowStepDefinition[]) {
  const nameById = new Map(steps.map((item) => [item.id, item.name]));
  if (step.type === "start") {
    return `下一步：${step.nextStepId ? nameById.get(step.nextStepId) ?? "未命名节点" : "结束"}`;
  }
  if (step.type === "agent_task") {
    return `下一步：${step.nextStepId ? nameById.get(step.nextStepId) ?? "未命名节点" : "结束"}`;
  }
  if (step.type === "decision") {
    const trueLabel = step.trueNextStepId ? nameById.get(step.trueNextStepId) ?? "未命名节点" : "结束";
    const falseLabel = step.falseNextStepId ? nameById.get(step.falseNextStepId) ?? "未命名节点" : "结束";
    return `通过/是 → ${trueLabel} / 不通过/否 → ${falseLabel}`;
  }
  const loopLabel = step.loopBehavior === "continue_if_possible"
    ? ` / 有下一轮时回到 ${step.loopTargetStepId ? nameById.get(step.loopTargetStepId) ?? "未命名节点" : "未设置"}`
    : "";
  return `结束：${step.stopReason}${loopLabel}`;
}

export function WorkflowDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const isMobile = useIsMobile();
  const currentDetail = useWorkflowStore((state) => state.currentDetail);
  const status = useWorkflowStore((state) => state.status);
  const errorMessage = useWorkflowStore((state) => state.errorMessage);
  const selectedStepRunId = useWorkflowStore((state) => state.selectedStepRunId);
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const activeRunId = useWorkflowStore((state) => state.activeRunId);
  const finishAfterCurrentLoopRequested = useWorkflowStore((state) => state.finishAfterCurrentLoopRequested);
  const loadWorkflowDetail = useWorkflowStore((state) => state.loadWorkflowDetail);
  const saveWorkflowBasics = useWorkflowStore((state) => state.saveWorkflowBasics);
  const bindWorkspace = useWorkflowStore((state) => state.bindWorkspace);
  const updateLoopConfig = useWorkflowStore((state) => state.updateLoopConfig);
  const addTeamMember = useWorkflowStore((state) => state.addTeamMember);
  const updateTeamMember = useWorkflowStore((state) => state.updateTeamMember);
  const removeTeamMember = useWorkflowStore((state) => state.removeTeamMember);
  const addAgentStep = useWorkflowStore((state) => state.addAgentStep);
  const updateStep = useWorkflowStore((state) => state.updateStep);
  const removeStep = useWorkflowStore((state) => state.removeStep);
  const reorderSteps = useWorkflowStore((state) => state.reorderSteps);
  const selectStepRun = useWorkflowStore((state) => state.selectStepRun);
  const requestFinishAfterCurrentLoop = useWorkflowStore((state) => state.requestFinishAfterCurrentLoop);
  const requestStopRun = useWorkflowStore((state) => state.requestStopRun);
  const initializeAgents = useSubAgentStore((state) => state.initialize);
  const agentStatus = useSubAgentStore((state) => state.status);
  const manifests = useSubAgentStore((state) => state.manifests);
  const preferences = useSubAgentStore((state) => state.preferences);
  const agents = useMemo(() => getResolvedAgents({ manifests, preferences }), [manifests, preferences]);

  const [draftName, setDraftName] = useState("");
  const [draftBasePrompt, setDraftBasePrompt] = useState("");
  const [loopDraft, setLoopDraft] = useState(() =>
    buildLoopDraft({
      maxLoops: 1,
    }),
  );
  const [draftWorkspaceBinding, setDraftWorkspaceBinding] = useState<ReturnType<typeof stripWorkspaceBinding>>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [availableBooks, setAvailableBooks] = useState<Awaited<ReturnType<typeof listBookWorkspaces>>>([]);
  const [booksBusy, setBooksBusy] = useState(false);
  const [booksError, setBooksError] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [stepBusy, setStepBusy] = useState<string | null>(null);
  const [pageNotice, setPageNotice] = useState<string | null>(null);
  const [agentQuery, setAgentQuery] = useState("");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [stepDraft, setStepDraft] = useState<WorkflowStepDefinition | null>(null);
  const [stepDraftAgentId, setStepDraftAgentId] = useState("");
  const [stepDraftCache, setStepDraftCache] = useState<Record<string, StepDraftSnapshot>>({});
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
  const [mobileActiveTab, setMobileActiveTab] = useState<MobileWorkflowTab>("workflow");
  const deferredAgentQuery = useDeferredValue(agentQuery.trim().toLowerCase());

  useEffect(() => {
    if (workflowId) {
      void loadWorkflowDetail(workflowId);
    }
  }, [loadWorkflowDetail, workflowId]);

  useEffect(() => {
    if (agentStatus === "idle") {
      void initializeAgents();
    }
  }, [agentStatus, initializeAgents]);

  useEffect(() => {
    setStepDraftCache({});
  }, [workflowId]);

  const detail = currentDetail && currentDetail.workflow.id === workflowId ? currentDetail : null;

  useEffect(() => {
    if (!detail) {
      return;
    }
    setDraftName(detail.workflow.name);
    setDraftBasePrompt(detail.workflow.basePrompt);
    setLoopDraft(buildLoopDraft(detail.workflow.loopConfig));
    setDraftWorkspaceBinding(stripWorkspaceBinding(detail.workflow.workspaceBinding));
    setSelectedStepId((current) =>
      detail.steps.some((item) => item.id === current) ? current : detail.steps[0]?.id ?? null,
    );
    setSelectedRunId((current) =>
      detail.runs.some((item) => item.id === current) ? current : activeRunId ?? detail.runs[0]?.id ?? null,
    );
  }, [activeRunId, detail]);

  const selectedStep = useMemo(() => detail?.steps.find((item) => item.id === selectedStepId) ?? null, [detail, selectedStepId]);
  const selectedRun = useMemo(() => {
    if (!detail) {
      return null;
    }
    const preferredRunId = activeRunId ?? selectedRunId;
    return detail.runs.find((item) => item.id === preferredRunId) ?? detail.runs[0] ?? null;
  }, [activeRunId, detail, selectedRunId]);
  const resumableRun = useMemo(() => {
    if (!detail) {
      return null;
    }
    return (
      detail.runs.find((run) => run.id === selectedRunId && (run.status === "paused" || run.status === "failed"))
      ?? detail.runs.find((run) => run.status === "paused" || run.status === "failed")
      ?? null
    );
  }, [detail, selectedRunId]);
  const selectedRunStepRuns = useMemo(() => {
    if (!detail || !selectedRun) {
      return [] as WorkflowStepRun[];
    }
    return detail.stepRuns.filter((item) => item.runId === selectedRun.id);
  }, [detail, selectedRun]);
  const timelineStepRuns = useMemo(() => selectedRunStepRuns.slice(-20), [selectedRunStepRuns]);
  const selectedStepRun = useMemo(
    () => selectedRunStepRuns.find((item) => item.id === selectedStepRunId) ?? selectedRunStepRuns.at(-1) ?? null,
    [selectedRunStepRuns, selectedStepRunId],
  );
  const filteredAgents = useMemo(() => {
    if (!deferredAgentQuery) {
      return agents;
    }
    return agents.filter((agent) =>
      [agent.name, agent.description, agent.tags.join(" ")].join(" ").toLowerCase().includes(deferredAgentQuery),
    );
  }, [agents, deferredAgentQuery]);
  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const isStepDraftDirty = useMemo(() => {
    if (!selectedStep || !stepDraft) {
      return false;
    }
    const persistedAgentId = isMemberStep(selectedStep) ? getAgentIdForStep(selectedStep) : "";
    const draftAgentId = isMemberStep(stepDraft) ? stepDraftAgentId : "";
    return JSON.stringify(selectedStep) !== JSON.stringify(stepDraft) || persistedAgentId !== draftAgentId;
  }, [selectedStep, stepDraft, stepDraftAgentId]);
  const isBasicsDirty = useMemo(() => {
    if (!detail) {
      return false;
    }
    return detail.workflow.name !== draftName || detail.workflow.basePrompt !== draftBasePrompt;
  }, [detail, draftBasePrompt, draftName]);
  const isLoopConfigDirty = useMemo(() => {
    if (!detail) {
      return false;
    }
    return detail.workflow.loopConfig.maxLoops !== normalizeLoopValue(loopDraft.maxLoopsMode, loopDraft.maxLoopsValue);
  }, [detail, loopDraft.maxLoopsMode, loopDraft.maxLoopsValue]);
  const isWorkspaceBindingDirty = useMemo(() => {
    if (!detail) {
      return false;
    }
    return !isSameWorkspaceBinding(stripWorkspaceBinding(detail.workflow.workspaceBinding), draftWorkspaceBinding);
  }, [detail, draftWorkspaceBinding]);
  const hasSettingsDirty = isBasicsDirty || isLoopConfigDirty || isWorkspaceBindingDirty;

  useEffect(() => {
    if (!selectedStep) {
      setStepDraft(null);
      setStepDraftAgentId("");
      return;
    }
    const cachedDraft = stepDraftCache[selectedStep.id];
    if (cachedDraft) {
      setStepDraft(cachedDraft.step);
      setStepDraftAgentId(cachedDraft.agentId);
      return;
    }
    setStepDraft(selectedStep);
    setStepDraftAgentId(isMemberStep(selectedStep) ? getAgentIdForStep(selectedStep) : "");
  }, [selectedStep, stepDraftCache, detail]);

  useEffect(() => {
    setIsPromptExpanded(false);
  }, [selectedStepRun?.id]);

  function getAgentIdForStep(step: Extract<WorkflowStepDefinition, { type: "agent_task" | "decision" }>) {
    return getMemberById(detail?.teamMembers ?? [], step.memberId)?.agentId ?? "";
  }

  function getAgentName(agentId: string | null) {
    if (!agentId) {
      return "系统";
    }
    return agentById.get(agentId)?.name ?? agentId;
  }

  function getStepAgentLabel(step: WorkflowStepDefinition) {
    if (!isMemberStep(step)) {
      return "系统";
    }
    return getAgentName(getAgentIdForStep(step));
  }

  function countMemberUsage(memberId: string) {
    return detail?.steps.filter((item) => isMemberStep(item) && item.memberId === memberId).length ?? 0;
  }

  function rememberStepDraft(stepId: string, nextStep: WorkflowStepDefinition, nextAgentId: string) {
    setStepDraftCache((current) => ({
      ...current,
      [stepId]: {
        step: nextStep,
        agentId: nextAgentId,
      },
    }));
  }

  function clearStepDraft(stepId: string) {
    setStepDraftCache((current) => {
      if (!(stepId in current)) {
        return current;
      }
      const nextCache = { ...current };
      delete nextCache[stepId];
      return nextCache;
    });
  }

  function updateCurrentStepDraft(nextStep: WorkflowStepDefinition, nextAgentId?: string) {
    if (!selectedStep) {
      return;
    }
    const resolvedAgentId = isMemberStep(nextStep) ? (nextAgentId ?? stepDraftAgentId) : "";
    setStepDraft(nextStep);
    setStepDraftAgentId(resolvedAgentId);
    rememberStepDraft(selectedStep.id, nextStep, resolvedAgentId);
  }

  function updateCurrentStepAgentId(nextAgentId: string) {
    if (!selectedStep || !stepDraft || !isMemberStep(stepDraft)) {
      return;
    }
    setStepDraftAgentId(nextAgentId);
    rememberStepDraft(selectedStep.id, stepDraft, nextAgentId);
  }

  function handleSelectStep(stepId: string) {
    if (selectedStep && stepDraft) {
      const currentAgentId = isMemberStep(stepDraft) ? stepDraftAgentId : "";
      rememberStepDraft(selectedStep.id, stepDraft, currentAgentId);
    }
    setSelectedStepId(stepId);
  }

  function buildStepDraftForType(
    currentStep: WorkflowStepDefinition,
    nextType: WorkflowStepType,
    fallbackMemberId: string,
  ): WorkflowStepDefinition {
    const fallbackNextStepId =
      currentStep.type === "start"
        ? currentStep.nextStepId
        : currentStep.type === "agent_task"
          ? currentStep.nextStepId
          : currentStep.type === "decision"
            ? currentStep.trueNextStepId ?? currentStep.falseNextStepId
            : currentStep.loopTargetStepId;

    if (nextType === "start") {
      return {
        id: currentStep.id,
        workflowId: currentStep.workflowId,
        type: "start",
        name: currentStep.name,
        order: currentStep.order,
        nextStepId: fallbackNextStepId,
      };
    }

    if (nextType === "agent_task") {
      return {
        id: currentStep.id,
        workflowId: currentStep.workflowId,
        type: "agent_task",
        name: currentStep.name,
        order: currentStep.order,
        memberId: isMemberStep(currentStep) ? currentStep.memberId : fallbackMemberId,
        promptTemplate: isMemberStep(currentStep) ? currentStep.promptTemplate : "",
        outputMode: "text",
        nextStepId: fallbackNextStepId,
      };
    }

    if (nextType === "decision") {
      const sourceCandidates = detail?.steps.filter((item) => item.id !== currentStep.id && item.type === "agent_task") ?? [];
      return {
        id: currentStep.id,
        workflowId: currentStep.workflowId,
        type: "decision",
        name: currentStep.name,
        order: currentStep.order,
        memberId: isMemberStep(currentStep) ? currentStep.memberId : fallbackMemberId,
        promptTemplate: isMemberStep(currentStep) ? currentStep.promptTemplate : "",
        sourceStepId: currentStep.type === "decision" ? currentStep.sourceStepId : sourceCandidates[0]?.id ?? "",
        trueNextStepId: currentStep.type === "decision" ? currentStep.trueNextStepId : fallbackNextStepId,
        falseNextStepId: currentStep.type === "decision" ? currentStep.falseNextStepId : null,
        passRule: "workflow_decision.pass == true",
      };
    }

    return {
      id: currentStep.id,
      workflowId: currentStep.workflowId,
      type: "end",
      name: currentStep.name,
      order: currentStep.order,
      stopReason: currentStep.type === "end" ? currentStep.stopReason : "completed",
      summaryTemplate: currentStep.type === "end" ? currentStep.summaryTemplate : "",
      loopBehavior: currentStep.type === "end" ? currentStep.loopBehavior : "finish",
      loopTargetStepId: currentStep.type === "end" ? currentStep.loopTargetStepId : detail?.steps[0]?.id ?? null,
    };
  }

  function handleStepTypeChange(nextType: WorkflowStepType) {
    if (!stepDraft) {
      return;
    }
    const fallbackAgentId = isMemberStep(stepDraft)
      ? stepDraftAgentId
      : agents.find((agent) => agent.validation.isValid)?.id ?? agents[0]?.id ?? "";
    const fallbackMemberId = isMemberStep(stepDraft) ? stepDraft.memberId : "";
    updateCurrentStepDraft(
      buildStepDraftForType(stepDraft, nextType, fallbackMemberId),
      nextType === "agent_task" || nextType === "decision" ? fallbackAgentId : "",
    );
  }

  async function createHiddenMember(agentId: string) {
    if (!detail) {
      return null;
    }
    const agent = agentById.get(agentId);
    if (!agent) {
      throw new Error("未找到所选代理。");
    }
    await addTeamMember(detail.workflow.id, {
      agentId: agent.id,
      name: buildHiddenMemberName(agent.name, detail.teamMembers),
      roleLabel: agent.name,
      responsibilityPrompt: "",
      allowedToolIds: undefined,
    });
    return useWorkflowStore.getState().currentDetail?.teamMembers.at(-1) ?? null;
  }

  async function refreshBooks() {
    try {
      setBooksBusy(true);
      setBooksError(null);
      setPageNotice(null);
      setAvailableBooks(await listBookWorkspaces());
    } catch (error) {
      setBooksError(getReadableError(error, "加载书籍列表失败。"));
    } finally {
      setBooksBusy(false);
    }
  }

  async function persistBasicSettings(nextWorkspaceBinding = draftWorkspaceBinding) {
    if (!detail || saveBusy) {
      return false;
    }
    const nextWorkspaceDirty = !isSameWorkspaceBinding(
      stripWorkspaceBinding(detail.workflow.workspaceBinding),
      nextWorkspaceBinding,
    );
    if (!isBasicsDirty && !isLoopConfigDirty && !nextWorkspaceDirty) {
      return true;
    }

    try {
      setSaveBusy(true);
      setPageNotice(null);
      if (isBasicsDirty) {
        await saveWorkflowBasics(detail.workflow.id, {
          name: draftName.trim() || "未命名工作流",
          basePrompt: draftBasePrompt.trim(),
        });
      }
      if (isLoopConfigDirty) {
        await updateLoopConfig(detail.workflow.id, {
          maxLoops: normalizeLoopValue(loopDraft.maxLoopsMode, loopDraft.maxLoopsValue),
        });
      }
      if (nextWorkspaceDirty && nextWorkspaceBinding) {
        await bindWorkspace(detail.workflow.id, nextWorkspaceBinding);
      }
      return true;
    } catch (error) {
      setPageNotice(getReadableError(error, "保存基本设置失败。"));
      return false;
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleBindBook(bookId: string) {
    if (!detail || booksBusy) {
      return;
    }
    const targetBook = availableBooks.find((item) => item.id === bookId);
    if (!targetBook) {
      return;
    }
    const nextWorkspaceBinding = {
      bookId: targetBook.id,
      rootPath: targetBook.path,
      bookName: targetBook.name,
    };

    try {
      setBooksBusy(true);
      setBooksError(null);
      setPageNotice(null);
      setDraftWorkspaceBinding(nextWorkspaceBinding);
      const saved = await persistBasicSettings(nextWorkspaceBinding);
      if (saved) {
        setBindingDialogOpen(false);
      }
    } catch (error) {
      setBooksError(getReadableError(error, "绑定书籍失败。"));
    } finally {
      setBooksBusy(false);
    }
  }

  async function handleSaveBasics() {
    if (!hasSettingsDirty) {
      return;
    }
    await persistBasicSettings();
  }

  async function handleStartRun() {
    if (!detail || runBusy || isRunning) {
      return;
    }
    try {
      setRunBusy(true);
      setPageNotice(null);
      if (isMobile) {
        setMobileActiveTab("runs");
      }
      await startWorkflowRun(detail.workflow.id);
    } catch (error) {
      setPageNotice(getReadableError(error, "工作流启动失败。"));
    } finally {
      setRunBusy(false);
    }
  }

  async function handleResumeRun() {
    if (!detail || runBusy || isRunning || !resumableRun) {
      return;
    }
    try {
      setRunBusy(true);
      setPageNotice(null);
      if (isMobile) {
        setMobileActiveTab("runs");
      }
      await resumeWorkflowRun(detail.workflow.id, resumableRun.id);
    } catch (error) {
      setPageNotice(getReadableError(error, "工作流继续失败。"));
    } finally {
      setRunBusy(false);
    }
  }

  const runActions = isRunning
    ? [
        {
          disabled: finishAfterCurrentLoopRequested,
          icon: Flag,
          label: finishAfterCurrentLoopRequested ? "本轮后结束中" : "本轮后结束",
          tone: "default" as const,
          onClick: () => requestFinishAfterCurrentLoop(),
        },
        { icon: Pause, label: "暂停", tone: "default" as const, onClick: () => void requestStopRun() },
      ]
    : resumableRun
      ? [
          { icon: Play, label: runBusy ? "继续中" : "继续", tone: "primary" as const, onClick: () => void handleResumeRun() },
          { icon: RotateCcw, label: "重新运行", tone: "default" as const, onClick: () => void handleStartRun() },
        ]
      : [
          { icon: Play, label: runBusy ? "运行中" : "运行", tone: "primary" as const, onClick: () => void handleStartRun() },
        ];

  async function handleAddAgentStep(agentId: string) {
    if (!detail || stepBusy) {
      return;
    }
    const agent = agentById.get(agentId);
    if (!agent || !agent.validation.isValid) {
      setPageNotice("当前代理还不能加入工作流，请先完善代理配置。");
      return;
    }
    try {
      setStepBusy("create");
      setPageNotice(null);
      await addAgentStep(detail.workflow.id, agent.id, agent.name);
      const nextStep = useWorkflowStore.getState().currentDetail?.steps.at(-1) ?? null;
      setSelectedStepId(nextStep?.id ?? null);
      if (isMobile) {
        setMobileActiveTab("workflow");
      }
    } catch (error) {
      setPageNotice(getReadableError(error, "添加代理到工作流失败。"));
    } finally {
      setStepBusy(null);
    }
  }

  async function handleStepPatch(stepId: string, payload: Partial<WorkflowStepDefinition>) {
    if (!detail) {
      return;
    }
    const existingStep = detail.steps.find((item) => item.id === stepId);
    if (!existingStep) {
      return;
    }
    try {
      setStepBusy(stepId);
      setPageNotice(null);
      const nextPayload = "type" in payload && payload.type !== existingStep.type ? payload : { ...existingStep, ...payload };
      await updateStep(detail.workflow.id, stepId, nextPayload);
    } finally {
      setStepBusy(null);
    }
  }

  async function handleMoveStep(stepId: string, direction: "up" | "down") {
    if (!detail || stepBusy) {
      return;
    }
    const currentIndex = detail.steps.findIndex((item) => item.id === stepId);
    if (currentIndex === -1) {
      return;
    }
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= detail.steps.length) {
      return;
    }
    const orderedStepIds = detail.steps.map((item) => item.id);
    [orderedStepIds[currentIndex], orderedStepIds[targetIndex]] = [orderedStepIds[targetIndex], orderedStepIds[currentIndex]];
    try {
      setStepBusy(stepId);
      setPageNotice(null);
      await reorderSteps(detail.workflow.id, orderedStepIds);
    } catch (error) {
      setPageNotice(getReadableError(error, "调整节点顺序失败。"));
    } finally {
      setStepBusy(null);
    }
  }

  async function handleSaveStepDraft() {
    if (!detail || !selectedStep || !stepDraft || !isStepDraftDirty) {
      return;
    }
    try {
      setStepBusy(selectedStep.id);
      setPageNotice(null);
      let nextMemberId = isMemberStep(stepDraft) ? stepDraft.memberId : null;
      const previousMemberId = isMemberStep(selectedStep) ? selectedStep.memberId : null;

      if (isMemberStep(stepDraft)) {
        if (!stepDraftAgentId) {
          throw new Error("请先为节点选择一个代理。");
        }
        if (stepDraft.type === "decision" && !stepDraft.sourceStepId) {
          throw new Error("请先为判断节点选择一个来源节点。");
        }
        const selectedAgent = agentById.get(stepDraftAgentId);
        if (!selectedAgent || !selectedAgent.validation.isValid) {
          throw new Error("当前代理还不能用于工作流节点。");
        }

        const currentMember = previousMemberId ? getMemberById(detail.teamMembers, previousMemberId) : null;
        const persistedAgentId = currentMember?.agentId ?? "";
        if (currentMember && persistedAgentId === stepDraftAgentId) {
          nextMemberId = currentMember.id;
        } else if (currentMember && countMemberUsage(currentMember.id) === 1) {
          await updateTeamMember(detail.workflow.id, currentMember.id, {
            agentId: selectedAgent.id,
            name: buildHiddenMemberName(selectedAgent.name, detail.teamMembers.filter((item) => item.id !== currentMember.id)),
            roleLabel: selectedAgent.name,
            responsibilityPrompt: "",
          });
          nextMemberId = currentMember.id;
        } else {
          const nextMember = await createHiddenMember(selectedAgent.id);
          if (!nextMember) {
            throw new Error("为节点绑定代理失败。");
          }
          nextMemberId = nextMember.id;
        }
      }

      const nextStep = isMemberStep(stepDraft)
        ? {
            ...stepDraft,
            memberId: nextMemberId ?? "",
          }
        : stepDraft;

      await handleStepPatch(selectedStep.id, nextStep);

      if (previousMemberId) {
        const latestDetailAfterSave = useWorkflowStore.getState().currentDetail;
        const stillUsed = latestDetailAfterSave?.steps.some((item) => isMemberStep(item) && item.memberId === previousMemberId) ?? false;
        if (!stillUsed) {
          setMemberBusy(previousMemberId);
          await removeTeamMember(detail.workflow.id, previousMemberId);
        }
      }

      const latestDetail = useWorkflowStore.getState().currentDetail;
      const persistedStep = latestDetail?.steps.find((item) => item.id === selectedStep.id) ?? null;
      if (persistedStep) {
        clearStepDraft(selectedStep.id);
        setStepDraft(persistedStep);
        setStepDraftAgentId(isMemberStep(persistedStep) ? getMemberById(latestDetail?.teamMembers ?? [], persistedStep.memberId)?.agentId ?? "" : "");
      }
    } catch (error) {
      setPageNotice(getReadableError(error, "保存节点失败。"));
    } finally {
      setMemberBusy(null);
      setStepBusy(null);
    }
  }

  async function handleRemoveStep(stepId: string) {
    if (!detail || stepBusy) {
      return;
    }
    const targetStep = detail.steps.find((item) => item.id === stepId);
    const orphanMemberId = targetStep && isMemberStep(targetStep) && countMemberUsage(targetStep.memberId) === 1 ? targetStep.memberId : null;
    try {
      setStepBusy(stepId);
      setPageNotice(null);
      await removeStep(detail.workflow.id, stepId);
      if (selectedStepId === stepId) {
        const nextStep = useWorkflowStore.getState().currentDetail?.steps[0] ?? null;
        setSelectedStepId(nextStep?.id ?? null);
      }
      if (orphanMemberId) {
        setMemberBusy(orphanMemberId);
        await removeTeamMember(detail.workflow.id, orphanMemberId);
      }
    } finally {
      setMemberBusy(null);
      setStepBusy(null);
    }
  }

  function renderSettingsColumn() {
    return (
      <WorkflowSettingsColumn
        agentQuery={agentQuery}
        draftBasePrompt={draftBasePrompt}
        draftName={draftName}
        draftWorkspaceBinding={draftWorkspaceBinding}
        errorMessage={errorMessage}
        filteredAgents={filteredAgents}
        hasSettingsDirty={hasSettingsDirty}
        isMobile={isMobile}
        loopDraft={loopDraft}
        memberBusy={memberBusy}
        onAddAgentStep={(agentId) => void handleAddAgentStep(agentId)}
        onAgentQueryChange={setAgentQuery}
        onDraftBasePromptChange={setDraftBasePrompt}
        onDraftNameChange={setDraftName}
        onLoopModeChange={(value) => setLoopDraft((current) => ({ ...current, maxLoopsMode: value }))}
        onLoopValueChange={(value) => setLoopDraft((current) => ({ ...current, maxLoopsValue: value }))}
        onOpenBindingDialog={() => {
          setBindingDialogOpen(true);
          void refreshBooks();
        }}
        onSaveBasics={() => void handleSaveBasics()}
        pageNotice={pageNotice}
        saveBusy={saveBusy}
        stepBusy={stepBusy}
      />
    );
  }

  function renderWorkflowColumn() {
    if (!detail) {
      return null;
    }

    return (
      <WorkflowBuilderColumn
        agents={agents}
        detail={detail}
        formatStepLinks={formatStepLinks}
        getStepAgentLabel={getStepAgentLabel}
        isMobile={isMobile}
        isStepDraftDirty={isStepDraftDirty}
        onMoveStep={(stepId, direction) => void handleMoveStep(stepId, direction)}
        onRemoveStep={(stepId) => void handleRemoveStep(stepId)}
        onSaveStepDraft={() => void handleSaveStepDraft()}
        onSelectStep={handleSelectStep}
        onStepTypeChange={handleStepTypeChange}
        onUpdateStepAgentId={updateCurrentStepAgentId}
        onUpdateStepDraft={updateCurrentStepDraft}
        selectedStep={selectedStep}
        selectedStepId={selectedStepId}
        stepBusy={stepBusy}
        stepDraft={stepDraft}
        stepDraftAgentId={stepDraftAgentId}
      />
    );
  }

  function renderRunsColumn() {
    if (!detail) {
      return null;
    }

    return (
      <WorkflowRunsColumn
        detail={detail}
        formatDateTime={formatDateTime}
        getAgentName={getAgentName}
        isPromptExpanded={isPromptExpanded}
        onSelectStepRun={selectStepRun}
        onTogglePromptExpanded={() => setIsPromptExpanded((current) => !current)}
        selectedRun={selectedRun}
        selectedStepRun={selectedStepRun}
        timelineStepRuns={timelineStepRuns}
      />
    );
  }

  function renderMobileWorkspace() {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-app">
        <div className="min-h-0 flex-1 overflow-hidden">
          {mobileActiveTab === "settings"
            ? renderSettingsColumn()
            : mobileActiveTab === "runs"
              ? renderRunsColumn()
              : renderWorkflowColumn()}
        </div>

        <nav
          aria-label="工作流详情导航"
          className="shrink-0 border-t border-border bg-sidebar/95 px-2 backdrop-blur"
        >
          <div className="grid h-16 w-full grid-cols-3 gap-1">
            {[
              { tab: "settings" as const, label: "设置", Icon: Settings2 },
              { tab: "workflow" as const, label: "工作流", Icon: GitBranch },
              { tab: "runs" as const, label: "运行", Icon: Play },
            ].map(({ tab, label, Icon }) => (
              <button
                key={tab}
                type="button"
                aria-label={label}
                onClick={() => setMobileActiveTab(tab)}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 transition-colors duration-150",
                  mobileActiveTab === tab ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-5 w-5 shrink-0" strokeWidth={2.1} />
                <span className="text-[11px] font-medium leading-none">{label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    );
  }

  function renderDetailWorkspace() {
    if (isMobile) {
      return renderMobileWorkspace();
    }

    return (
      <div className="grid h-full min-h-0 overflow-hidden bg-app lg:grid-cols-[320px_minmax(0,1fr)_360px]">
        {renderSettingsColumn()}
        {renderWorkflowColumn()}
        {renderRunsColumn()}
      </div>
    );
  }

  if (!workflowId) {
    return null;
  }

  if (status === "loading" && !detail) {
    return (
      <PageShell title={<DetailTitle currentLabel="工作流详情" />}>
        <div className="editor-empty-state">正在加载工作流详情...</div>
      </PageShell>
    );
  }

  if (!detail) {
    return (
      <PageShell title={<DetailTitle currentLabel="工作流详情" />}>
        <div className="editor-empty-state">
          <div className="space-y-3 text-center">
            <h2 className="editor-empty-state-title text-xl">未找到该工作流</h2>
            <p className="editor-empty-state-copy">它可能已被删除，或当前链接无效。</p>
            {errorMessage ? (
              <div className="mx-auto max-w-2xl rounded-lg border border-border bg-panel p-3 text-left">
                <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{errorMessage}</pre>
              </div>
            ) : null}
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <>
      <PageShell
        title={<DetailTitle currentLabel={detail.workflow.name} />}
        actions={runActions}
        contentClassName="min-h-0 flex-1 overflow-hidden"
      >
        <div className="h-full">
          {renderDetailWorkspace()}
        </div>
      </PageShell>
      {bindingDialogOpen ? (
        <BookshelfDialog
          books={availableBooks}
          busy={booksBusy}
          errorMessage={booksError}
          onClose={() => setBindingDialogOpen(false)}
          onCreate={() => setBindingDialogOpen(false)}
          onOpen={(bookId) => void handleBindBook(bookId)}
          onRefresh={() => void refreshBooks()}
        />
      ) : null}
    </>
  );
}
