import {
  Download,
  Ellipsis,
  Feather,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toast, type ToastTone } from "../components/common/Toast";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { PromptDialog } from "../components/dialogs/PromptDialog";
import { PageShell } from "../components/PageShell";
import {
  createExpansionWorkspace,
  deleteExpansionWorkspace,
  exportExpansionZip,
  importExpansionZip,
  listExpansionWorkspaces,
} from "../lib/expansion/api";
import { buildExpansionDetailRoute } from "../lib/expansion/routes";
import type { ExpansionWorkspaceSummary } from "../lib/expansion/types";

type LoadStatus = "loading" | "ready";

type ToastState = {
  description?: string;
  title: string;
  tone: ToastTone;
};

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

export function ExpansionsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ExpansionWorkspaceSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [exportBusyId, setExportBusyId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpansionWorkspaceSummary | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void refresh(true);
  }, []);

  async function refresh(showLoading = false) {
    if (showLoading) setStatus("loading");
    try {
      setErrorMessage(null);
      const next = await listExpansionWorkspaces();
      setItems(next);
    } catch (error) {
      setErrorMessage(getReadableError(error));
    } finally {
      setStatus("ready");
    }
  }

  function handleTileKeyDown(id: string, event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigate(buildExpansionDetailRoute(id));
    }
  }

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!file || importBusy) return;
    try {
      setImportBusy(true);
      setErrorMessage(null);
      const archiveBytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const summary = await importExpansionZip(file.name, archiveBytes);
      navigate(buildExpansionDetailRoute(summary.id));
    } catch (error) {
      setErrorMessage(getReadableError(error));
    } finally {
      setImportBusy(false);
    }
  }

  async function handleCreate() {
    if (createBusy) return;
    const name = draftName.trim();
    if (!name) {
      setToastState({ title: "书名不能为空。", tone: "error" });
      return;
    }
    try {
      setCreateBusy(true);
      setErrorMessage(null);
      const summary = await createExpansionWorkspace(name);
      setCreateOpen(false);
      setDraftName("");
      navigate(buildExpansionDetailRoute(summary.id));
    } catch (error) {
      setErrorMessage(getReadableError(error));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleExport(item: ExpansionWorkspaceSummary) {
    if (exportBusyId || deleteBusyId) return;
    try {
      setExportBusyId(item.id);
      setErrorMessage(null);
      const exported = await exportExpansionZip(item.id);
      if (!exported) return;
      setToastState({ title: `已导出《${item.name}》`, tone: "success" });
    } catch (error) {
      setErrorMessage(getReadableError(error));
    } finally {
      setExportBusyId(null);
    }
  }

  async function handleDelete() {
    const target = deleteTarget;
    if (!target || deleteBusyId) return;
    try {
      setDeleteBusyId(target.id);
      setErrorMessage(null);
      await deleteExpansionWorkspace(target.id);
      setDeleteTarget(null);
      await refresh();
      setToastState({ title: `已删除《${target.name}》`, tone: "success" });
    } catch (error) {
      setErrorMessage(getReadableError(error));
    } finally {
      setDeleteBusyId(null);
    }
  }

  const hasPendingAction = deleteBusyId !== null || exportBusyId !== null;

  return (
    <>
      <PageShell
        title={
          <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
            扩写工坊
          </div>
        }
        actions={[
          { icon: RefreshCw, label: "刷新列表", tone: "default", onClick: () => void refresh() },
          {
            icon: Upload,
            label: importBusy ? "导入中..." : "导入扩写书籍",
            tone: "default",
            onClick: () => {
              if (importBusy) return;
              importInputRef.current?.click();
            },
          },
          { icon: Plus, label: "新建扩写书籍", tone: "primary", onClick: () => setCreateOpen(true) },
        ]}
      >
        <input
          ref={importInputRef}
          hidden
          accept=".zip,application/zip"
          type="file"
          onChange={(event) => void handleImportChange(event)}
        />

        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          {errorMessage ? (
            <div className="editor-callout" data-tone="error">
              <pre className="whitespace-pre-wrap break-words text-sm leading-6">{errorMessage}</pre>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {status === "loading" ? (
              <div className="editor-empty-state border-solid bg-panel">正在加载扩写书架...</div>
            ) : items.length > 0 ? (
              <div className="editor-block-grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                {items.map((item) => {
                  const isDeleting = deleteBusyId === item.id;
                  const isExporting = exportBusyId === item.id;
                  return (
                    <article
                      key={item.id}
                      className={[
                        "editor-block-tile",
                        isDeleting || isExporting ? "opacity-70" : "",
                      ].join(" ")}
                    >
                      <div
                        role="link"
                        tabIndex={0}
                        onClick={() => navigate(buildExpansionDetailRoute(item.id))}
                        onKeyDown={(event) => handleTileKeyDown(item.id, event)}
                        className="editor-block-content cursor-pointer overflow-hidden rounded-none outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                              Expansion
                            </p>
                            <h2 className="mt-2 line-clamp-3 text-[24px] font-semibold leading-[1.15] tracking-[-0.05em] text-foreground">
                              {item.name}
                            </h2>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                aria-label={`更多操作 ${item.name}`}
                                title={`更多操作 ${item.name}`}
                                disabled={hasPendingAction}
                                onClick={(event) => event.stopPropagation()}
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                              >
                                <Ellipsis className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                              <DropdownMenuItem
                                disabled={hasPendingAction}
                                onSelect={() => void handleExport(item)}
                              >
                                <Download className="h-4 w-4" />
                                {exportBusyId === item.id ? "导出中..." : "导出扩写"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={hasPendingAction}
                                onSelect={() => setDeleteTarget(item)}
                              >
                                <Trash2 className="h-4 w-4" />
                                {deleteBusyId === item.id ? "删除中..." : "删除扩写"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="editor-empty-state min-h-[320px]">
                <div className="max-w-xl">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-border bg-panel-subtle text-primary">
                    <Feather className="h-7 w-7" />
                  </div>
                  <h2 className="mt-5 text-[28px] font-semibold tracking-[-0.05em] text-foreground">
                    新建一本扩写书籍开始 AI 自动扩写。
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">
                    扩写模式由 JSON + 程序驱动：大纲驱动细纲，细纲驱动正文，正文回写设定，全过程由 AI 自动完成。
                  </p>
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={importBusy}
                      onClick={() => importInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4" />
                      导入扩写 ZIP
                    </Button>
                    <Button type="button" onClick={() => setCreateOpen(true)}>
                      <Plus className="h-4 w-4" />
                      新建扩写书籍
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </PageShell>

      {createOpen ? (
        <PromptDialog
          busy={createBusy}
          confirmLabel="创建书籍"
          description="输入扩写书籍名称，将在 SQLite 中初始化 project / settings / chapters 三段。"
          label="书名"
          onCancel={() => {
            if (createBusy) return;
            setCreateOpen(false);
          }}
          onChange={setDraftName}
          onConfirm={() => void handleCreate()}
          title="新建扩写书籍"
          value={draftName}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          busy={deleteBusyId === deleteTarget.id}
          confirmLabel="删除扩写"
          description={`将《${deleteTarget.name}》及其所有 JSON 数据从 SQLite 中永久删除。`}
          onCancel={() => {
            if (deleteBusyId) return;
            setDeleteTarget(null);
          }}
          onConfirm={() => void handleDelete()}
          title="删除扩写书籍"
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
