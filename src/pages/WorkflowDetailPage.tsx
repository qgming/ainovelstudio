import { BookOpenText, GitBranch, Link as LinkIcon, Play, Plus, RefreshCw, Save, Square, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageShell } from "../components/PageShell";
import { AgentPartRenderer } from "../components/agent/AgentPartRenderer";
import { BookshelfDialog } from "../components/dialogs/BookshelfDialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/Switch";
import { Textarea } from "../components/ui/textarea";
import { listBookWorkspaces } from "../lib/bookWorkspace/api";
import { startWorkflowRun } from "../lib/workflow/engine";
import type {
  WorkflowDetail,
  WorkflowRun,
  WorkflowStepDefinition,
  WorkflowStepRun,
  WorkflowTeamMember,
} from "../lib/workflow/types";
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
      return "审查判断";
    case "loop_control":
      return "循环控制";
    default:
      return type;
  }
}

function getMemberName(detail: WorkflowDetail, memberId: string | null) {
  if (!memberId) {
    return "未指定";
  }

  return detail.teamMembers.find((item) => item.id === memberId)?.name ?? "未指定";
}

function WorkflowSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-panel">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

function LabeledField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
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
  const addStep = useWorkflowStore((state) => state.addStep);
  const updateStep = useWorkflowStore((state) => state.updateStep);
  const removeStep = useWorkflowStore((state) => state.removeStep);
  const selectStepRun = useWorkflowStore((state) => state.selectStepRun);
  const requestStopRun = useWorkflowStore((state) => state.requestStopRun);

  const initializeAgents = useSubAgentStore((state) => state.initialize);
  const refreshAgents = useSubAgentStore((state) => state.refresh);
  const agentStatus = useSubAgentStore((state) => state.status);
  const manifests = useSubAgentStore((state) => state.manifests);
  const preferences = useSubAgentStore((state) => state.preferences);
  const agents = getResolvedAgents({ manifests, preferences });
  const enabledAgents = agents.filter((item) => item.enabled);

  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftStatus, setDraftStatus] = useState<"draft" | "ready" | "archived">("draft");
  const [maxLoops, setMaxLoops] = useState("1");
  const [maxReworkPerLoop, setMaxReworkPerLoop] = useState("1");
  const [stopOnReviewFailure, setStopOnReviewFailure] = useState(true);
  const [saveBusy, setSaveBusy] = useState(false);
  const [runBusy, setRunBusy] = useState(false);
  const [bindingDialogOpen, setBindingDialogOpen] = useState(false);
  const [availableBooks, setAvailableBooks] = useState<Awaited<ReturnType<typeof listBookWorkspaces>>>([]);
  const [booksBusy, setBooksBusy] = useState(false);
  const [booksError, setBooksError] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState<string | null>(null);
  const [stepBusy, setStepBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!workflowId) {
      return;
    }

    void loadWorkflowDetail(workflowId);
  }, [loadWorkflowDetail, workflowId]);

  useEffect(() => {
    if (agentStatus === "idle") {
      void initializeAgents();
    }
  }, [agentStatus, initializeAgents]);

  useEffect(() => {
    if (!currentDetail || currentDetail.workflow.id !== workflowId) {
      return;
    }

    setDraftName(currentDetail.workflow.name);
    setDraftDescription(currentDetail.workflow.description);
    setDraftStatus(currentDetail.workflow.status);
    setMaxLoops(String(currentDetail.workflow.loopConfig.maxLoops));
    setMaxReworkPerLoop(String(currentDetail.workflow.loopConfig.maxReworkPerLoop));
    setStopOnReviewFailure(currentDetail.workflow.loopConfig.stopOnReviewFailure);
  }, [currentDetail, workflowId]);

  const detail = currentDetail && currentDetail.workflow.id === workflowId ? currentDetail : null;

  const currentRun = useMemo(() => {
    if (!detail) {
      return null;
    }

    if (activeRunId) {
      return detail.runs.find((item) => item.id === activeRunId) ?? detail.runs[0] ?? null;
    }

    return detail.runs[0] ?? null;
  }, [activeRunId, detail]);

  const currentRunStepRuns = useMemo(() => {
    if (!detail || !currentRun) {
      return [] as WorkflowStepRun[];
    }

    return detail.stepRuns.filter((item) => item.runId === currentRun.id);
  }, [currentRun, detail]);

  const selectedStepRun = useMemo(() => {
    if (!detail) {
      return null;
    }

    return detail.stepRuns.find((item) => item.id === selectedStepRunId) ?? currentRunStepRuns.at(-1) ?? null;
  }, [currentRunStepRuns, detail, selectedStepRunId]);

  async function refreshBooks() {
    try {
      setBooksBusy(true);
      setBooksError(null);
      const books = await listBookWorkspaces();
      setAvailableBooks(books);
    } catch (error) {
      setBooksError(getReadableError(error, "加载书籍列表失败。"));
    } finally {
      setBooksBusy(false);
    }
  }

  async function openBindingDialog() {
    setBindingDialogOpen(true);
    await refreshBooks();
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

    const normalizedLoops = Math.max(1, Number.parseInt(maxLoops, 10) || 1);
    const normalizedRework = Math.max(1, Number.parseInt(maxReworkPerLoop, 10) || 1);

    try {
      setSaveBusy(true);
      await saveWorkflowBasics(detail.workflow.id, {
        name: draftName.trim() || "未命名工作流",
        description: draftDescription.trim(),
        status: draftStatus,
      });
      await updateLoopConfig(detail.workflow.id, {
        maxLoops: normalizedLoops,
        maxReworkPerLoop: normalizedRework,
        stopOnReviewFailure,
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
      await refreshAgents();
      await startWorkflowRun(detail.workflow.id);
    } catch (error) {
      window.alert(getReadableError(error, "工作流启动失败。"));
    } finally {
      setRunBusy(false);
    }
  }

  function handleStopRun() {
    requestStopRun();
  }

  async function handleAddMember() {
    if (!detail || enabledAgents.length === 0 || memberBusy) {
      return;
    }

    const agent = enabledAgents[0];
    try {
      setMemberBusy("create");
      await addTeamMember(detail.workflow.id, {
        agentId: agent.id,
        name: agent.name,
        roleLabel: agent.name,
        responsibilityPrompt: "",
        allowedToolIds: undefined,
      });
    } finally {
      setMemberBusy(null);
    }
  }

  async function handleMemberPatch(memberId: string, payload: Parameters<typeof updateTeamMember>[2]) {
    if (!detail) {
      return;
    }

    try {
      setMemberBusy(memberId);
      await updateTeamMember(detail.workflow.id, memberId, payload);
    } finally {
      setMemberBusy(null);
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!detail || memberBusy) {
      return;
    }

    try {
      setMemberBusy(memberId);
      await removeTeamMember(detail.workflow.id, memberId);
    } finally {
      setMemberBusy(null);
    }
  }

  async function handleAddStep(type: WorkflowStepDefinition["type"]) {
    if (!detail || stepBusy) {
      return;
    }

    const firstMemberId = detail.teamMembers[0]?.id ?? null;
    if (type === "agent_task" && !firstMemberId) {
      window.alert("请先添加至少一个团队成员，再新增代理步骤。");
      return;
    }

    try {
      setStepBusy("create");
      if (type === "agent_task") {
        await addStep(detail.workflow.id, {
          type: "agent_task",
          name: `代理步骤 ${detail.steps.length + 1}`,
          memberId: firstMemberId!,
          promptTemplate: "请根据当前工作区完成本步骤任务。",
          outputMode: "text",
          nextStepId: null,
        });
        return;
      }

      if (type === "review_gate") {
        await addStep(detail.workflow.id, {
          type: "review_gate",
          name: `审查判断 ${detail.steps.length + 1}`,
          sourceStepId: detail.steps.find((item) => item.type === "agent_task")?.id ?? "",
          passNextStepId: null,
          failNextStepId: null,
          passRule: "review_json.pass == true",
        });
        return;
      }

      await addStep(detail.workflow.id, {
        type: "loop_control",
        name: `循环控制 ${detail.steps.length + 1}`,
        loopTargetStepId: detail.steps[0]?.id ?? null,
        continueWhen: "remainingLoops > 0",
        finishWhen: "remainingLoops <= 0",
      });
    } finally {
      setStepBusy(null);
    }
  }

  async function handleStepPatch(stepId: string, payload: Partial<WorkflowStepDefinition>) {
    if (!detail) {
      return;
    }

    try {
      setStepBusy(stepId);
      await updateStep(detail.workflow.id, stepId, payload);
    } finally {
      setStepBusy(null);
    }
  }

  async function handleRemoveStep(stepId: string) {
    if (!detail || stepBusy) {
      return;
    }

    try {
      setStepBusy(stepId);
      await removeStep(detail.workflow.id, stepId);
    } finally {
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
            <div>
              <h2 className="editor-empty-state-title text-xl">未找到该工作流</h2>
              <p className="editor-empty-state-copy">它可能已被删除，或当前链接无效。</p>
            </div>
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
          { icon: Square, label: "停止", tone: "default", onClick: handleStopRun },
        ]}
        contentClassName="min-h-0 flex-1 overflow-hidden"
      >
        <div className="flex h-full min-h-0 overflow-hidden">
          <section className="flex min-h-0 w-[460px] shrink-0 flex-col overflow-hidden border-r border-border bg-app max-xl:w-[420px] max-lg:w-[380px] max-md:w-[340px]">
            <div className="min-h-0 flex-1 overflow-y-auto p-4 xl:p-5">
              <div className="space-y-4">
              {errorMessage ? (
                <div className="editor-callout" data-tone="error">
                  <pre className="whitespace-pre-wrap break-words text-sm leading-6">{errorMessage}</pre>
                </div>
              ) : null}

              <WorkflowSection title="基本信息" description="保存名称、描述和工作流状态。">
                <LabeledField label="工作流名称">
                  <Input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="例如：章节生产流" />
                </LabeledField>
                <LabeledField label="描述">
                  <Textarea
                    value={draftDescription}
                    onChange={(event) => setDraftDescription(event.target.value)}
                    placeholder="描述这个工作流的目标、适用场景与输出。"
                    className="min-h-24"
                  />
                </LabeledField>
                <LabeledField label="状态">
                  <Select value={draftStatus} onValueChange={(value) => setDraftStatus(value as typeof draftStatus)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">草稿</SelectItem>
                      <SelectItem value="ready">就绪</SelectItem>
                      <SelectItem value="archived">归档</SelectItem>
                    </SelectContent>
                  </Select>
                </LabeledField>
              </WorkflowSection>

              <WorkflowSection title="工作区绑定" description="每个工作流绑定一本书，运行时以该书的 rootPath 作为工作区。">
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
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => void openBindingDialog()}>
                    <LinkIcon className="h-4 w-4" />
                    {detail.workflow.workspaceBinding ? "更换书籍" : "绑定书籍"}
                  </Button>
                </div>
              </WorkflowSection>

              <WorkflowSection title="团队成员" description="工作流团队成员来自代理库，同一代理可以重复加入并扮演不同角色。">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void handleAddMember()} disabled={enabledAgents.length === 0 || memberBusy !== null}>
                    <Plus className="h-4 w-4" />
                    添加成员
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void refreshAgents()}>
                    <RefreshCw className="h-4 w-4" />
                    刷新代理库
                  </Button>
                </div>

                {detail.teamMembers.length > 0 ? (
                  <div className="space-y-3">
                    {detail.teamMembers.map((member) => (
                      <article key={member.id} className="rounded-lg border border-border bg-panel-subtle p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                            <Users className="h-4 w-4 text-primary" />
                            <span>{member.name}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            <Switch
                              checked={member.enabled}
                              label={`切换成员 ${member.name}`}
                              disabled={memberBusy === member.id}
                              onChange={(checked) => void handleMemberPatch(member.id, { enabled: checked })}
                            />
                            <Button type="button" variant="outline" size="sm" onClick={() => void handleRemoveMember(member.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <LabeledField label="显示名称">
                            <Input
                              value={member.name}
                              onChange={(event) => void handleMemberPatch(member.id, { name: event.target.value })}
                            />
                          </LabeledField>
                          <LabeledField label="代理来源">
                            <Select
                              value={member.agentId}
                              onValueChange={(value) => {
                                const agent = enabledAgents.find((item) => item.id === value) ?? agents.find((item) => item.id === value);
                                void handleMemberPatch(member.id, {
                                  agentId: value,
                                  roleLabel: agent?.name ?? member.roleLabel,
                                } as Partial<WorkflowTeamMember>);
                              }}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {agents.map((agent) => (
                                  <SelectItem key={agent.id} value={agent.id}>
                                    {agent.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </LabeledField>
                          <LabeledField label="角色标签">
                            <Input
                              value={member.roleLabel}
                              onChange={(event) => void handleMemberPatch(member.id, { roleLabel: event.target.value })}
                            />
                          </LabeledField>
                          <div className="md:col-span-2">
                            <LabeledField label="职责补充提示词">
                              <Textarea
                                value={member.responsibilityPrompt}
                                onChange={(event) => void handleMemberPatch(member.id, { responsibilityPrompt: event.target.value })}
                                className="min-h-20"
                              />
                            </LabeledField>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    还没有团队成员。先从代理库中添加一个代理到工作流团队。
                  </div>
                )}
              </WorkflowSection>

              <WorkflowSection title="自由编排步骤" description="首版支持代理任务、审查判断和循环控制三类步骤，下一步通过引用步骤 ID 串联。">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void handleAddStep("agent_task")} disabled={stepBusy !== null}>
                    <Plus className="h-4 w-4" />
                    代理步骤
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void handleAddStep("review_gate")} disabled={stepBusy !== null}>
                    <GitBranch className="h-4 w-4" />
                    审查判断
                  </Button>
                  <Button type="button" variant="outline" onClick={() => void handleAddStep("loop_control")} disabled={stepBusy !== null}>
                    <RefreshCw className="h-4 w-4" />
                    循环控制
                  </Button>
                </div>

                {detail.steps.length > 0 ? (
                  <div className="space-y-3">
                    {detail.steps.map((step, index) => (
                      <article key={step.id} className="rounded-lg border border-border bg-panel-subtle p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs text-muted-foreground">Step {index + 1} · {formatStepType(step.type)}</p>
                            <p className="text-sm font-medium text-foreground">{step.name}</p>
                          </div>
                          <Button type="button" variant="outline" size="sm" onClick={() => void handleRemoveStep(step.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <LabeledField label="步骤名称">
                            <Input value={step.name} onChange={(event) => void handleStepPatch(step.id, { name: event.target.value })} />
                          </LabeledField>

                          {step.type === "agent_task" ? (
                            <>
                              <LabeledField label="执行成员">
                                <Select value={step.memberId} onValueChange={(value) => void handleStepPatch(step.id, { memberId: value })}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {detail.teamMembers.map((member) => (
                                      <SelectItem key={member.id} value={member.id}>
                                        {member.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </LabeledField>
                              <LabeledField label="输出模式">
                                <Select value={step.outputMode} onValueChange={(value) => void handleStepPatch(step.id, { outputMode: value as "text" | "review_json" })}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="text">文本</SelectItem>
                                    <SelectItem value="review_json">审查 JSON</SelectItem>
                                  </SelectContent>
                                </Select>
                              </LabeledField>
                              <div className="md:col-span-2">
                                <LabeledField label="步骤提示词模板">
                                  <Textarea
                                    value={step.promptTemplate}
                                    onChange={(event) => void handleStepPatch(step.id, { promptTemplate: event.target.value })}
                                    className="min-h-24"
                                  />
                                </LabeledField>
                              </div>
                              <LabeledField label="下一步">
                                <Select value={step.nextStepId ?? "__none__"} onValueChange={(value) => void handleStepPatch(step.id, { nextStepId: value === "__none__" ? null : value })}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">无</SelectItem>
                                    {detail.steps.filter((item) => item.id !== step.id).map((item) => (
                                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </LabeledField>
                            </>
                          ) : null}

                          {step.type === "review_gate" ? (
                            <>
                              <LabeledField label="审查来源步骤">
                                <Select value={step.sourceStepId || "__none__"} onValueChange={(value) => void handleStepPatch(step.id, { sourceStepId: value === "__none__" ? "" : value })}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">未选择</SelectItem>
                                    {detail.steps.filter((item) => item.type === "agent_task").map((item) => (
                                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </LabeledField>
                              <LabeledField label="通过分支">
                                <Select value={step.passNextStepId ?? "__none__"} onValueChange={(value) => void handleStepPatch(step.id, { passNextStepId: value === "__none__" ? null : value })}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">无</SelectItem>
                                    {detail.steps.filter((item) => item.id !== step.id).map((item) => (
                                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </LabeledField>
                              <LabeledField label="失败分支">
                                <Select value={step.failNextStepId ?? "__none__"} onValueChange={(value) => void handleStepPatch(step.id, { failNextStepId: value === "__none__" ? null : value })}>
                                  <SelectTrigger className="w-full">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">无</SelectItem>
                                    {detail.steps.filter((item) => item.id !== step.id).map((item) => (
                                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </LabeledField>
                            </>
                          ) : null}

                          {step.type === "loop_control" ? (
                            <LabeledField label="循环目标步骤">
                              <Select value={step.loopTargetStepId ?? "__none__"} onValueChange={(value) => void handleStepPatch(step.id, { loopTargetStepId: value === "__none__" ? null : value })}>
                                <SelectTrigger className="w-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">无</SelectItem>
                                  {detail.steps.filter((item) => item.id !== step.id).map((item) => (
                                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </LabeledField>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                    还没有步骤。可以先添加一个代理任务步骤，再补充审查与循环控制。
                  </div>
                )}
              </WorkflowSection>

              <WorkflowSection title="循环参数" description="控制每次运行最多执行多少轮，以及审查失败后的返工策略。">
                <div className="grid gap-3 md:grid-cols-2">
                  <LabeledField label="最大循环次数">
                    <Input value={maxLoops} onChange={(event) => setMaxLoops(event.target.value)} inputMode="numeric" />
                  </LabeledField>
                  <LabeledField label="每轮最大返工次数">
                    <Input value={maxReworkPerLoop} onChange={(event) => setMaxReworkPerLoop(event.target.value)} inputMode="numeric" />
                  </LabeledField>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border bg-panel-subtle px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">达到返工上限后直接终止</p>
                    <p className="text-xs text-muted-foreground">开启后，审查失败且返工次数达到上限时直接结束本次运行。</p>
                  </div>
                  <Switch checked={stopOnReviewFailure} label="停止条件" onChange={setStopOnReviewFailure} />
                </div>
              </WorkflowSection>
            </div>
            </div>
          </section>

          <aside className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-panel-subtle">
            <div className="border-b border-border p-4 xl:p-5">
              <div className="mb-3 text-xs leading-5 text-muted-foreground">
                右侧区域专门显示运行状态、步骤时间线和当前选中步骤的执行细节。
              </div>
              <div className="rounded-xl border border-border bg-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">当前运行</p>
                    <h2 className="mt-1 text-lg font-semibold text-foreground">{formatRunStatus(currentRun?.status ?? "idle")}</h2>
                  </div>
                  <div className="rounded-md border border-border bg-panel-subtle px-2 py-1 text-xs text-muted-foreground">
                    {currentRun ? `Loop ${currentRun.currentLoopIndex} / ${currentRun.maxLoops}` : "尚未运行"}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg border border-border bg-panel-subtle p-3">
                    <p className="text-xs text-muted-foreground">开始时间</p>
                    <p className="mt-1 text-foreground">{formatDateTime(currentRun?.startedAt ?? null)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-panel-subtle p-3">
                    <p className="text-xs text-muted-foreground">结束时间</p>
                    <p className="mt-1 text-foreground">{formatDateTime(currentRun?.finishedAt ?? null)}</p>
                  </div>
                </div>
                {currentRun?.summary ? <p className="mt-3 text-sm leading-6 text-muted-foreground">{currentRun.summary}</p> : null}
                {currentRun?.errorMessage ? (
                  <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {currentRun.errorMessage}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(220px,1fr)_minmax(260px,1fr)] overflow-hidden">
              <section className="min-h-0 overflow-y-auto border-b border-border p-4 xl:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">运行时间线</h3>
                  <span className="text-xs text-muted-foreground">{currentRunStepRuns.length} 个步骤记录</span>
                </div>
                {currentRunStepRuns.length > 0 ? (
                  <div className="space-y-2">
                    {currentRunStepRuns.map((stepRun) => {
                      const stepDefinition = detail.steps.find((item) => item.id === stepRun.stepId) ?? null;
                      const selected = selectedStepRun?.id === stepRun.id;
                      return (
                        <button
                          key={stepRun.id}
                          type="button"
                          onClick={() => selectStepRun(stepRun.id)}
                          className={[
                            "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                            selected
                              ? "border-primary bg-primary/5"
                              : "border-border bg-panel hover:bg-panel-subtle",
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-muted-foreground">
                                Loop {stepRun.loopIndex} · 尝试 {stepRun.attemptIndex}
                              </p>
                              <p className="mt-1 text-sm font-medium text-foreground">
                                {stepDefinition?.name ?? stepRun.stepId}
                              </p>
                              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                成员：{getMemberName(detail, stepRun.memberId)}
                              </p>
                              {stepRun.decision?.reason ? (
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{stepRun.decision.reason}</p>
                              ) : stepRun.resultText ? (
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{stepRun.resultText}</p>
                              ) : null}
                            </div>
                            <div className="shrink-0 rounded-md border border-border bg-panel-subtle px-2 py-1 text-[11px] text-muted-foreground">
                              {stepRun.status}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                    运行开始后，这里会按步骤展示时间线。
                  </div>
                )}
              </section>

              <section className="min-h-0 overflow-y-auto p-4 xl:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">步骤详情</h3>
                  {selectedStepRun ? (
                    <span className="text-xs text-muted-foreground">{formatDateTime(selectedStepRun.startedAt)}</span>
                  ) : null}
                </div>
                {selectedStepRun ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border bg-panel p-3">
                      <p className="text-xs text-muted-foreground">步骤</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {detail.steps.find((item) => item.id === selectedStepRun.stepId)?.name ?? selectedStepRun.stepId}
                      </p>
                      <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                        <p>成员：{getMemberName(detail, selectedStepRun.memberId)}</p>
                        <p>状态：{selectedStepRun.status}</p>
                        <p>循环：{selectedStepRun.loopIndex}</p>
                        <p>返工：{selectedStepRun.attemptIndex}</p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-border bg-panel p-3">
                      <p className="text-xs text-muted-foreground">输入提示词</p>
                      <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{selectedStepRun.inputPrompt || "—"}</pre>
                    </div>

                    {selectedStepRun.resultJson ? (
                      <div className="rounded-lg border border-border bg-panel p-3">
                        <p className="text-xs text-muted-foreground">结构化结果</p>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                          {JSON.stringify(selectedStepRun.resultJson, null, 2)}
                        </pre>
                      </div>
                    ) : null}

                    {selectedStepRun.resultText ? (
                      <div className="rounded-lg border border-border bg-panel p-3">
                        <p className="text-xs text-muted-foreground">输出文本</p>
                        <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{selectedStepRun.resultText}</pre>
                      </div>
                    ) : null}

                    {selectedStepRun.parts.length > 0 ? (
                      <div className="space-y-2">
                        {selectedStepRun.parts.map((part, index) => (
                          <div key={`${selectedStepRun.id}-part-${index}`} className="rounded-lg border border-border bg-panel p-3">
                            <AgentPartRenderer part={part} />
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {selectedStepRun.errorMessage ? (
                      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {selectedStepRun.errorMessage}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                    选择一个步骤记录后，这里会显示输入、输出、工具调用和结构化结果。
                  </div>
                )}
              </section>
            </div>
          </aside>
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
