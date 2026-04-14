import { useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { BookAgentPanel } from "../components/book/BookAgentPanel";
import { BookCollapsedPanelToggle } from "../components/book/BookCollapsedPanelToggle";
import { BookEditorPanel } from "../components/book/BookEditorPanel";
import { BookPanelResizeHandle } from "../components/book/BookPanelResizeHandle";
import { BookWorkspaceLoadingState } from "../components/book/BookWorkspaceLoadingState";
import { BookTreePanel } from "../components/book/BookTreePanel";
import { BookWorkspaceEmptyState } from "../components/book/BookWorkspaceEmptyState";
import { ActionMenu, ActionMenuItem } from "../components/common/ActionMenu";
import { BookshelfDialog } from "../components/dialogs/BookshelfDialog";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { PromptDialog } from "../components/dialogs/PromptDialog";
import { getStoredWorkspaceSnapshot } from "../lib/bookWorkspace/api";
import {
  AGENT_PANEL_COLLAPSE_THRESHOLD,
  COLLAPSED_PANEL_TOGGLE_WIDTH,
  DEFAULT_BOOK_PANEL_LAYOUT,
  MAX_AGENT_PANEL_WIDTH,
  MAX_TREE_PANEL_WIDTH,
  MIN_AGENT_PANEL_WIDTH,
  MIN_EDITOR_PANEL_WIDTH,
  MIN_TREE_PANEL_WIDTH,
  RESIZE_HANDLE_WIDTH,
  TREE_PANEL_COLLAPSE_THRESHOLD,
  getStoredBookPanelLayout,
  setStoredBookPanelLayout,
  type BookPanelLayout,
} from "../lib/bookWorkspace/layout";
import { getBaseName } from "../lib/bookWorkspace/paths";
import { useBookWorkspaceStore } from "../stores/bookWorkspaceStore";

const AUTO_SAVE_DELAY_MS = 800;
type ResizeHandle = "left" | "right" | null;
type AnchorRect = {
  bottom: number;
  left: number;
  right: number;
  top: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getLeftFootprint(layout: BookPanelLayout) {
  return layout.leftCollapsed ? COLLAPSED_PANEL_TOGGLE_WIDTH : layout.leftPanelWidth + RESIZE_HANDLE_WIDTH;
}

function getRightFootprint(layout: BookPanelLayout) {
  return layout.rightCollapsed ? COLLAPSED_PANEL_TOGGLE_WIDTH : layout.rightPanelWidth + RESIZE_HANDLE_WIDTH;
}

function getMaxLeftPanelWidth(layout: BookPanelLayout, containerWidth: number) {
  return Math.min(
    MAX_TREE_PANEL_WIDTH,
    Math.max(
      MIN_TREE_PANEL_WIDTH,
      containerWidth - getRightFootprint(layout) - MIN_EDITOR_PANEL_WIDTH - RESIZE_HANDLE_WIDTH,
    ),
  );
}

function getMaxRightPanelWidth(layout: BookPanelLayout, containerWidth: number) {
  return Math.min(
    MAX_AGENT_PANEL_WIDTH,
    Math.max(
      MIN_AGENT_PANEL_WIDTH,
      containerWidth - getLeftFootprint(layout) - MIN_EDITOR_PANEL_WIDTH - RESIZE_HANDLE_WIDTH,
    ),
  );
}

type BookPageProps = {
  onWorkspaceRootChange?: (rootPath: string) => void;
  requestedRootPath?: string | null;
};

export function BookPage({
  onWorkspaceRootChange,
  requestedRootPath = null,
}: BookPageProps = {}) {
  const activeFilePath = useBookWorkspaceStore((state) => state.activeFilePath);
  const availableBooks = useBookWorkspaceStore((state) => state.availableBooks);
  const bookshelfError = useBookWorkspaceStore((state) => state.bookshelfError);
  const closeBookshelf = useBookWorkspaceStore((state) => state.closeBookshelf);
  const closeConfirm = useBookWorkspaceStore((state) => state.closeConfirm);
  const closePrompt = useBookWorkspaceStore((state) => state.closePrompt);
  const toggleAllDirectories = useBookWorkspaceStore((state) => state.toggleAllDirectories);
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
  const openCreateFolderDialog = useBookWorkspaceStore((state) => state.openCreateFolderDialog);
  const openRenameDialog = useBookWorkspaceStore((state) => state.openRenameDialog);
  const openWorkspace = useBookWorkspaceStore((state) => state.openWorkspace);
  const promptState = useBookWorkspaceStore((state) => state.promptState);
  const refreshWorkspace = useBookWorkspaceStore((state) => state.refreshWorkspace);
  const refreshWorkspaceList = useBookWorkspaceStore((state) => state.refreshWorkspaceList);
  const requestDelete = useBookWorkspaceStore((state) => state.requestDelete);
  const rootNode = useBookWorkspaceStore((state) => state.rootNode);
  const rootPath = useBookWorkspaceStore((state) => state.rootPath);
  const saveActiveFile = useBookWorkspaceStore((state) => state.saveActiveFile);
  const selectFile = useBookWorkspaceStore((state) => state.selectFile);
  const setPromptValue = useBookWorkspaceStore((state) => state.setPromptValue);
  const submitPrompt = useBookWorkspaceStore((state) => state.submitPrompt);
  const toggleDirectory = useBookWorkspaceStore((state) => state.toggleDirectory);
  const updateDraft = useBookWorkspaceStore((state) => state.updateDraft);
  const selectWorkspace = useBookWorkspaceStore((state) => state.selectWorkspace);
  const [bookMenuAnchorRect, setBookMenuAnchorRect] = useState<AnchorRect | null>(null);
  const [panelLayout, setPanelLayout] = useState<BookPanelLayout>(
    () => getStoredBookPanelLayout() ?? DEFAULT_BOOK_PANEL_LAYOUT,
  );
  const [activeResizeHandle, setActiveResizeHandle] = useState<ResizeHandle>(null);
  const panelLayoutRef = useRef(panelLayout);
  const panelsRef = useRef<HTMLDivElement | null>(null);
  const cleanupResizeRef = useRef<(() => void) | null>(null);
  const storedSnapshot = requestedRootPath ? null : getStoredWorkspaceSnapshot();
  const shouldShowWorkspaceRestoreState =
    !requestedRootPath && !hasInitialized && !rootNode && storedSnapshot !== null;
  const shouldShowWorkspaceOpenState = Boolean(requestedRootPath && isBusy && !rootNode);

  useEffect(() => {
    panelLayoutRef.current = panelLayout;
  }, [panelLayout]);

  useEffect(() => {
    return () => {
      cleanupResizeRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (requestedRootPath) {
      return;
    }

    void initializeWorkspace();
  }, [initializeWorkspace, requestedRootPath]);

  useEffect(() => {
    if (!requestedRootPath || rootPath === requestedRootPath) {
      return;
    }

    void selectWorkspace(requestedRootPath);
  }, [requestedRootPath, rootPath, selectWorkspace]);

  useEffect(() => {
    if (!onWorkspaceRootChange || !rootPath || rootPath === requestedRootPath) {
      return;
    }

    onWorkspaceRootChange(rootPath);
  }, [onWorkspaceRootChange, requestedRootPath, rootPath]);

  useEffect(() => {
    if (!activeFilePath || !isDirty || isBusy) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveActiveFile();
    }, AUTO_SAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [activeFilePath, draftContent, isBusy, isDirty, saveActiveFile]);

  function persistPanelLayout(nextLayout: BookPanelLayout) {
    panelLayoutRef.current = nextLayout;
    setStoredBookPanelLayout(nextLayout);
  }

  function expandLeftPanel() {
    const panels = panelsRef.current;
    const current = panelLayoutRef.current;
    const containerWidth = panels?.getBoundingClientRect().width ?? 0;
    const maxLeftWidth =
      containerWidth > 0
        ? getMaxLeftPanelWidth({ ...current, leftCollapsed: false }, containerWidth)
        : MAX_TREE_PANEL_WIDTH;
    const nextLeftWidth = clamp(current.lastExpandedLeftPanelWidth, MIN_TREE_PANEL_WIDTH, maxLeftWidth);
    const nextLayout = {
      ...current,
      leftCollapsed: false,
      leftPanelWidth: nextLeftWidth,
      lastExpandedLeftPanelWidth: nextLeftWidth,
    };
    setPanelLayout(nextLayout);
    persistPanelLayout(nextLayout);
  }

  function expandRightPanel() {
    const panels = panelsRef.current;
    const current = panelLayoutRef.current;
    const containerWidth = panels?.getBoundingClientRect().width ?? 0;
    const maxRightWidth =
      containerWidth > 0
        ? getMaxRightPanelWidth({ ...current, rightCollapsed: false }, containerWidth)
        : MAX_AGENT_PANEL_WIDTH;
    const nextRightWidth = clamp(current.lastExpandedRightPanelWidth, MIN_AGENT_PANEL_WIDTH, maxRightWidth);
    const nextLayout = {
      ...current,
      rightCollapsed: false,
      rightPanelWidth: nextRightWidth,
      lastExpandedRightPanelWidth: nextRightWidth,
    };
    setPanelLayout(nextLayout);
    persistPanelLayout(nextLayout);
  }

  function startResize(handle: Exclude<ResizeHandle, null>) {
    return (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      const panels = panelsRef.current;
      if (!panels) {
        return;
      }

      cleanupResizeRef.current?.();

      const rect = panels.getBoundingClientRect();
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        setPanelLayout((current) => {
          if (handle === "left") {
            const candidateWidth = moveEvent.clientX - rect.left;
            if (candidateWidth <= TREE_PANEL_COLLAPSE_THRESHOLD) {
              const nextLayout = { ...current, leftCollapsed: true };
              panelLayoutRef.current = nextLayout;
              return nextLayout;
            }

            const maxLeftWidth = getMaxLeftPanelWidth(current, rect.width);
            const nextLeftWidth = clamp(candidateWidth, MIN_TREE_PANEL_WIDTH, maxLeftWidth);
            if (
              nextLeftWidth === current.leftPanelWidth &&
              current.leftCollapsed === false &&
              nextLeftWidth === current.lastExpandedLeftPanelWidth
            ) {
              return current;
            }

            const nextLayout = {
              ...current,
              leftCollapsed: false,
              leftPanelWidth: nextLeftWidth,
              lastExpandedLeftPanelWidth: nextLeftWidth,
            };
            panelLayoutRef.current = nextLayout;
            return nextLayout;
          }

          const candidateWidth = rect.right - moveEvent.clientX;
          if (candidateWidth <= AGENT_PANEL_COLLAPSE_THRESHOLD) {
            const nextLayout = { ...current, rightCollapsed: true };
            panelLayoutRef.current = nextLayout;
            return nextLayout;
          }

          const maxRightWidth = getMaxRightPanelWidth(current, rect.width);
          const nextRightWidth = clamp(candidateWidth, MIN_AGENT_PANEL_WIDTH, maxRightWidth);
          if (
            nextRightWidth === current.rightPanelWidth &&
            current.rightCollapsed === false &&
            nextRightWidth === current.lastExpandedRightPanelWidth
          ) {
            return current;
          }

          const nextLayout = {
            ...current,
            rightCollapsed: false,
            rightPanelWidth: nextRightWidth,
            lastExpandedRightPanelWidth: nextRightWidth,
          };
          panelLayoutRef.current = nextLayout;
          return nextLayout;
        });
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        cleanupResizeRef.current = null;
        setActiveResizeHandle(null);
        setStoredBookPanelLayout(panelLayoutRef.current);
      };

      const handlePointerUp = () => {
        cleanup();
      };

      cleanupResizeRef.current = cleanup;
      setActiveResizeHandle(handle);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      event.preventDefault();
    };
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f7f7f8] dark:bg-[#111214]">
      {errorMessage ? (
        <div className="mx-6 mt-4 flex shrink-0 items-start justify-between gap-4 border border-[#f0d7d2] bg-[#fff7f5] px-4 py-3 text-sm text-[#8a4b42] dark:border-[#4b2b2d] dark:bg-[#241617] dark:text-[#efb5af]">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{errorMessage}</p>
          </div>
          <button
            type="button"
            onClick={dismissError}
            className="shrink-0 px-2 py-1 text-xs font-medium transition hover:text-[#5f2e28] dark:hover:text-white"
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
            description="正在读取书籍目录、文件树和编辑上下文，请稍候。"
            title="正在打开书籍工作区..."
          />
        ) : rootNode ? (
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
                  onToggleAll={toggleAllDirectories}
                  onCreateFile={openCreateFileDialog}
                  onCreateFolder={openCreateFolderDialog}
                  onDelete={requestDelete}
                  onOpenBookMenu={(anchorRect) => setBookMenuAnchorRect(anchorRect)}
                  onRefresh={() => void refreshWorkspace()}
                  onRename={openRenameDialog}
                  onSelectFile={(path) => void selectFile(path)}
                  onToggleDirectory={toggleDirectory}
                  rootNode={rootNode}
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
        ) : (
          <BookWorkspaceEmptyState
            busy={isBusy}
            onCreate={openCreateBookDialog}
            onOpen={() => void openWorkspace()}
          />
        )}
      </div>

      <ActionMenu anchorRect={bookMenuAnchorRect} onClose={() => setBookMenuAnchorRect(null)}>
        <div className="space-y-1">
          <ActionMenuItem
            ariaLabel="选择书籍"
            disabled={isBusy}
            onClick={() => {
              setBookMenuAnchorRect(null);
              void openWorkspace();
            }}
          >
            选择书籍
          </ActionMenuItem>
          <ActionMenuItem
            ariaLabel="新建书籍"
            disabled={isBusy}
            onClick={() => {
              setBookMenuAnchorRect(null);
              openCreateBookDialog();
            }}
          >
            新建书籍
          </ActionMenuItem>
        </div>
      </ActionMenu>

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
          onOpen={(rootPath) => void selectWorkspace(rootPath)}
          onRefresh={() => void refreshWorkspaceList()}
        />
      ) : null}
    </section>
  );
}



