import { BookOpenText, Download, Ellipsis, Network, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Button } from "@shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@shared/ui/dropdown-menu";
import { Toast, type ToastTone } from "@shared/components/Toast";
import { ConfirmDialog } from "@shared/components/dialogs/ConfirmDialog";
import { PromptDialog } from "@shared/components/dialogs/PromptDialog";
import { PageShell } from "@shared/components/PageShell";
import { cn } from "@shared/utils";
import {
  clearStoredWorkspaceSnapshot,
  createBookWorkspace,
  deleteBookWorkspace,
  exportBookZip,
  getStoredWorkspaceSnapshot,
  importBookZip,
  listBookWorkspaces,
} from "@features/books/api/bookWorkspaceApi";
import { normalizeEntryName, validateEntryName } from "@features/books/lib/paths";
import { buildBookWorkspaceRoute, buildBookRelationsRoute } from "@features/books/lib/routes";
import type { BookWorkspaceSummary } from "@features/books/types";
import { useNavigate } from "react-router-dom";

type BookLibraryUpdateAction = {
  label: string;
  onClick: () => void;
  text: string;
};

type LoadStatus = "loading" | "ready";

type ToastState = {
  description?: string;
  title: string;
  tone: ToastTone;
};

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

function formatBookUpdatedAt(updatedAt: number) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return "暂无编辑时间";
  }

  const timestamp = updatedAt < 10_000_000_000 ? updatedAt * 1000 : updatedAt;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function BookLibraryPage({ updateAction }: { updateAction?: BookLibraryUpdateAction } = {}) {
  const navigate = useNavigate();
  const [books, setBooks] = useState<BookWorkspaceSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [deleteBusyPath, setDeleteBusyPath] = useState<string | null>(null);
  const [exportBusyPath, setExportBusyPath] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookWorkspaceSummary | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void refreshBooks(true);
  }, []);

  async function refreshBooks(showLoadingState = false) {
    if (showLoadingState) {
      setStatus("loading");
    }

    try {
      setErrorMessage(null);
      const nextBooks = await listBookWorkspaces();
      setBooks(nextBooks);
    } catch (error) {
      setErrorMessage(getReadableError(error));
    } finally {
      setStatus("ready");
    }
  }

  function handleBookTileKeyDown(bookId: string, event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      navigate(buildBookWorkspaceRoute(bookId));
    }
  }

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!file || importBusy) {
      return;
    }

    try {
      setImportBusy(true);
      setErrorMessage(null);
      const archiveBytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      const workspace = await importBookZip(file.name, archiveBytes);
      navigate(buildBookWorkspaceRoute(workspace.id));
    } catch (error) {
      setErrorMessage(getReadableError(error));
    } finally {
      setImportBusy(false);
    }
  }

  async function handleCreateBook() {
    if (createBusy) {
      return;
    }

    const bookName = normalizeEntryName(draftName);
    const validationMessage = validateEntryName(bookName);
    if (validationMessage) {
      setToastState({ title: validationMessage, tone: "error" });
      return;
    }

    try {
      setCreateBusy(true);
      setErrorMessage(null);
      const workspace = await createBookWorkspace("", bookName);
      setCreateDialogOpen(false);
      setDraftName("");
      navigate(buildBookWorkspaceRoute(workspace.id));
    } catch (error) {
      setErrorMessage(getReadableError(error));
    } finally {
      setCreateBusy(false);
    }
  }

  async function handleExportBook(book: BookWorkspaceSummary) {
    if (exportBusyPath || deleteBusyPath) {
      return;
    }

    try {
      setExportBusyPath(book.path);
      setErrorMessage(null);
      const exportedPath = await exportBookZip(book.id);
      if (!exportedPath) {
        return;
      }

      setToastState({
        title: `已导出《${book.name}》`,
        tone: "success",
      });
    } catch (error) {
      setErrorMessage(getReadableError(error));
    } finally {
      setExportBusyPath(null);
    }
  }

  async function handleDeleteBook() {
    const currentTarget = deleteTarget;
    if (!currentTarget || deleteBusyPath) {
      return;
    }

    try {
      setDeleteBusyPath(currentTarget.path);
      setErrorMessage(null);
      await deleteBookWorkspace(currentTarget.id);
      if (getStoredWorkspaceSnapshot()?.bookId === currentTarget.id) {
        clearStoredWorkspaceSnapshot();
      }

      setDeleteTarget(null);
      await refreshBooks();
      setToastState({
        title: `已删除《${currentTarget.name}》`,
        tone: "success",
      });
    } catch (error) {
      setErrorMessage(getReadableError(error));
    } finally {
      setDeleteBusyPath(null);
    }
  }

  const hasPendingBookAction = deleteBusyPath !== null || exportBusyPath !== null;

  return (
    <>
      <PageShell
        title={<div className="truncate text-[22px] font-semibold leading-tight tracking-[-0.04em] text-foreground">书架</div>}
        actions={[
          ...(updateAction
            ? [{ icon: Download, label: updateAction.label, text: updateAction.text, tone: "primary" as const, onClick: updateAction.onClick }]
            : []),
          { icon: RefreshCw, label: "刷新书架", tone: "default", onClick: () => void refreshBooks() },
          {
            icon: Upload,
            label: importBusy ? "导入中..." : "导入书籍",
            tone: "default",
            onClick: () => {
              if (importBusy) {
                return;
              }

              importInputRef.current?.click();
            },
          },
          { icon: Plus, label: "新建书籍", tone: "primary", onClick: () => setCreateDialogOpen(true) },
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
              <div className="editor-empty-state border-solid bg-panel">
                正在加载书架...
              </div>
            ) : books.length > 0 ? (
              <div className="editor-block-grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
                  {books.map((book) => {
                    const isDeleting = deleteBusyPath === book.path;
                    const isExporting = exportBusyPath === book.path;

                    return (
                      <article
                        key={book.id}
                        className={cn(
                          "editor-block-tile group/book-card",
                          (isDeleting || isExporting) && "opacity-70",
                        )}
                      >
                        <div
                          role="link"
                          aria-label={`Book ${book.name}`}
                          tabIndex={0}
                          onClick={() => navigate(buildBookWorkspaceRoute(book.id))}
                          onKeyDown={(event) => handleBookTileKeyDown(book.id, event)}
                          className="editor-block-content cursor-pointer overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-inset"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">Book</p>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  aria-label={`更多操作 ${book.name}`}
                                  title={`更多操作 ${book.name} — 打开这本书的操作菜单`}
                                  disabled={hasPendingBookAction}
                                  onClick={(event) => event.stopPropagation()}
                                  variant="ghost"
                                  size="icon-sm"
                                  className="rounded-lg text-muted-foreground opacity-80 transition-opacity group-hover/book-card:opacity-100"
                                >
                                  <Ellipsis className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                                <DropdownMenuItem
                                  onSelect={() => navigate(buildBookRelationsRoute(book.id))}
                                >
                                  <Network className="h-4 w-4" />
                                  关联图谱
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={hasPendingBookAction}
                                  onSelect={() => void handleExportBook(book)}
                                >
                                  <Download className="h-4 w-4" />
                                  {exportBusyPath === book.path ? "导出中..." : "导出图书"}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={hasPendingBookAction}
                                  onSelect={() => setDeleteTarget(book)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {deleteBusyPath === book.path ? "删除中..." : "删除图书"}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>

                          <div className="min-w-0 flex-1">
                            <h2 className="mt-1.5 line-clamp-3 text-[20px] font-semibold leading-[1.15] tracking-[-0.05em] text-foreground sm:mt-2 sm:text-[24px]">
                              {book.name}
                            </h2>
                          </div>

                          <p className="mt-auto truncate border-t border-border/70 pt-2 text-[11px] text-muted-foreground sm:pt-3 sm:text-xs">
                            最近编辑 {formatBookUpdatedAt(book.updatedAt)}
                          </p>
                        </div>
                      </article>
                    );
                  })}
              </div>
            ) : (
              <div className="flex h-full min-h-[320px] items-center justify-center px-8 text-center">
                <div className="max-w-xl">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-md border border-border bg-panel-subtle text-primary">
                    <BookOpenText className="h-7 w-7" />
                  </div>
                  <h2 className="mt-5 text-[28px] font-semibold tracking-[-0.05em] text-foreground">
                    先导入一本书，或新建一本书。
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-muted-foreground">
                    支持将标准 ZIP 书籍包导入 SQLite 书库。导入完成后会直接进入工作区，新建书籍则会生成默认创作模板。
                  </p>
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={importBusy}
                      onClick={() => importInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4" />
                      导入书籍 ZIP
                    </Button>
                    <Button
                      type="button"
                      onClick={() => setCreateDialogOpen(true)}
                    >
                      <Plus className="h-4 w-4" />
                      新建书籍
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
          confirmLabel="创建书籍"
          description="输入书名后，系统会在 SQLite 书库中初始化中文模板结构。"
          label="书名"
          onCancel={() => {
            if (createBusy) {
              return;
            }

            setCreateDialogOpen(false);
          }}
          onChange={setDraftName}
          onConfirm={() => void handleCreateBook()}
          title="新建书籍"
          value={draftName}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          busy={deleteBusyPath === deleteTarget.path}
          confirmLabel="删除图书"
          description={`将《${deleteTarget.name}》从 SQLite 书库中永久删除。`}
          onCancel={() => {
            if (deleteBusyPath) {
              return;
            }

            setDeleteTarget(null);
          }}
          onConfirm={() => void handleDeleteBook()}
          title="删除图书"
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
