import { BookOpenText, Download, Ellipsis, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from "react";
import { ActionMenu, ActionMenuItem, type ActionMenuAnchorRect } from "../components/common/ActionMenu";
import { Toast, type ToastTone } from "../components/common/Toast";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { PromptDialog } from "../components/dialogs/PromptDialog";
import { PageShell } from "../components/PageShell";
import {
  clearStoredWorkspaceSnapshot,
  createBookWorkspace,
  deleteBookWorkspace,
  exportBookZip,
  getStoredWorkspaceSnapshot,
  importBookZip,
  listBookWorkspaces,
} from "../lib/bookWorkspace/api";
import { normalizeEntryName, validateEntryName } from "../lib/bookWorkspace/paths";
import { buildBookWorkspaceRoute } from "../lib/bookWorkspace/routes";
import type { BookWorkspaceSummary } from "../lib/bookWorkspace/types";
import { useNavigate } from "react-router-dom";

type LoadStatus = "loading" | "ready";

type ToastState = {
  description?: string;
  title: string;
  tone: ToastTone;
};

type BookMenuState = {
  anchorRect: ActionMenuAnchorRect;
  book: BookWorkspaceSummary;
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

function formatUpdatedAt(updatedAt: number) {
  if (!updatedAt) {
    return "最近更新未知";
  }

  return `最近更新 ${new Date(updatedAt * 1000).toLocaleString()}`;
}

export function HomePage() {
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
  const [bookMenuState, setBookMenuState] = useState<BookMenuState | null>(null);
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

  function openBookMenu(book: BookWorkspaceSummary, event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const nextAnchorRect = toAnchorRect(event.currentTarget.getBoundingClientRect());
    setBookMenuState((current) => {
      if (current?.book.id === book.id) {
        return null;
      }

      return {
        anchorRect: nextAnchorRect,
        book,
      };
    });
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
      setBookMenuState(null);
      setExportBusyPath(book.path);
      setErrorMessage(null);
      const exportedPath = await exportBookZip(book.path);
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
      await deleteBookWorkspace(currentTarget.path);
      if (getStoredWorkspaceSnapshot()?.rootPath === currentTarget.path) {
        clearStoredWorkspaceSnapshot();
      }

      setDeleteTarget(null);
      setBookMenuState(null);
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

  const menuBook = bookMenuState?.book ?? null;
  const hasPendingBookAction = deleteBusyPath !== null || exportBusyPath !== null;

  return (
    <>
      <PageShell
        title={<h1 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-[#111827] dark:text-zinc-100">首页</h1>}
        actions={[
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
          <div className="flex flex-wrap items-center gap-2 border-b border-[#e2e8f0] px-4 py-3 text-xs text-[#526074] dark:border-[#20242b] dark:text-zinc-400 sm:px-5">
            <span>共 {books.length} 本书籍</span>
            <span>支持导入 ZIP 到内置书库</span>
            <span>点击图书可进入图书工作区</span>
          </div>

          {errorMessage ? (
            <div className="border-b border-[#f1d1d1] bg-[#fff5f5] px-4 py-3 text-sm text-[#b42318] dark:border-[#4a2323] dark:bg-[#221314] dark:text-[#ffb4ab] sm:px-5">
              <p className="font-medium">书籍操作失败</p>
              <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{errorMessage}</pre>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            {status === "loading" ? (
              <div className="flex h-full min-h-[240px] items-center justify-center rounded-[20px] border border-[#e2e8f0] bg-white px-6 text-sm text-[#64748b] dark:border-[#20242b] dark:bg-[#111214] dark:text-zinc-400">
                正在加载书架...
              </div>
            ) : books.length > 0 ? (
              <div className="px-1 py-2">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(138px,1fr))] items-stretch gap-4 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]">
                  {books.map((book) => {
                    const isDeleting = deleteBusyPath === book.path;
                    const isExporting = exportBusyPath === book.path;

                    return (
                      <div
                        key={book.id}
                        className={[
                          "group relative aspect-[3/4] overflow-hidden border border-[#e2e8f0] bg-white shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition-all duration-200 dark:border-[#20242b] dark:bg-[#111214]",
                          isDeleting || isExporting
                            ? "opacity-70"
                            : "hover:-translate-y-1 hover:border-[#cfd8e3] hover:shadow-[0_16px_30px_rgba(15,23,42,0.1)] dark:hover:border-[#2a313b] dark:hover:shadow-[0_16px_30px_rgba(0,0,0,0.28)]",
                        ].join(" ")}
                      >
                        <button
                          type="button"
                          aria-label={`打开书籍 ${book.name}`}
                          onClick={() => navigate(buildBookWorkspaceRoute(book.id))}
                          className="flex h-full w-full flex-col justify-between p-4 pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b84e7] focus-visible:ring-inset dark:focus-visible:ring-[#7cc4ff]"
                        >
                          <div className="space-y-4">
                            <div className="h-px w-full bg-[#eef2f6] dark:bg-[#20242b]" />
                            <h2 className="line-clamp-5 break-words text-[22px] font-semibold leading-[1.14] tracking-[-0.05em] text-[#111827] dark:text-zinc-100">
                              {book.name}
                            </h2>
                          </div>

                          <div className="border-t border-[#eef2f6] pt-3 dark:border-[#20242b]">
                            <p className="text-xs leading-6 text-[#64748b] dark:text-zinc-400">{formatUpdatedAt(book.updatedAt)}</p>
                          </div>
                        </button>

                        <button
                          type="button"
                          aria-label={`更多操作 ${book.name}`}
                          disabled={hasPendingBookAction}
                          onClick={(event) => openBookMenu(book, event)}
                          className="absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center border border-transparent text-[#64748b] transition-colors duration-200 hover:border-[#e2e8f0] hover:bg-[#f8fafc] hover:text-[#111827] disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-400 dark:hover:border-[#20242b] dark:hover:bg-[#15181d] dark:hover:text-zinc-100"
                        >
                          <Ellipsis className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[280px] items-center justify-center rounded-[24px] border border-dashed border-[#d8e1ec] bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_100%)] px-6 text-center dark:border-[#2a3038] dark:bg-[linear-gradient(180deg,#13161b_0%,#101318_100%)]">
                <div className="max-w-xl">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#0b84e7]/10 text-[#0b84e7] dark:bg-[#7cc4ff]/12 dark:text-[#7cc4ff]">
                    <BookOpenText className="h-7 w-7" />
                  </div>
                  <h2 className="mt-5 text-[28px] font-semibold tracking-[-0.05em] text-[#111827] dark:text-zinc-100">
                    先导入一本书，或新建一本书。
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-[#64748b] dark:text-zinc-400">
                    支持导入标准 ZIP 书籍包并自动解压到内置书库。导入完成后会直接进入工作区，新建书籍则会生成默认创作模板。
                  </p>
                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      disabled={importBusy}
                      onClick={() => importInputRef.current?.click()}
                      className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#d7dde8] px-4 text-sm font-medium text-[#111827] transition-colors duration-200 hover:bg-[#edf1f6] disabled:cursor-not-allowed disabled:opacity-60 dark:border-[#2a3038] dark:text-zinc-100 dark:hover:bg-[#1b1f26]"
                    >
                      <Upload className="h-4 w-4" />
                      导入书籍 ZIP
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateDialogOpen(true)}
                      className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#0f172a] px-4 text-sm font-medium text-white transition-colors duration-200 hover:bg-[#1e293b] dark:bg-[#f3f4f6] dark:text-[#111827] dark:hover:bg-white"
                    >
                      <Plus className="h-4 w-4" />
                      新建书籍
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </PageShell>

      <ActionMenu anchorRect={bookMenuState?.anchorRect ?? null} onClose={() => setBookMenuState(null)} width={188}>
        {menuBook ? (
          <div className="space-y-1">
            <ActionMenuItem
              ariaLabel="导出图书"
              disabled={hasPendingBookAction}
              onClick={() => void handleExportBook(menuBook)}
            >
              <span className="flex items-center gap-2">
                <Download className="h-4 w-4 shrink-0" />
                <span>{exportBusyPath === menuBook.path ? "导出中..." : "导出图书"}</span>
              </span>
            </ActionMenuItem>
            <ActionMenuItem
              ariaLabel="删除图书"
              disabled={hasPendingBookAction}
              onClick={() => {
                setBookMenuState(null);
                setDeleteTarget(menuBook);
              }}
            >
              <span className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 shrink-0" />
                <span>{deleteBusyPath === menuBook.path ? "删除中..." : "删除图书"}</span>
              </span>
            </ActionMenuItem>
          </div>
        ) : null}
      </ActionMenu>

      {createDialogOpen ? (
        <PromptDialog
          busy={createBusy}
          confirmLabel="创建书籍"
          description="输入书名后，系统会在应用内置书库中自动初始化中文模板结构。"
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
          description={`将《${deleteTarget.name}》从内置书库中永久删除。`}
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
