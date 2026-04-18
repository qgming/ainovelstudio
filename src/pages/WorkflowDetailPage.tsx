import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Flag,
  GitBranch,
  Grid2x2Plus,
  LoaderCircle,
  Link as LinkIcon,
  Play,
  Save,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { AgentPartRenderer } from "../components/agent/AgentPartRenderer";
import { BookshelfDialog } from "../components/dialogs/BookshelfDialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { listBookWorkspaces } from "../lib/bookWorkspace/api";
import { cn } from "../lib/utils";
import { startWorkflowRun } from "../lib/workflow/engine";
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

const STEP_TYPE_OPTIONS: Array<{ label: string; value: WorkflowStepType }> = [
  { label: "开始节点", value: "start" },
  { label: "代理节点", value: "agent_task" },
  { label: "判断节点", value: "decision" },
  { label: "结束节点", value: "end" },
];

const END_REASON_OPTIONS = [
  { label: "完成", value: "completed" },
  { label: "审查失败", value: "review_failed" },
] as const;

const END_LOOP_OPTIONS = [
  { label: "直接结束", value: "finish" },
  { label: "有下一轮就继续", value: "continue_if_possible" },
] as const;

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

function StepRunStatusIcon({ status }: { status: WorkflowStepRun["status"] }) {
  if (status === "running") {
    return <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin text-amber-600" />;
  }
  if (status === "completed") {
    return <Check aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />;
  }
  if (status === "failed") {
    return <X aria-hidden="true" className="h-3.5 w-3.5 text-destructive" />;
  }
  return <Circle aria-hidden="true" className="h-3 w-3 text-muted-foreground" />;
}

function StepTypeIcon({ type }: { type: WorkflowStepDefinition["type"] }) {
  if (type === "start") {
    return <Play aria-hidden="true" className="h-3.5 w-3.5" />;
  }
  if (type === "agent_task") {
    return <Bot aria-hidden="true" className="h-3.5 w-3.5" />;
  }
  if (type === "decision") {
    return <GitBranch aria-hidden="true" className="h-3.5 w-3.5" />;
  }
  return <Flag aria-hidden="true" className="h-3.5 w-3.5" />;
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

function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("flex min-h-0 flex-col bg-app", className)}>
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-3">
        <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">{title}</h2>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn("min-h-0 px-3 py-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function WorkflowDetailPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const currentDetail = useWorkflowStore((state) => state.currentDetail);
  const status = useWorkflowStore((state) => state.status);
  const errorMessage = useWorkflowStore((state) => state.errorMessage);
  const selectedStepRunId = useWorkflowStore((state) => state.selectedStepRunId);
  const isRunning = useWorkflowStore((state) => state.isRunning);
  const activeRunId = useWorkflowStore((state) => state.activeRunId);
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
  const [isPromptExpanded, setIsPromptExpanded] = useState(false);
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
    setStepDraft(selectedStep);
    setStepDraftAgentId(isMemberStep(selectedStep) ? getAgentIdForStep(selectedStep) : "");
  }, [selectedStep, detail]);

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
    setStepDraft(buildStepDraftForType(stepDraft, nextType, fallbackMemberId));
    setStepDraftAgentId(nextType === "agent_task" || nextType === "decision" ? fallbackAgentId : "");
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

  async function handleBindBook(bookId: string) {
    if (!detail) {
      return;
    }
    const targetBook = availableBooks.find((item) => item.id === bookId);
    if (!targetBook) {
      return;
    }
    try {
      setBooksBusy(true);
      setPageNotice(null);
      setDraftWorkspaceBinding({
        bookId: targetBook.id,
        rootPath: targetBook.path,
        bookName: targetBook.name,
      });
      setBindingDialogOpen(false);
    } catch (error) {
      setBooksError(getReadableError(error, "绑定书籍失败。"));
    } finally {
      setBooksBusy(false);
    }
  }

  async function handleSaveBasics() {
    if (!detail || saveBusy || !hasSettingsDirty) {
      return;
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
      if (isWorkspaceBindingDirty && draftWorkspaceBinding) {
        await bindWorkspace(detail.workflow.id, draftWorkspaceBinding);
      }
    } catch (error) {
      setPageNotice(getReadableError(error, "保存基本设置失败。"));
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleStartRun() {
    if (!detail || runBusy || isRunning) {
      return;
    }
    try {
      setRunBusy(true);
      setPageNotice(null);
      await startWorkflowRun(detail.workflow.id);
    } catch (error) {
      setPageNotice(getReadableError(error, "工作流启动失败。"));
    } finally {
      setRunBusy(false);
    }
  }

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
        actions={[
          { icon: Play, label: runBusy || isRunning ? "运行中" : "运行", tone: "primary", onClick: () => void handleStartRun() },
          { icon: Square, label: "停止", tone: "default", onClick: () => void requestStopRun() },
        ]}
        contentClassName="min-h-0 flex-1 overflow-hidden"
      >
        <div className="h-full">
          <div className="grid h-full min-h-0 overflow-hidden bg-app lg:grid-cols-[320px_minmax(0,1fr)_360px]">
            <section className="min-h-0 overflow-y-auto border-b border-border lg:border-r lg:border-b-0">
              <div className="divide-y divide-border">
                <Panel
                  title="基本设置"
                  bodyClassName="space-y-4"
                  actions={(
                    <Button
                      type="button"
                      aria-label={saveBusy ? "基本设置保存中" : "保存基本设置"}
                      size="icon-sm"
                      variant="ghost"
                      className={cn(
                        "border-0 shadow-none hover:text-foreground",
                        hasSettingsDirty
                          ? "bg-accent text-foreground hover:bg-accent/85"
                          : "bg-transparent text-muted-foreground hover:bg-transparent",
                      )}
                      onClick={() => void handleSaveBasics()}
                      disabled={!hasSettingsDirty || saveBusy}
                    >
                      <Save className="h-4 w-4" />
                    </Button>
                  )}
                >
                  {pageNotice ? (
                    <div className="editor-callout" data-tone="error">
                      <pre className="whitespace-pre-wrap break-words text-sm leading-6">{pageNotice}</pre>
                    </div>
                  ) : null}
                  {errorMessage ? (
                    <div className="editor-callout" data-tone="error">
                      <pre className="whitespace-pre-wrap break-words text-sm leading-6">{errorMessage}</pre>
                    </div>
                  ) : null}

                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">工作流名称</span>
                    <Input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
                  </label>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">绑定书籍</span>
                    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {draftWorkspaceBinding?.bookName ?? "尚未绑定书籍"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        aria-label={draftWorkspaceBinding ? "更换绑定书籍" : "绑定书籍"}
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                        onClick={() => {
                          setBindingDialogOpen(true);
                          void refreshBooks();
                        }}
                      >
                        <LinkIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">循环配置</span>
                    <div className="grid gap-3 rounded-lg border border-border p-3 md:grid-cols-[120px_minmax(0,1fr)] md:items-end">
                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">最大循环次数</span>
                        <Select
                          value={loopDraft.maxLoopsMode}
                          onValueChange={(value) =>
                            setLoopDraft((current) => ({ ...current, maxLoopsMode: value as "finite" | "infinite" }))
                          }
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="finite">有限</SelectItem>
                            <SelectItem value="infinite">无限</SelectItem>
                          </SelectContent>
                        </Select>
                      </label>
                      {loopDraft.maxLoopsMode === "finite" ? (
                        <label className="block space-y-1.5">
                          <span className="text-xs font-medium text-muted-foreground">次数</span>
                          <Input
                            type="number"
                            min={1}
                            value={loopDraft.maxLoopsValue}
                            onChange={(event) =>
                              setLoopDraft((current) => ({ ...current, maxLoopsValue: event.target.value }))
                            }
                          />
                        </label>
                      ) : (
                        <div className="flex h-10 items-center text-sm text-muted-foreground">无限</div>
                      )}
                    </div>
                  </div>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">提示词内容</span>
                    <Textarea
                      value={draftBasePrompt}
                      onChange={(event) => setDraftBasePrompt(event.target.value)}
                      placeholder="补充这条工作流的全局目标、约束、写作风格与上下文。"
                      className="min-h-32"
                    />
                  </label>
                </Panel>

                <Panel title="代理库" bodyClassName="space-y-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} placeholder="搜索代理" className="pl-9" />
                  </div>
                  <div className="divide-y divide-border border-y border-border">
                    {filteredAgents.map((agent) => (
                      <div key={agent.id} className="flex items-start justify-between gap-3 px-0 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{agent.name}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{agent.description}</p>
                        </div>
                        {agent.validation.isValid ? (
                          <Button
                            type="button"
                            aria-label={`添加代理 ${agent.name}`}
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                            onClick={() => void handleAddAgentStep(agent.id)}
                            disabled={stepBusy !== null || memberBusy !== null}
                          >
                            <Grid2x2Plus className="h-4 w-4" />
                          </Button>
                        ) : (
                          <span className="inline-flex shrink-0 items-center px-0 py-1 text-[11px] font-medium text-amber-700">
                            待完善
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </section>

            <section className="min-h-0 overflow-y-auto border-b border-border lg:border-r lg:border-b-0">
              <div className="divide-y divide-border">
                <Panel title="工作流" bodyClassName="p-0">
                  <div className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                    {detail.steps.map((step, index) => (
                      <article
                        key={step.id}
                        className={cn(
                          "editor-block-tile",
                          selectedStepId === step.id ? "bg-primary/[0.08]" : "",
                        )}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedStepId(step.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedStepId(step.id);
                            }
                          }}
                          className={cn(
                            "editor-block-content w-full cursor-pointer overflow-hidden rounded-none px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset",
                            selectedStepId === step.id ? "bg-primary/[0.04]" : "",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-medium tracking-[0.02em] text-muted-foreground">
                              <span className="inline-flex items-center rounded-full border border-border bg-panel px-2 py-1">
                                <StepTypeIcon type={step.type} />
                                <span className="ml-1.5">
                                  节点 {index + 1}
                                </span>
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6.5 w-6.5 rounded-lg border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                                disabled={index === 0 || stepBusy !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleMoveStep(step.id, "up");
                                }}
                              >
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6.5 w-6.5 rounded-lg border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
                                disabled={index === detail.steps.length - 1 || stepBusy !== null}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleMoveStep(step.id, "down");
                                }}
                              >
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6.5 w-6.5 rounded-lg border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-destructive"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleRemoveStep(step.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                          <p className="line-clamp-3 text-[20px] font-semibold leading-[1.18] tracking-[-0.04em] text-foreground">
                            {step.name}
                          </p>
                          <div className="rounded-xl border border-border/80 bg-foreground/[0.03] px-2.5 py-2">
                            <div className="grid gap-1.5">
                              <div className="grid gap-0.5">
                                <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                                  执行主体
                                </p>
                                <p className="line-clamp-1 text-sm font-medium text-foreground">
                                  {getStepAgentLabel(step)}
                                </p>
                              </div>
                              <div className="grid gap-0.5">
                                <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
                                  流转路径
                                </p>
                                <p className="line-clamp-2 text-xs leading-4.5 text-muted-foreground">
                                  {formatStepLinks(step, detail.steps)}
                                </p>
                              </div>
                            </div>
                          </div>
                          <div className="min-h-0 flex-1" />
                        </div>
                      </article>
                    ))}
                  </div>
                </Panel>

                <Panel
                  title="节点编辑"
                  bodyClassName="space-y-4"
                  actions={
                    selectedStep && stepDraft ? (
                      <Button
                        type="button"
                        aria-label={stepBusy === selectedStep.id ? "节点保存中" : "保存当前节点"}
                        size="icon-sm"
                        variant="ghost"
                        className={cn(
                          "border-0 shadow-none hover:text-foreground",
                          isStepDraftDirty
                            ? "bg-accent text-foreground hover:bg-accent/85"
                            : "bg-transparent text-muted-foreground hover:bg-transparent",
                        )}
                        onClick={() => void handleSaveStepDraft()}
                        disabled={!isStepDraftDirty || stepBusy === selectedStep.id}
                      >
                        <Save className="h-4 w-4" />
                      </Button>
                    ) : null
                  }
                >
                  {selectedStep && stepDraft ? (
                    <div className="space-y-4">
                      <p className="text-xs leading-5 text-muted-foreground">
                        {isStepDraftDirty ? "当前有未保存的节点改动。" : "当前节点内容已保存。"}
                      </p>
                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">节点类型</span>
                        <Select value={stepDraft.type} onValueChange={(value) => handleStepTypeChange(value as WorkflowStepType)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {STEP_TYPE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>
                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">节点名称</span>
                        <Input
                          value={stepDraft.name}
                          onChange={(event) => setStepDraft({ ...stepDraft, name: event.target.value })}
                          disabled={stepBusy === selectedStep.id}
                        />
                      </label>

                      {stepDraft.type === "start" ? (
                        <label className="block space-y-1.5">
                          <span className="text-xs font-medium text-muted-foreground">下一步</span>
                          <Select
                            value={stepDraft.nextStepId ?? "__none__"}
                            onValueChange={(value) => setStepDraft({ ...stepDraft, nextStepId: value === "__none__" ? null : value })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">结束</SelectItem>
                              {detail.steps.filter((item) => item.id !== stepDraft.id).map((item) => (
                                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </label>
                      ) : null}

                      {stepDraft.type === "agent_task" ? (
                        <>
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">代理</span>
                            <Select value={stepDraftAgentId} onValueChange={setStepDraftAgentId}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {agents.map((agent) => (
                                  <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">输出模式</span>
                            <Select
                              value={stepDraft.outputMode}
                              onValueChange={(value) => setStepDraft({ ...stepDraft, outputMode: value as typeof stepDraft.outputMode })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="text">文本</SelectItem>
                                <SelectItem value="review_json">审查 JSON</SelectItem>
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">下一步</span>
                            <Select
                              value={stepDraft.nextStepId ?? "__none__"}
                              onValueChange={(value) => setStepDraft({ ...stepDraft, nextStepId: value === "__none__" ? null : value })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">结束</SelectItem>
                                {detail.steps.filter((item) => item.id !== stepDraft.id).map((item) => (
                                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">节点提示词</span>
                            <Textarea
                              value={stepDraft.promptTemplate}
                              onChange={(event) => setStepDraft({ ...stepDraft, promptTemplate: event.target.value })}
                              className="min-h-40"
                              disabled={stepBusy === selectedStep.id}
                            />
                          </label>
                        </>
                      ) : null}

                      {stepDraft.type === "decision" ? (
                        <>
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">判断代理</span>
                            <Select value={stepDraftAgentId} onValueChange={setStepDraftAgentId}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {agents.map((agent) => (
                                  <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">判断来源</span>
                            <Select
                              value={stepDraft.sourceStepId || "__none__"}
                              onValueChange={(value) => setStepDraft({ ...stepDraft, sourceStepId: value === "__none__" ? "" : value })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">未选择</SelectItem>
                                {detail.steps.filter((item) => item.id !== stepDraft.id && item.type === "agent_task").map((item) => (
                                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          <div className="grid gap-4 md:grid-cols-2">
                            <label className="block space-y-1.5">
                              <span className="text-xs font-medium text-muted-foreground">通过/是 时</span>
                              <Select
                                value={stepDraft.trueNextStepId ?? "__none__"}
                                onValueChange={(value) => setStepDraft({ ...stepDraft, trueNextStepId: value === "__none__" ? null : value })}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">结束</SelectItem>
                                  {detail.steps.filter((item) => item.id !== stepDraft.id).map((item) => (
                                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </label>
                            <label className="block space-y-1.5">
                              <span className="text-xs font-medium text-muted-foreground">不通过/否 时</span>
                              <Select
                                value={stepDraft.falseNextStepId ?? "__none__"}
                                onValueChange={(value) => setStepDraft({ ...stepDraft, falseNextStepId: value === "__none__" ? null : value })}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">结束</SelectItem>
                                  {detail.steps.filter((item) => item.id !== stepDraft.id).map((item) => (
                                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </label>
                          </div>
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">节点提示词</span>
                            <Textarea
                              value={stepDraft.promptTemplate}
                              onChange={(event) => setStepDraft({ ...stepDraft, promptTemplate: event.target.value })}
                              className="min-h-40"
                              disabled={stepBusy === selectedStep.id}
                            />
                          </label>
                        </>
                      ) : null}

                      {stepDraft.type === "end" ? (
                        <>
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">结束原因</span>
                            <Select
                              value={stepDraft.stopReason}
                              onValueChange={(value) => setStepDraft({ ...stepDraft, stopReason: value as typeof stepDraft.stopReason })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {END_REASON_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">结束后动作</span>
                            <Select
                              value={stepDraft.loopBehavior}
                              onValueChange={(value) => setStepDraft({ ...stepDraft, loopBehavior: value as typeof stepDraft.loopBehavior })}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {END_LOOP_OPTIONS.map((option) => (
                                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          {stepDraft.loopBehavior === "continue_if_possible" ? (
                            <label className="block space-y-1.5">
                              <span className="text-xs font-medium text-muted-foreground">下一轮从哪个节点开始</span>
                              <Select
                                value={stepDraft.loopTargetStepId ?? "__none__"}
                                onValueChange={(value) => setStepDraft({ ...stepDraft, loopTargetStepId: value === "__none__" ? null : value })}
                              >
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">未选择</SelectItem>
                                  {detail.steps.filter((item) => item.id !== stepDraft.id).map((item) => (
                                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </label>
                          ) : null}
                          <label className="block space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">结束摘要模板</span>
                            <Textarea
                              value={stepDraft.summaryTemplate}
                              onChange={(event) => setStepDraft({ ...stepDraft, summaryTemplate: event.target.value })}
                              className="min-h-32"
                              disabled={stepBusy === selectedStep.id}
                            />
                          </label>
                        </>
                      ) : null}
                    </div>
                  ) : (
                    <div className="py-8 text-sm text-muted-foreground">
                      先在上面选择一个节点，再补充它的连接方式和提示词。
                    </div>
                  )}
                </Panel>
              </div>
            </section>
            <section className="min-h-0 overflow-y-auto">
              <div className="divide-y divide-border">
                <Panel title="步骤时间线" bodyClassName="p-0">
                  {timelineStepRuns.length > 0 ? (
                    <div className="divide-y divide-border border-y border-border">
                      {timelineStepRuns.map((stepRun) => {
                        const stepName = detail.steps.find((item) => item.id === stepRun.stepId)?.name ?? stepRun.stepId;
                        return (
                          <button
                            key={stepRun.id}
                            type="button"
                            onClick={() => selectStepRun(stepRun.id)}
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                              selectedStepRun?.id === stepRun.id ? "bg-primary/6" : "hover:bg-foreground/[0.03]",
                            )}
                          >
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{stepName}</span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {getAgentName(getMemberById(detail.teamMembers, stepRun.memberId)?.agentId ?? null)}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              L{stepRun.loopIndex} / T{stepRun.attemptIndex}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {stepRun.decision?.outcome ?? "—"}
                            </span>
                            <span className="shrink-0 text-muted-foreground" title={stepRun.status} aria-label={stepRun.status}>
                              <StepRunStatusIcon status={stepRun.status} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-sm text-muted-foreground">
                      {detail.runs.length > 0 ? "当前运行还没有步骤日志。" : "运行后，这里会显示执行时间线。"}
                    </div>
                  )}
                </Panel>

                <Panel title="步骤详情" bodyClassName="p-0">
                  {selectedStepRun ? (
                    <div className="divide-y divide-border border-y border-border">
                      <div className="px-3 py-3 text-xs leading-5 text-muted-foreground">
                        状态：{selectedStepRun.status} · 开始：{formatDateTime(selectedStepRun.startedAt)} · 结束：{formatDateTime(selectedStepRun.finishedAt)}
                      </div>
                      <div className="px-3 py-3 text-xs leading-5 text-muted-foreground">
                        轮次：L{selectedStepRun.loopIndex} / T{selectedStepRun.attemptIndex}
                        {selectedRun ? ` · 当前运行结束原因：${selectedRun.stopReason ?? "—"}` : ""}
                      </div>
                      <div className="px-3 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-muted-foreground">输入提示词</p>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={isPromptExpanded ? "收起输入提示词" : "展开输入提示词"}
                            onClick={() => setIsPromptExpanded((current) => !current)}
                          >
                            {isPromptExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                        <div className={cn("mt-2 overflow-hidden", isPromptExpanded ? "" : "max-h-[7.5rem]")}>
                          <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                            {selectedStepRun.inputPrompt || "—"}
                          </pre>
                        </div>
                      </div>
                      {selectedStepRun.resultText ? (
                        <div className="px-3 py-3">
                          <p className="text-xs text-muted-foreground">输出文本</p>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{selectedStepRun.resultText}</pre>
                        </div>
                      ) : null}
                      {selectedStepRun.decision ? (
                        <div className="px-3 py-3">
                          <p className="text-xs text-muted-foreground">分支决策</p>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                            {JSON.stringify(selectedStepRun.decision, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                      {selectedStepRun.resultJson ? (
                        <div className="px-3 py-3">
                          <p className="text-xs text-muted-foreground">审查结果</p>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                            {JSON.stringify(selectedStepRun.resultJson, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                      {selectedStepRun.messageType ? (
                        <div className="px-3 py-3">
                          <p className="text-xs text-muted-foreground">消息类型</p>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{selectedStepRun.messageType}</pre>
                        </div>
                      ) : null}
                      {selectedStepRun.messageJson ? (
                        <div className="px-3 py-3">
                          <p className="text-xs text-muted-foreground">结构化消息</p>
                          <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                            {JSON.stringify(selectedStepRun.messageJson, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                      {selectedStepRun.parts.map((part, index) => (
                        <div key={`${selectedStepRun.id}-part-${index}`} className="px-3 py-3">
                          <AgentPartRenderer part={part} />
                        </div>
                      ))}
                      {selectedStepRun.errorMessage ? (
                        <div className="px-3 py-3 text-sm text-destructive">
                          {selectedStepRun.errorMessage}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="py-8 text-sm text-muted-foreground">
                      选择一条步骤日志后，这里会显示输入、输出和错误信息。
                    </div>
                  )}
                </Panel>
              </div>
            </section>
          </div>
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
