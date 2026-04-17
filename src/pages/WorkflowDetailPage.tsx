import {
  ArrowDown,
  ArrowUp,
  BookOpenText,
  Link as LinkIcon,
  Play,
  Plus,
  Save,
  Search,
  Square,
  Trash2,
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
import type { WorkflowRun, WorkflowStepDefinition, WorkflowStepRun, WorkflowTeamMember } from "../lib/workflow/types";
import { getResolvedAgents, useSubAgentStore } from "../stores/subAgentStore";
import { useWorkflowStore } from "../stores/workflowStore";

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

function formatRunStatus(status: WorkflowRun["status"]) {
  switch (status) {
    case "idle":
      return "未运行";
    case "queued":
      return "排队中";
    case "running":
      return "运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "stopped":
      return "已停止";
    default:
      return status;
  }
}

function formatStepType(type: WorkflowStepDefinition["type"]) {
  switch (type) {
    case "agent_task":
      return "代理任务";
    case "review_gate":
      return "审查节点";
    case "loop_control":
      return "循环节点";
    default:
      return type;
  }
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
  if (step.type === "agent_task") {
    return `下一步：${step.nextStepId ? nameById.get(step.nextStepId) ?? "未命名节点" : "结束"}`;
  }
  if (step.type === "review_gate") {
    const passLabel = step.passNextStepId ? nameById.get(step.passNextStepId) ?? "未命名节点" : "结束";
    const failLabel = step.failNextStepId ? nameById.get(step.failNextStepId) ?? "未命名节点" : "结束";
    return `通过 → ${passLabel} / 不通过 → ${failLabel}`;
  }
  return `回到：${step.loopTargetStepId ? nameById.get(step.loopTargetStepId) ?? "未命名节点" : "结束"}`;
}

function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-panel", className)}>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-4 p-4">{children}</div>
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
    const persistedAgentId =
      selectedStep.type === "agent_task" || selectedStep.type === "review_gate"
        ? getAgentIdForStep(selectedStep)
        : "";
    const draftAgentId =
      stepDraft.type === "agent_task" || stepDraft.type === "review_gate"
        ? stepDraftAgentId
        : "";
    return JSON.stringify(selectedStep) !== JSON.stringify(stepDraft) || persistedAgentId !== draftAgentId;
  }, [selectedStep, stepDraft, stepDraftAgentId]);

  useEffect(() => {
    if (!selectedStep) {
      setStepDraft(null);
      setStepDraftAgentId("");
      return;
    }
    setStepDraft(selectedStep);
    setStepDraftAgentId(
      selectedStep.type === "agent_task" || selectedStep.type === "review_gate"
        ? getAgentIdForStep(selectedStep)
        : "",
    );
  }, [selectedStep, detail]);

  function getAgentIdForStep(step: Extract<WorkflowStepDefinition, { type: "agent_task" | "review_gate" }>) {
    return getMemberById(detail?.teamMembers ?? [], step.memberId)?.agentId ?? "";
  }

  function getAgentName(agentId: string | null) {
    if (!agentId) {
      return "系统";
    }
    return agentById.get(agentId)?.name ?? agentId;
  }

  function getStepAgentLabel(step: WorkflowStepDefinition) {
    if (!("memberId" in step)) {
      return "系统";
    }
    return getAgentName(getAgentIdForStep(step));
  }

  function countMemberUsage(memberId: string) {
    return detail?.steps.filter((item) => "memberId" in item && item.memberId === memberId).length ?? 0;
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

  async function handleStepAgentChange(
    step: Extract<WorkflowStepDefinition, { type: "agent_task" | "review_gate" }>,
    nextAgentId: string,
  ) {
    if (!detail) {
      return;
    }
    const currentMember = getMemberById(detail.teamMembers, step.memberId);
    if (currentMember?.agentId === nextAgentId) {
      return;
    }
    const nextAgent = agentById.get(nextAgentId);
    if (!nextAgent) {
      return;
    }

    try {
      setStepBusy(step.id);
      if (currentMember && countMemberUsage(currentMember.id) === 1) {
        await updateTeamMember(detail.workflow.id, currentMember.id, {
          agentId: nextAgent.id,
          name: buildHiddenMemberName(nextAgent.name, detail.teamMembers.filter((item) => item.id !== currentMember.id)),
          roleLabel: nextAgent.name,
          responsibilityPrompt: "",
        });
        return;
      }

      const nextMember = await createHiddenMember(nextAgent.id);
      if (!nextMember) {
        throw new Error("为节点绑定代理失败。");
      }
      await updateStep(detail.workflow.id, step.id, { ...step, memberId: nextMember.id });
    } finally {
      setStepBusy(null);
    }
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
      await bindWorkspace(detail.workflow.id, {
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
    if (!detail || saveBusy) {
      return;
    }
    try {
      setSaveBusy(true);
      setPageNotice(null);
      await saveWorkflowBasics(detail.workflow.id, {
        name: draftName.trim() || "未命名工作流",
        basePrompt: draftBasePrompt.trim(),
      });
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
      await updateStep(detail.workflow.id, stepId, { ...existingStep, ...payload });
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
      let nextStep = stepDraft;
      if (
        (stepDraft.type === "agent_task" || stepDraft.type === "review_gate") &&
        (selectedStep.type === "agent_task" || selectedStep.type === "review_gate") &&
        stepDraftAgentId
      ) {
        const persistedAgentId = getAgentIdForStep(selectedStep);
        if (persistedAgentId !== stepDraftAgentId) {
          await handleStepAgentChange(selectedStep, stepDraftAgentId);
          const refreshedStep = useWorkflowStore.getState().currentDetail?.steps.find((item) => item.id === selectedStep.id) ?? null;
          if (!refreshedStep || refreshedStep.type !== stepDraft.type) {
            throw new Error("保存节点代理失败。");
          }
          nextStep = {
            ...stepDraft,
            memberId: refreshedStep.memberId,
          };
        }
      }
      await handleStepPatch(selectedStep.id, nextStep);
      const latestDetail = useWorkflowStore.getState().currentDetail;
      const persistedStep = latestDetail?.steps.find((item) => item.id === selectedStep.id) ?? null;
      if (persistedStep) {
        setStepDraft(persistedStep);
        setStepDraftAgentId(
          persistedStep.type === "agent_task" || persistedStep.type === "review_gate"
            ? getMemberById(latestDetail?.teamMembers ?? [], persistedStep.memberId)?.agentId ?? ""
            : "",
        );
      }
    } catch (error) {
      setPageNotice(getReadableError(error, "保存节点失败。"));
    }
  }

  async function handleRemoveStep(stepId: string) {
    if (!detail || stepBusy) {
      return;
    }
    const targetStep = detail.steps.find((item) => item.id === stepId);
    const orphanMemberId =
      targetStep && "memberId" in targetStep && countMemberUsage(targetStep.memberId) === 1
        ? targetStep.memberId
        : null;
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
          { icon: Save, label: saveBusy ? "保存中..." : "保存", tone: "default", onClick: () => void handleSaveBasics() },
          { icon: Play, label: runBusy || isRunning ? "运行中" : "运行", tone: "primary", onClick: () => void handleStartRun() },
          { icon: Square, label: "停止", tone: "default", onClick: requestStopRun },
        ]}
        contentClassName="min-h-0 flex-1 overflow-hidden"
      >
        <div className="grid h-full min-h-0 gap-4 overflow-hidden p-4 lg:grid-cols-[320px_minmax(0,1fr)_360px]">
          <section className="min-h-0 overflow-y-auto">
            <div className="space-y-4">
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

              <Panel title="基础消息" description="工作流名称、绑定书籍和全局基础消息都放在左侧。">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">工作流名称</span>
                  <Input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
                </label>
                <div className="rounded-lg border border-border bg-panel-subtle p-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-panel text-primary">
                      <BookOpenText className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {detail.workflow.workspaceBinding?.bookName ?? "尚未绑定书籍"}
                      </p>
                      <p className="mt-1 break-all text-xs leading-5 text-muted-foreground">
                        {detail.workflow.workspaceBinding?.rootPath ?? "请选择一本书作为工作流工作区。"}
                      </p>
                    </div>
                  </div>
                  <Button
                    className="mt-3"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setBindingDialogOpen(true);
                      void refreshBooks();
                    }}
                  >
                    <LinkIcon className="h-4 w-4" />
                    {detail.workflow.workspaceBinding ? "更换书籍" : "绑定书籍"}
                  </Button>
                </div>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">基础消息</span>
                  <Textarea
                    value={draftBasePrompt}
                    onChange={(event) => setDraftBasePrompt(event.target.value)}
                    placeholder="补充这条工作流的全局目标、约束、写作风格与上下文。"
                    className="min-h-32"
                  />
                </label>
              </Panel>

              <Panel title="代理库" description="左侧展示代理中心全部代理。点击添加后，会直接在中间工作流里生成一个代理节点。">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={agentQuery} onChange={(event) => setAgentQuery(event.target.value)} placeholder="搜索代理" className="pl-9" />
                </div>
                <div className="space-y-2">
                  {filteredAgents.map((agent) => (
                    <div key={agent.id} className="rounded-lg border border-border bg-panel-subtle p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{agent.name}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{agent.description}</p>
                        </div>
                        {agent.validation.isValid ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleAddAgentStep(agent.id)}
                            disabled={stepBusy !== null || memberBusy !== null}
                          >
                            <Plus className="h-4 w-4" />
                            添加
                          </Button>
                        ) : (
                          <span className="inline-flex shrink-0 items-center rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700">
                            待完善
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </section>
          <section className="min-h-0 overflow-y-auto">
            <div className="grid min-h-0 gap-4 lg:grid-rows-[minmax(260px,1fr)_minmax(320px,1fr)]">
              <Panel title="工作流" description="左侧添加代理后，这里只负责节点顺序、连接方式和提示词配置。" className="min-h-0 overflow-hidden">
                <div className="grid gap-3 overflow-y-auto lg:grid-cols-2">
                  {detail.steps.map((step, index) => (
                    <button
                      key={step.id}
                      type="button"
                      onClick={() => setSelectedStepId(step.id)}
                      className={cn(
                        "flex h-full flex-col rounded-2xl border p-3.5 text-left transition-all hover:-translate-y-0.5",
                        selectedStepId === step.id
                          ? "border-primary bg-primary/5 shadow-[0_0_0_1px_rgba(99,102,241,0.08)]"
                          : "border-border bg-panel-subtle hover:border-primary/30 hover:bg-background",
                      )}
                    >
                      <div className="flex items-center justify-end gap-1.5 border-b border-border/70 pb-2.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
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
                            className="h-8 w-8 rounded-lg border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground"
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
                            className="h-8 w-8 rounded-lg border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-destructive"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleRemoveStep(step.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                      </div>

                      <div className="flex-1 space-y-2.5 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                            节点 {index + 1}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-foreground/[0.06] px-2.5 py-1 text-[11px] font-medium text-foreground/80">
                            {formatStepType(step.type)}
                          </span>
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm font-semibold leading-5 text-foreground">{step.name}</p>
                          <p className="text-xs leading-5 text-muted-foreground">
                            选中后可编辑连接方式、提示词和节点名称。
                          </p>
                        </div>
                      </div>

                      <div className="space-y-1.5 rounded-xl bg-background/80 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                        {"memberId" in step ? (
                          <div className="flex items-start justify-between gap-3">
                            <span className="shrink-0 font-medium text-foreground/80">执行代理</span>
                            <span className="text-right">{getStepAgentLabel(step)}</span>
                          </div>
                        ) : null}
                        <div className="text-right">
                          <span>{formatStepLinks(step, detail.steps)}</span>
                        </div>
                        {"promptTemplate" in step ? (
                          <p className="border-t border-border/70 pt-2 text-left text-[11px] leading-5 text-muted-foreground/90">
                            {step.promptTemplate.trim() || "未填写节点提示词"}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              </Panel>

              <Panel title="节点编辑" description="选中节点后，在这里配置代理、连接方式和节点提示词。" className="min-h-0 overflow-y-auto">
                {selectedStep && stepDraft ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-panel-subtle px-3 py-2">
                      <p className="text-xs leading-5 text-muted-foreground">
                        {isStepDraftDirty ? "当前有未保存的节点改动。" : "当前节点内容已保存。"}
                      </p>
                      <Button type="button" onClick={() => void handleSaveStepDraft()} disabled={!isStepDraftDirty || stepBusy === selectedStep.id}>
                        <Save className="h-4 w-4" />
                        {stepBusy === selectedStep.id ? "保存中..." : "保存节点"}
                      </Button>
                    </div>
                    <label className="block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">节点名称</span>
                      <Input
                        value={stepDraft.name}
                        onChange={(event) => setStepDraft({ ...stepDraft, name: event.target.value })}
                        disabled={stepBusy === selectedStep.id}
                      />
                    </label>

                    {stepDraft.type === "agent_task" ? (
                      <>
                        <label className="block space-y-1.5">
                          <span className="text-xs font-medium text-muted-foreground">执行代理</span>
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

                    {stepDraft.type === "review_gate" ? (
                      <>
                        <label className="block space-y-1.5">
                          <span className="text-xs font-medium text-muted-foreground">审查代理</span>
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
                          <span className="text-xs font-medium text-muted-foreground">审查来源</span>
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
                            <span className="text-xs font-medium text-muted-foreground">通过后</span>
                            <Select
                              value={stepDraft.passNextStepId ?? "__none__"}
                              onValueChange={(value) => setStepDraft({ ...stepDraft, passNextStepId: value === "__none__" ? null : value })}
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
                            <span className="text-xs font-medium text-muted-foreground">不通过后</span>
                            <Select
                              value={stepDraft.failNextStepId ?? "__none__"}
                              onValueChange={(value) => setStepDraft({ ...stepDraft, failNextStepId: value === "__none__" ? null : value })}
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
                          <span className="text-xs font-medium text-muted-foreground">审查提示词</span>
                          <Textarea
                            value={stepDraft.promptTemplate}
                            onChange={(event) => setStepDraft({ ...stepDraft, promptTemplate: event.target.value })}
                            className="min-h-40"
                            disabled={stepBusy === selectedStep.id}
                          />
                        </label>
                      </>
                    ) : null}

                    {stepDraft.type === "loop_control" ? (
                      <label className="block space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">回到节点</span>
                        <Select
                          value={stepDraft.loopTargetStepId ?? "__none__"}
                          onValueChange={(value) => setStepDraft({ ...stepDraft, loopTargetStepId: value === "__none__" ? null : value })}
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
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                    先在上面选择一个节点，再补充它的连接方式和提示词。
                  </div>
                )}
              </Panel>
            </div>
          </section>
          <section className="min-h-0 overflow-y-auto">
            <div className="grid min-h-0 gap-4 lg:grid-rows-[minmax(180px,auto)_minmax(200px,1fr)_minmax(220px,1fr)]">
              <Panel title="运行记录" description="右侧只保留运行日志，不再承载页面操作日志。">
                {detail.runs.length > 0 ? (
                  <div className="space-y-2">
                    {detail.runs.map((run) => (
                      <button
                        key={run.id}
                        type="button"
                        onClick={() => setSelectedRunId(run.id)}
                        className={cn(
                          "w-full rounded-lg border p-3 text-left transition-colors",
                          selectedRun?.id === run.id ? "border-primary bg-primary/5" : "border-border bg-panel-subtle",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-foreground">{formatRunStatus(run.status)}</p>
                          <span className="text-xs text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{run.summary ?? "暂无摘要"}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                    运行后，这里会显示每一次执行记录。
                  </div>
                )}
              </Panel>

              <Panel
                title="步骤时间线"
                description={selectedRun ? `${formatRunStatus(selectedRun.status)} · ${formatDateTime(selectedRun.startedAt)}` : "选择一条运行记录查看步骤时间线。"}
                className="min-h-0 overflow-y-auto"
              >
                {selectedRunStepRuns.length > 0 ? (
                  <div className="space-y-2">
                    {selectedRunStepRuns.map((stepRun) => {
                      const stepName = detail.steps.find((item) => item.id === stepRun.stepId)?.name ?? stepRun.stepId;
                      return (
                        <button
                          key={stepRun.id}
                          type="button"
                          onClick={() => selectStepRun(stepRun.id)}
                          className={cn(
                            "w-full rounded-lg border p-3 text-left transition-colors",
                            selectedStepRun?.id === stepRun.id ? "border-primary bg-primary/5" : "border-border bg-panel-subtle",
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{stepName}</p>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                代理：{getAgentName(getMemberById(detail.teamMembers, stepRun.memberId)?.agentId ?? null)} · Loop {stepRun.loopIndex} · 尝试 {stepRun.attemptIndex}
                              </p>
                            </div>
                            <span className="rounded-md border border-border bg-panel px-2 py-1 text-[11px] text-muted-foreground">
                              {stepRun.status}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                    当前运行还没有步骤日志。
                  </div>
                )}
              </Panel>

              <Panel title="步骤详情" description="查看选中步骤的输入、输出和错误信息。" className="min-h-0 overflow-y-auto">
                {selectedStepRun ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border bg-panel-subtle p-3 text-xs leading-5 text-muted-foreground">
                      状态：{selectedStepRun.status} · 开始：{formatDateTime(selectedStepRun.startedAt)} · 结束：{formatDateTime(selectedStepRun.finishedAt)}
                    </div>
                    <div className="rounded-lg border border-border bg-panel-subtle p-3">
                      <p className="text-xs text-muted-foreground">输入提示词</p>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{selectedStepRun.inputPrompt || "—"}</pre>
                    </div>
                    {selectedStepRun.resultText ? (
                      <div className="rounded-lg border border-border bg-panel-subtle p-3">
                        <p className="text-xs text-muted-foreground">输出文本</p>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{selectedStepRun.resultText}</pre>
                      </div>
                    ) : null}
                    {selectedStepRun.resultJson ? (
                      <div className="rounded-lg border border-border bg-panel-subtle p-3">
                        <p className="text-xs text-muted-foreground">结构化结果</p>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                          {JSON.stringify(selectedStepRun.resultJson, null, 2)}
                        </pre>
                      </div>
                    ) : null}
                    {selectedStepRun.parts.map((part, index) => (
                      <div key={`${selectedStepRun.id}-part-${index}`} className="rounded-lg border border-border bg-panel-subtle p-3">
                        <AgentPartRenderer part={part} />
                      </div>
                    ))}
                    {selectedStepRun.errorMessage ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {selectedStepRun.errorMessage}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                    选择一条步骤日志后，这里会显示输入、输出和错误信息。
                  </div>
                )}
              </Panel>
            </div>
          </section>
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
