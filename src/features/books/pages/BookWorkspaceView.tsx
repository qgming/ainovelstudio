/**
 * 书籍工作区页面（BookWorkspaceView）。
 *
 * 通过 BookWorkspacePage 的路由 `/books/:bookId` 进入。本页核心职责：
 *   - 订阅 useBookWorkspaceStore 的全部状态
 *   - 协调初始化 / 路由切书 / 自动保存 / 移动端 tab 切换
 *   - 桌面端三栏 + 拖拽调宽（拖拽实现已抽到 useBookPanelResize）
 *   - 弹出对话框（重命名 / 创建 / 删除 / 书架）
 *
 * 阶段 7 拆出：
 *   - features/books/lib/layoutMath.ts —— clamp / 占位 / 最大宽度计算
 *   - features/books/hooks/useBookPanelResize.ts —— 拖拽指针逻辑与 ref/state
 */

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Bot, FolderTree, SquarePen } from "lucide-react";
import { cn } from "@shared/utils";
import { BookAgentPanel } from "@features/books/components/BookAgentPanel";
import { BookCollapsedPanelToggle } from "@features/books/components/BookCollapsedPanelToggle";
import { BookEditorPanel } from "@features/books/components/BookEditorPanel";
import { BookPanelResizeHandle } from "@features/books/components/BookPanelResizeHandle";
import { BookWorkspaceLoadingState } from "@features/books/components/BookWorkspaceLoadingState";
import { BookTreePanel } from "@features/books/components/BookTreePanel";
import { BookWorkspaceEmptyState } from "@features/books/components/BookWorkspaceEmptyState";
import { BookshelfDialog } from "@features/books/components/BookshelfDialog";
import { ConfirmDialog } from "@shared/components/dialogs/ConfirmDialog";
import { PromptDialog } from "@shared/components/dialogs/PromptDialog";
import { getStoredWorkspaceSnapshot, openBookFolder } from "@features/books/api/bookWorkspaceApi";
import { getBaseName } from "@features/books/lib/paths";
import type { TreeNode } from "@features/books/types";
import { useIsMobile } from "@shared/hooks/useMobile";
import { useBookPanelResize } from "../hooks/useBookPanelResize";
import { useBookWorkspaceStore } from "@features/books/stores/useBookWorkspaceStore";

const AUTO_SAVE_DELAY_MS = 800;
const MIRROR_SYNC_INTERVAL_MS = 1200;
type MobileBookTab = "tree" | "editor" | "agent";

/** 移动端顶部标题：书架 / 当前书名。 */
function MobileWorkspaceTitle({
  currentLabel,
  onNavigateHome,
}: {
  currentLabel: string;
  onNavigateHome: () => void;
}) {
  return (
    <div className="truncate text-[15px] font-semibold tracking-[-0.03em] text-foreground">
      <button
        type="button"
        aria-label="返回书架"
        onClick={onNavigateHome}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        书架
      </button>
      <span className="px-1.5 text-muted-foreground">/</span>
      <span>{currentLabel}</span>
    </div>
  );
}

type BookWorkspaceViewProps = {
  onWorkspaceBookChange?: (bookId: string) => void;
  onNavigateHome?: () => void;
  requestedBookId?: string | null;
};

export function BookWorkspaceView({
  onWorkspaceBookChange,
  onNavigateHome,
  requestedBookId = null,
}: BookWorkspaceViewProps = {}) {
  const isMobile = useIsMobile();

  // —— useBookWorkspaceStore 订阅（按 selector 切片以减少不必要的重渲染） ——
  const activeFilePath = useBookWorkspaceStore((state) => state.activeFilePath);
  const availableBooks = useBookWorkspaceStore((state) => state.availableBooks);
  const bookshelfError = useBookWorkspaceStore((state) => state.bookshelfError);
  const closeBookshelf = useBookWorkspaceStore((state) => state.closeBookshelf);
  const closeConfirm = useBookWorkspaceStore((state) => state.closeConfirm);
  const closePrompt = useBookWorkspaceStore((state) => state.closePrompt);
  const confirmDelete = useBookWorkspaceStore((state) => state.confirmDelete);
  const confirmState = useBookWorkspaceStore((state) => state.confirmState);
  const dismissError = useBookWorkspaceStore((state) => state.dismissError);
  const draftContent = useBookWorkspaceStore((state) => state.draftContent);
  const errorMessage = useBookWorkspaceStore((state) => state.errorMessage);
  const expandedPaths = useBookWorkspaceStore((state) => state.expandedPaths);
  const hasInitialized = useBookWorkspaceStore((state) => state.hasInitialized);
  const initializeWorkspace = useBookWorkspaceStore((state) => state.initializeWorkspace);
  const isBusy = useBookWorkspaceStore((state) => state.isBusy);
  const isBookshelfOpen = useBookWorkspaceStore((state) => state.isBookshelfOpen);
  const isDirty = useBookWorkspaceStore((state) => state.isDirty);
  const openCreateBookDialog = useBookWorkspaceStore((state) => state.openCreateBookDialog);
  const openCreateFileDialog = useBookWorkspaceStore((state) => state.openCreateFileDialog);
  const openCreateFolderDialog = useBookWorkspaceStore(
    (state) => state.openCreateFolderDialog,
  );
  const openRenameDialog = useBookWorkspaceStore((state) => state.openRenameDialog);
  const openWorkspace = useBookWorkspaceStore((state) => state.openWorkspace);
  const promptState = useBookWorkspaceStore((state) => state.promptState);
  const refreshWorkspace = useBookWorkspaceStore((state) => state.refreshWorkspace);
  const refreshWorkspaceList = useBookWorkspaceStore((state) => state.refreshWorkspaceList);
  const requestDelete = useBookWorkspaceStore((state) => state.requestDelete);
  const rootNode = useBookWorkspaceStore((state) => state.rootNode);
  const rootBookId = useBookWorkspaceStore((state) => state.rootBookId);
  const saveActiveFile = useBookWorkspaceStore((state) => state.saveActiveFile);
  const selectFile = useBookWorkspaceStore((state) => state.selectFile);
  const rootBookName = useBookWorkspaceStore((state) => state.rootBookName);
  const setPromptValue = useBookWorkspaceStore((state) => state.setPromptValue);
  const submitPrompt = useBookWorkspaceStore((state) => state.submitPrompt);
  const syncWorkspaceFromMirrorIfChanged = useBookWorkspaceStore(
    (state) => state.syncWorkspaceFromMirrorIfChanged,
  );
  const toggleDirectory = useBookWorkspaceStore((state) => state.toggleDirectory);
  const updateDraft = useBookWorkspaceStore((state) => state.updateDraft);
  const selectWorkspaceByBookId = useBookWorkspaceStore(
    (state) => state.selectWorkspaceByBookId,
  );

  // —— 拖拽调宽逻辑（封装在 hook） ——
  const {
    panelLayout,
    activeResizeHandle,
    panelsRef,
    expandLeftPanel,
    expandRightPanel,
    startResize,
  } = useBookPanelResize();

  const [mobileActiveTab, setMobileActiveTab] = useState<MobileBookTab>("editor");
  const [externalErrorMessage, setExternalErrorMessage] = useState<string | null>(null);
  const [mirrorSyncRootPath, setMirrorSyncRootPath] = useState<string | null>(null);
  const routeLoadingBookIdRef = useRef<string | null>(null);

  // —— 派生状态 ——
  const storedSnapshot = requestedBookId ? null : getStoredWorkspaceSnapshot();
  const shouldShowWorkspaceRestoreState =
    !requestedBookId && !hasInitialized && !rootNode && storedSnapshot !== null;
  const isSwitchingRequestedWorkspace = Boolean(
    requestedBookId && rootBookId && rootBookId !== requestedBookId,
  );
  const shouldShowWorkspaceOpenState = Boolean(
    requestedBookId &&
      !errorMessage &&
      (!rootNode || !rootBookId || isSwitchingRequestedWorkspace),
  );

  // —— 启动初始化（仅在没有路由请求 bookId 时使用 store 默认逻辑） ——
  useEffect(() => {
    if (requestedBookId) return;
    void initializeWorkspace();
  }, [initializeWorkspace, requestedBookId]);

  // —— 路由切书：requestedBookId 变更时通知 store 切换 ——
  useEffect(() => {
    if (!requestedBookId || rootBookId === requestedBookId) {
      if (rootBookId === requestedBookId) {
        routeLoadingBookIdRef.current = null;
      }
      return;
    }
    routeLoadingBookIdRef.current = requestedBookId;
    void selectWorkspaceByBookId(requestedBookId);
  }, [requestedBookId, rootBookId, selectWorkspaceByBookId]);

  // —— 反向同步：用户切书后通知路由更新 URL ——
  useEffect(() => {
    if (!onWorkspaceBookChange || !rootBookId || rootBookId === requestedBookId) return;
    if (routeLoadingBookIdRef.current === requestedBookId) return;
    onWorkspaceBookChange(rootBookId);
  }, [onWorkspaceBookChange, requestedBookId, rootBookId]);

  // —— 自动保存：800ms 节流保存当前文件 ——
  useEffect(() => {
    if (!activeFilePath || !isDirty || isBusy) return;
    const timer = window.setTimeout(() => {
      void saveActiveFile();
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeFilePath, draftContent, isBusy, isDirty, saveActiveFile]);

  // —— 移动端：选中文件时自动切到编辑 tab ——
  useEffect(() => {
    if (!isMobile) return;
    if (activeFilePath) setMobileActiveTab("editor");
  }, [activeFilePath, isMobile]);

  const resolvedRootNode: TreeNode | null = rootNode
    ? { ...rootNode, name: rootBookName || rootNode.name }
    : null;
  const currentRootPath = rootNode?.path ?? null;

  useEffect(() => {
    if (!mirrorSyncRootPath || mirrorSyncRootPath !== currentRootPath) return;
    let running = false;
    const intervalId = window.setInterval(() => {
      if (running) return;
      running = true;
      void syncWorkspaceFromMirrorIfChanged().finally(() => {
        running = false;
      });
    }, MIRROR_SYNC_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [currentRootPath, mirrorSyncRootPath, syncWorkspaceFromMirrorIfChanged]);

  /** 没有 onNavigateHome 时回退到 hash 路由首页。 */
  function navigateHome() {
    if (onNavigateHome) {
      onNavigateHome();
      return;
    }
    if (typeof window !== "undefined") {
      window.location.hash = "#/";
    }
  }

  async function openRootFolder(rootPath: string) {
    try {
      setExternalErrorMessage(null);
      await openBookFolder(rootPath);
      setMirrorSyncRootPath(rootPath);
    } catch (error) {
      setExternalErrorMessage(
        error instanceof Error ? error.message : "打开系统文件资源管理器失败。",
      );
    }
  }

  function renderDesktopWorkspace() {
    if (!resolvedRootNode) return null;
    return (
      <div
        ref={panelsRef}
        data-testid="book-workspace-panels"
        className="flex h-full min-h-0 overflow-hidden"
      >
        {panelLayout.leftCollapsed ? (
          <BookCollapsedPanelToggle
            ariaLabel="展开目录栏"
            onClick={expandLeftPanel}
            side="left"
          />
        ) : (
          <>
            <BookTreePanel
              activeFilePath={activeFilePath}
              busy={isBusy}
              expandedPaths={expandedPaths}
              onCreateFile={openCreateFileDialog}
              onCreateFolder={openCreateFolderDialog}
              onDelete={requestDelete}
              onNavigateHome={navigateHome}
              onOpenRootFolder={(rootPath) => void openRootFolder(rootPath)}
              onRefresh={() => void refreshWorkspace()}
              onRename={openRenameDialog}
              onSelectFile={(path) => void selectFile(path)}
              onToggleDirectory={toggleDirectory}
              rootNode={resolvedRootNode}
              width={panelLayout.leftPanelWidth}
            />
            <BookPanelResizeHandle
              active={activeResizeHandle === "left"}
              ariaLabel="调整目录栏宽度"
              onPointerDown={startResize("left")}
            />
          </>
        )}
        <BookEditorPanel
          activeFileName={activeFilePath ? getBaseName(activeFilePath) : null}
          busy={isBusy}
          content={draftContent}
          isDirty={isDirty}
          onChange={updateDraft}
          onSave={() => void saveActiveFile()}
        />
        {panelLayout.rightCollapsed ? (
          <BookCollapsedPanelToggle
            ariaLabel="展开 Agent 栏"
            onClick={expandRightPanel}
            side="right"
          />
        ) : (
          <>
            <BookPanelResizeHandle
              active={activeResizeHandle === "right"}
              ariaLabel="调整 Agent 栏宽度"
              onPointerDown={startResize("right")}
            />
            <BookAgentPanel width={panelLayout.rightPanelWidth} />
          </>
        )}
      </div>
    );
  }

  function renderMobileWorkspace() {
    if (!resolvedRootNode) return null;

    const sharedTreeProps = {
      activeFilePath,
      busy: isBusy,
      expandedPaths,
      onCreateFile: openCreateFileDialog,
      onCreateFolder: openCreateFolderDialog,
      onDelete: requestDelete,
      onNavigateHome: navigateHome,
      onRefresh: () => void refreshWorkspace(),
      onRename: openRenameDialog,
      onSelectFile: (path: string) => void selectFile(path),
      onToggleDirectory: toggleDirectory,
      rootNode: resolvedRootNode,
      width: "100%" as const,
    };

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="flex min-h-10 shrink-0 items-center gap-3 border-b border-border bg-panel-subtle px-4 py-1.5 sm:px-5">
          <div className="min-w-0 flex-1">
            <MobileWorkspaceTitle
              currentLabel={resolvedRootNode.name}
              onNavigateHome={navigateHome}
            />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-hidden">
          {mobileActiveTab === "tree" ? (
            <BookTreePanel {...sharedTreeProps} />
          ) : mobileActiveTab === "agent" ? (
            <BookAgentPanel width="100%" />
          ) : (
            <BookEditorPanel
              activeFileName={activeFilePath ? getBaseName(activeFilePath) : null}
              busy={isBusy}
              content={draftContent}
              isDirty={isDirty}
              onChange={updateDraft}
              onSave={() => void saveActiveFile()}
            />
          )}
        </div>

        <nav
          aria-label="图书工作区导航"
          className="shrink-0 border-t border-border bg-sidebar/95 px-2 backdrop-blur"
        >
          <div className="grid h-16 w-full grid-cols-3 gap-1">
            {[
              { tab: "tree" as const, label: "目录", Icon: FolderTree },
              { tab: "editor" as const, label: "写作", Icon: SquarePen },
              { tab: "agent" as const, label: "助手", Icon: Bot },
            ].map(({ tab, label, Icon }) => (
              <button
                key={tab}
                type="button"
                aria-label={label}
                onClick={() => setMobileActiveTab(tab)}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-1 transition-colors duration-150",
                  mobileActiveTab === tab
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
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

  const visibleErrorMessage = errorMessage ?? externalErrorMessage;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-subtle">
      {visibleErrorMessage ? (
        <div className="mx-6 mt-4 flex shrink-0 items-start justify-between gap-4 rounded-md border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{visibleErrorMessage}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              dismissError();
              setExternalErrorMessage(null);
            }}
            className="shrink-0 px-2 py-1 text-xs font-medium transition hover:opacity-80"
          >
            关闭
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden">
        {shouldShowWorkspaceRestoreState ? (
          <BookWorkspaceLoadingState />
        ) : shouldShowWorkspaceOpenState ? (
          <BookWorkspaceLoadingState
            description="正在读取书籍结构、文件树和编辑上下文，请稍候。"
            title="正在打开书籍工作区..."
          />
        ) : rootNode ? (
          isMobile ? (
            renderMobileWorkspace()
          ) : (
            renderDesktopWorkspace()
          )
        ) : (
          <BookWorkspaceEmptyState
            busy={isBusy}
            onCreate={openCreateBookDialog}
            onOpen={() => void openWorkspace()}
          />
        )}
      </div>

      {promptState ? (
        <PromptDialog
          busy={isBusy}
          confirmLabel={promptState.confirmLabel}
          description={promptState.description}
          label={promptState.label}
          onCancel={closePrompt}
          onChange={setPromptValue}
          onConfirm={() => void submitPrompt()}
          title={promptState.title}
          value={promptState.value}
        />
      ) : null}

      {confirmState ? (
        <ConfirmDialog
          busy={isBusy}
          confirmLabel={confirmState.confirmLabel}
          description={confirmState.description}
          onCancel={closeConfirm}
          onConfirm={() => void confirmDelete()}
          title={confirmState.title}
        />
      ) : null}

      {isBookshelfOpen ? (
        <BookshelfDialog
          books={availableBooks}
          busy={isBusy}
          errorMessage={bookshelfError}
          onClose={closeBookshelf}
          onCreate={() => {
            closeBookshelf();
            openCreateBookDialog();
          }}
          onOpen={(bookId) => void selectWorkspaceByBookId(bookId)}
          onRefresh={() => void refreshWorkspaceList()}
        />
      ) : null}
    </section>
  );
}
