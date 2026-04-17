import {
  Download,
  Ellipsis,
  GitBranch,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ActionMenu,
  ActionMenuItem,
  type ActionMenuAnchorRect,
} from "../components/common/ActionMenu";
import { Toast, type ToastTone } from "../components/common/Toast";
import { PageShell } from "../components/PageShell";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { PromptDialog } from "../components/dialogs/PromptDialog";
import { buildWorkflowRoute } from "../lib/workflow/routes";
import type { Workflow } from "../lib/workflow/types";
import { useWorkflowStore } from "../stores/workflowStore";

function formatRunStatus(status: string) {
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

type ToastState = {
  description?: string;
  title: string;
  tone: ToastTone;
};

type WorkflowMenuState = {
  anchorRect: ActionMenuAnchorRect;
  workflow: Workflow;
};

function toAnchorRect(rect: DOMRect): ActionMenuAnchorRect {
  return {
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    top: rect.top,
  };
}

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

export function WorkflowsPage() {
  const navigate = useNavigate();
  const workflows = useWorkflowStore((state) => state.workflows);
  const status = useWorkflowStore((state) => state.status);
  const errorMessage = useWorkflowStore((state) => state.errorMessage);
  const initialize = useWorkflowStore((state) => state.initialize);
  const refreshList = useWorkflowStore((state) => state.refreshList);
  const createWorkflow = useWorkflowStore((state) => state.createWorkflow);
  const exportWorkflowZip = useWorkflowStore(
    (state) => state.exportWorkflowZip,
  );
  const deleteWorkflowById = useWorkflowStore(
    (state) => state.deleteWorkflowById,
  );
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [menuState, setMenuState] = useState<WorkflowMenuState | null>(null);
  const [exportBusyId, setExportBusyId] = useState<string | null>(null);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null);
  const [toastState, setToastState] = useState<ToastState | null>(null);

  useEffect(() => {
    if (status === "idle") {
      void initialize();
    }
  }, [initialize, status]);

  function openWorkflowMenu(
    workflow: Workflow,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
    const nextAnchorRect = toAnchorRect(
      event.currentTarget.getBoundingClientRect(),
    );
    setMenuState((current) => {
      if (current?.workflow.id === workflow.id) {
        return null;
      }

      return {
        anchorRect: nextAnchorRect,
        workflow,
      };
    });
  }

  function handleWorkflowTileKeyDown(
    workflowId: string,
    event: KeyboardEvent<HTMLElement>,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigate(buildWorkflowRoute(workflowId));
    }
  }

  async function handleCreateWorkflow() {
    if (createBusy) {
      return;
    }

    const name = draftName.trim();
    if (!name) {
      return;
    }

    setCreateBusy(true);
    try {
      const workflow = await createWorkflow(name);
      setCreateDialogOpen(false);
      setDraftName("");
      navigate(buildWorkflowRoute(workflow.id));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleExportWorkflow(workflow: Workflow) {
    if (exportBusyId || deleteBusyId) {
      return;
    }

    try {
      setMenuState(null);
      setExportBusyId(workflow.id);
      const savedPath = await exportWorkflowZip(workflow.id);
      if (!savedPath) {
        return;
      }
      setToastState({
        title: `已导出工作流《${workflow.name}》`,
        description: savedPath,
        tone: "success",
      });
    } catch (error) {
      setToastState({
        title: `导出《${workflow.name}》失败`,
        description: getReadableError(error),
        tone: "error",
      });
    } finally {
      setExportBusyId(null);
    }
  }

  async function handleDeleteWorkflow() {
    if (!deleteTarget || deleteBusyId) {
      return;
    }

    try {
      setDeleteBusyId(deleteTarget.id);
      await deleteWorkflowById(deleteTarget.id);
      setToastState({
        title: `已删除工作流《${deleteTarget.name}》`,
        tone: "success",
      });
      setDeleteTarget(null);
      setMenuState(null);
    } catch (error) {
      setToastState({
        title: `删除《${deleteTarget.name}》失败`,
        description: getReadableError(error),
        tone: "error",
      });
    } finally {
      setDeleteBusyId(null);
    }
  }

  const menuWorkflow = menuState?.workflow ?? null;
  const hasPendingWorkflowAction =
    exportBusyId !== null || deleteBusyId !== null;

  return (
    <>
      <PageShell
        title={
          <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
            工作流库
          </div>
        }
        actions={[
          {
            icon: RefreshCw,
            label: "刷新工作流",
            tone: "default",
            onClick: () => void refreshList(),
          },
          {
            icon: Plus,
            label: "新建工作流",
            tone: "primary",
            onClick: () => setCreateDialogOpen(true),
          },
        ]}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          {errorMessage ? (
            <div className="editor-callout" data-tone="error">
              <pre className="whitespace-pre-wrap break-words text-sm leading-6">
                {errorMessage}
              </pre>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {status === "loading" ? (
              <div className="editor-empty-state border-solid bg-panel">
                正在加载工作流...
              </div>
            ) : workflows.length > 0 ? (
              <div className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                {workflows.map((workflow) => (
                  <article
                    key={workflow.id}
                    className={[
                      "editor-block-tile",
                      exportBusyId === workflow.id ||
                      deleteBusyId === workflow.id
                        ? "opacity-70"
                        : "",
                    ].join(" ")}
                  >
                    <div
                      role="link"
                      tabIndex={0}
                      onClick={() => navigate(buildWorkflowRoute(workflow.id))}
                      onKeyDown={(event) =>
                        handleWorkflowTileKeyDown(workflow.id, event)
                      }
                      className="editor-block-content justify-between overflow-hidden rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                            Workflow
                          </p>
                          <h2 className="mt-2 line-clamp-3 text-[22px] font-semibold leading-[1.12] tracking-[-0.05em] text-foreground">
                            {workflow.name}
                          </h2>
                        </div>
                        <Button
                          type="button"
                          aria-label={`更多操作 ${workflow.name}`}
                          disabled={hasPendingWorkflowAction}
                          onClick={(event) => openWorkflowMenu(workflow, event)}
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0 text-muted-foreground"
                        >
                          <Ellipsis className="h-4 w-4" />
                        </Button>
                      </div>
                        <div className="space-y-3">
                          <p className="line-clamp-3 text-xs leading-4 text-muted-foreground">
                            {workflow.basePrompt ||
                              workflow.description ||
                              "将书籍、代理和步骤组织成一条可重复执行的自动化流程。"}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            <span className="inline-flex items-center rounded-md border border-border bg-panel-subtle px-2 py-1 text-[11px] font-medium text-muted-foreground">
                              {workflow.workspaceBinding?.bookName ??
                                "未绑定书籍"}
                          </span>
                        </div>
                        <div className="space-y-1.5 text-[11px] leading-5 text-muted-foreground">
                          <p>
                            步骤 {workflow.stepIds.length}
                          </p>
                          <p>
                            最近运行：{formatRunStatus(workflow.lastRunStatus)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="editor-empty-state min-h-[320px]">
                <div className="max-w-xl">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-border bg-panel-subtle text-primary">
                    <GitBranch className="h-7 w-7" />
                  </div>
                  <h2 className="mt-5 text-[28px] font-semibold tracking-[-0.05em] text-foreground">
                    先创建一个工作流。
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">
                    将书籍、代理和自由编排步骤组织起来，形成可重复执行的自动化创作流程。
                  </p>
                  <div className="mt-8 flex items-center justify-center gap-3">
                    <Button
                      type="button"
                      onClick={() => setCreateDialogOpen(true)}
                    >
                      <Plus className="h-4 w-4" />
                      新建工作流
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </PageShell>

      {createDialogOpen ? (
        <PromptDialog
          busy={createBusy}
          confirmLabel="创建工作流"
          description="输入工作流名称后，即可进入详情页继续配置书籍绑定、代理和步骤。"
          label="工作流名称"
          onCancel={() => {
            if (createBusy) {
              return;
            }
            setCreateDialogOpen(false);
          }}
          onChange={setDraftName}
          onConfirm={() => void handleCreateWorkflow()}
          title="新建工作流"
          value={draftName}
        />
      ) : null}

      <ActionMenu
        anchorRect={menuState?.anchorRect ?? null}
        onClose={() => setMenuState(null)}
        width={188}
      >
        {menuWorkflow ? (
          <div className="space-y-1">
            <ActionMenuItem
              ariaLabel="导出工作流"
              disabled={hasPendingWorkflowAction}
              onClick={() => void handleExportWorkflow(menuWorkflow)}
            >
              <span className="flex items-center gap-2">
                <Download className="h-4 w-4 shrink-0" />
                <span>
                  {exportBusyId === menuWorkflow.id
                    ? "导出中..."
                    : "导出工作流"}
                </span>
              </span>
            </ActionMenuItem>
            <ActionMenuItem
              ariaLabel="删除工作流"
              disabled={hasPendingWorkflowAction}
              onClick={() => {
                setMenuState(null);
                setDeleteTarget(menuWorkflow);
              }}
            >
              <span className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 shrink-0" />
                <span>
                  {deleteBusyId === menuWorkflow.id
                    ? "删除中..."
                    : "删除工作流"}
                </span>
              </span>
            </ActionMenuItem>
          </div>
        ) : null}
      </ActionMenu>

      {deleteTarget ? (
        <ConfirmDialog
          busy={deleteBusyId === deleteTarget.id}
          confirmLabel="删除工作流"
          description={`将《${deleteTarget.name}》从工作流库中删除。相关步骤、代理绑定与运行记录会一并移除。`}
          onCancel={() => {
            if (deleteBusyId) {
              return;
            }
            setDeleteTarget(null);
          }}
          onConfirm={() => void handleDeleteWorkflow()}
          title="删除工作流"
        />
      ) : null}

      <Toast
        description={toastState?.description}
        open={toastState !== null}
        title={toastState?.title ?? ""}
        tone={toastState?.tone ?? "info"}
        onClose={() => setToastState(null)}
      />
    </>
  );
}
