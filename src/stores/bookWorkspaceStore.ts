import { create } from "zustand";
import {
  clearStoredWorkspaceSnapshot,
  createBookWorkspace,
  createWorkspaceDirectory,
  createWorkspaceTextFile,
  deleteWorkspaceEntry,
  getBookWorkspaceSummary,
  getBookWorkspaceSummaryById,
  getStoredWorkspaceSnapshot,
  listBookWorkspaces,
  readWorkspaceTextFile,
  readWorkspaceTree,
  renameWorkspaceEntry,
  setStoredWorkspaceSnapshot,
  writeWorkspaceTextFile,
} from "../lib/bookWorkspace/api";
import { getCachedBookWorkspaceSummary } from "../lib/bookWorkspace/summaryCache";
import { isTextEditableFile, normalizeEntryName, validateEntryName } from "../lib/bookWorkspace/paths";
import {
  buildExpandedPaths,
  collectAllDirectoryPaths,
  findNodeByPath,
  isSameOrDescendant,
  replacePathPrefix,
} from "../lib/bookWorkspace/tree";
import type {
  BookWorkspaceSummary,
  ConfirmState,
  PromptState,
  TreeNode,
} from "../lib/bookWorkspace/types";

export type BookWorkspaceStore = {
  activeFilePath: string | null;
  availableBooks: BookWorkspaceSummary[];
  bookshelfError: string | null;
  closeBookshelf: () => void;
  closeConfirm: () => void;
  closePrompt: () => void;
  toggleAllDirectories: () => void;
  confirmDelete: () => Promise<void>;
  confirmState: ConfirmState | null;
  dismissError: () => void;
  draftContent: string;
  errorMessage: string | null;
  expandedPaths: string[];
  hasInitialized: boolean;
  initializeWorkspace: () => Promise<void>;
  isBusy: boolean;
  isBookshelfOpen: boolean;
  isDirty: boolean;
  openCreateBookDialog: () => void;
  openCreateFileDialog: (parentPath: string) => void;
  openCreateFolderDialog: (parentPath: string) => void;
  openRenameDialog: (node: TreeNode) => void;
  openWorkspace: () => Promise<void>;
  selectWorkspaceByBookId: (bookId: string) => Promise<void>;
  promptState: PromptState | null;
  refreshWorkspace: () => Promise<void>;
  refreshWorkspaceList: () => Promise<void>;
  refreshWorkspaceAfterExternalChange: () => Promise<void>;
  requestDelete: (node: TreeNode) => void;
  resetState: () => void;
  rootNode: TreeNode | null;
  rootBookId: string | null;
  rootBookName: string | null;
  rootPath: string | null;
  saveActiveFile: () => Promise<void>;
  selectFile: (path: string) => Promise<void>;
  setPromptValue: (value: string) => void;
  submitPrompt: () => Promise<void>;
  toggleDirectory: (path: string) => void;
  updateDraft: (value: string) => void;
};

type LoadWorkspaceOptions = {
  isCurrent?: () => boolean;
  rootPath: string;
  selectedFilePath: string | null;
  workspaceSummary?: BookWorkspaceSummary;
};

const initialState = {
  activeFilePath: null,
  availableBooks: [] as BookWorkspaceSummary[],
  bookshelfError: null,
  confirmState: null,
  draftContent: "",
  errorMessage: null,
  expandedPaths: [] as string[],
  hasInitialized: false,
  isBusy: false,
  isBookshelfOpen: false,
  isDirty: false,
  promptState: null,
  rootBookId: null as string | null,
  rootBookName: null as string | null,
  rootNode: null as TreeNode | null,
  rootPath: null as string | null,
};

function buildCreateBookPrompt(): PromptState {
  return {
    confirmLabel: "创建书籍",
    description: "输入书名后，系统会在应用内置书库中自动初始化中文模板结构。",
    label: "书名",
    mode: "createBook",
    title: "新建书籍",
    value: "",
  };
}

function buildCreateFolderPrompt(parentPath: string): PromptState {
  return {
    confirmLabel: "确认新建",
    description: "在当前目录下创建一个新的文件夹。",
    label: "文件夹名",
    mode: "createFolder",
    parentPath,
    title: "新建文件夹",
    value: "",
  };
}

function buildCreateFilePrompt(parentPath: string): PromptState {
  return {
    confirmLabel: "确认新建",
    description: "输入文件名，不带扩展名时默认使用 .md，也支持 .txt 和 .json。",
    label: "文件名",
    mode: "createFile",
    parentPath,
    title: "新建文件",
    value: "",
  };
}

function buildRenamePrompt(node: TreeNode): PromptState {
  return {
    confirmLabel: "确认重命名",
    description: "输入新的名称。文件名若不带扩展名，将保留原扩展名。",
    label: node.kind === "directory" ? "文件夹名" : "文件名",
    mode: "rename",
    targetKind: node.kind,
    targetPath: node.path,
    title: `重命名${node.kind === "directory" ? "文件夹" : "文件"}`,
    value: node.name,
  };
}

function buildDeletePrompt(node: TreeNode): ConfirmState {
  return {
    confirmLabel: "永久删除",
    description: `确定要永久删除“${node.name}”吗？此操作不可恢复。`,
    kind: node.kind,
    name: node.name,
    path: node.path,
    title: `删除${node.kind === "directory" ? "文件夹" : "文件"}`,
  };
}

function getReadableError(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试。";
}

async function readAvailableBooks() {
  return listBookWorkspaces();
}

async function readWorkspaceSummary(rootPath: string): Promise<BookWorkspaceSummary> {
  const summary = await getBookWorkspaceSummary(rootPath);
  if (!summary || typeof summary.id !== "string" || typeof summary.path !== "string" || typeof summary.name !== "string") {
    throw new Error("书籍元数据不完整。");
  }
  return summary;
}

async function readWorkspaceSummaryById(bookId: string): Promise<BookWorkspaceSummary> {
  const summary = await getBookWorkspaceSummaryById(bookId);
  if (!summary || typeof summary.id !== "string" || typeof summary.path !== "string" || typeof summary.name !== "string") {
    throw new Error("书籍元数据不完整。");
  }
  return summary;
}

export const useBookWorkspaceStore = create<BookWorkspaceStore>((set, get) => {
  let workspaceLoadRequestId = 0;

  function createWorkspaceLoadGuard() {
    const requestId = ++workspaceLoadRequestId;
    return () => requestId === workspaceLoadRequestId;
  }

  async function loadWorkspace({
    rootPath,
    selectedFilePath,
    isCurrent = () => true,
    workspaceSummary,
  }: LoadWorkspaceOptions) {
    const [rootNode, workspace] = await Promise.all([
      readWorkspaceTree(rootPath),
      workspaceSummary ? Promise.resolve(workspaceSummary) : readWorkspaceSummary(rootPath),
    ]);
    if (!isCurrent()) {
      return false;
    }
    const nextSelectedFilePath =
      selectedFilePath && findNodeByPath(rootNode, selectedFilePath) ? selectedFilePath : null;
    const expandedPaths = buildExpandedPaths(rootNode, nextSelectedFilePath);

    if (nextSelectedFilePath && isTextEditableFile(nextSelectedFilePath)) {
      const content = await readWorkspaceTextFile(rootPath, nextSelectedFilePath);
      if (!isCurrent()) {
        return false;
      }
      set({
        activeFilePath: nextSelectedFilePath,
        confirmState: null,
        draftContent: content,
        errorMessage: null,
        expandedPaths,
        isDirty: false,
        rootBookId: workspace.id,
        rootBookName: workspace.name,
        rootNode,
        rootPath,
      });
      setStoredWorkspaceSnapshot(rootPath, nextSelectedFilePath);
      return true;
    }

    set({
      activeFilePath: null,
      confirmState: null,
      draftContent: "",
      errorMessage: null,
      expandedPaths,
      isDirty: false,
      rootBookId: workspace.id,
      rootBookName: workspace.name,
      rootNode,
      rootPath,
    });

    setStoredWorkspaceSnapshot(rootPath, null);
    return true;
  }

  async function reloadWorkspace(nextSelectedFilePath: string | null) {
    const rootPath = get().rootPath;
    if (!rootPath) {
      return;
    }

    await loadWorkspace({ rootPath, selectedFilePath: nextSelectedFilePath });
  }

  async function persistDirtyDraftIfNeeded() {
    const { activeFilePath, draftContent, isDirty, rootPath } = get();
    if (!rootPath || !activeFilePath || !isDirty) {
      return;
    }

    await writeWorkspaceTextFile(rootPath, activeFilePath, draftContent);
    set({ isDirty: false });
    setStoredWorkspaceSnapshot(rootPath, activeFilePath);
  }

  return {
    ...initialState,
    closeBookshelf: () => set({ bookshelfError: null, isBookshelfOpen: false }),
    closeConfirm: () => set({ confirmState: null }),
    closePrompt: () => set({ promptState: null }),
    toggleAllDirectories: () => {
      const allDirectoryPaths = collectAllDirectoryPaths(get().rootNode);
      const expandedPaths = get().expandedPaths;
      const isFullyExpanded =
        allDirectoryPaths.length > 0 &&
        allDirectoryPaths.every((path) => expandedPaths.includes(path));

      set({ expandedPaths: isFullyExpanded ? [] : allDirectoryPaths });
    },
    confirmDelete: async () => {
      const { activeFilePath, confirmState, rootPath } = get();
      if (!confirmState || !rootPath) {
        return;
      }

      try {
        set({ errorMessage: null, isBusy: true });
        await deleteWorkspaceEntry(rootPath, confirmState.path);
        const nextSelectedFilePath = isSameOrDescendant(activeFilePath, confirmState.path)
          ? null
          : activeFilePath;
        set({ confirmState: null });
        await reloadWorkspace(nextSelectedFilePath);
      } catch (error) {
        set({ errorMessage: getReadableError(error) });
      }

      set({ isBusy: false });
    },
    confirmState: null,
    dismissError: () => set({ errorMessage: null }),
    draftContent: "",
    errorMessage: null,
    expandedPaths: [],
    hasInitialized: false,
    initializeWorkspace: async () => {
      const snapshot = getStoredWorkspaceSnapshot();
      if (!snapshot) {
        set({ hasInitialized: true });
        return;
      }

      const isCurrent = createWorkspaceLoadGuard();
      try {
        set({ isBusy: true });
        const loaded = await loadWorkspace({
          isCurrent,
          rootPath: snapshot.rootPath,
          selectedFilePath: snapshot.selectedFilePath,
        });
        if (!loaded || !isCurrent()) {
          return;
        }
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        clearStoredWorkspaceSnapshot();
        set({ ...initialState, errorMessage: getReadableError(error), hasInitialized: true });
        return;
      }

      if (isCurrent()) {
        set({ hasInitialized: true, isBusy: false });
      }
    },
    isBusy: false,
    isBookshelfOpen: false,
    isDirty: false,
    openCreateBookDialog: () => set({ promptState: buildCreateBookPrompt() }),
    openCreateFileDialog: (parentPath) => set({ promptState: buildCreateFilePrompt(parentPath) }),
    openCreateFolderDialog: (parentPath) => set({ promptState: buildCreateFolderPrompt(parentPath) }),
    openRenameDialog: (node) => set({ promptState: buildRenamePrompt(node) }),
    openWorkspace: async () => {
      try {
        set({ errorMessage: null, isBusy: true });
        await persistDirtyDraftIfNeeded();
        const availableBooks = await readAvailableBooks();
        set({
          availableBooks,
          bookshelfError: null,
          isBookshelfOpen: true,
        });
      } catch (error) {
        set({
          bookshelfError: getReadableError(error),
          isBookshelfOpen: true,
        });
      }

      set({ isBusy: false });
    },
    promptState: null,
    refreshWorkspace: async () => {
      const { activeFilePath, draftContent, isDirty, rootPath } = get();
      if (!rootPath) {
        return;
      }

      const isCurrent = createWorkspaceLoadGuard();
      try {
        set({ errorMessage: null, isBusy: true });

        if (isDirty && activeFilePath) {
          await writeWorkspaceTextFile(rootPath, activeFilePath, draftContent);
          if (!isCurrent()) {
            return;
          }
          setStoredWorkspaceSnapshot(rootPath, activeFilePath);
        }

        await loadWorkspace({
          isCurrent,
          rootPath,
          selectedFilePath: activeFilePath,
        });
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        set({ errorMessage: getReadableError(error) });
      }

      if (isCurrent()) {
        set({ isBusy: false });
      }
    },
    refreshWorkspaceList: async () => {
      try {
        const availableBooks = await readAvailableBooks();
        set({
          availableBooks,
          bookshelfError: null,
        });
      } catch (error) {
        set({ bookshelfError: getReadableError(error) });
      }
    },
    refreshWorkspaceAfterExternalChange: async () => {
      const { activeFilePath, rootPath } = get();
      if (!rootPath) {
        return;
      }

      const isCurrent = createWorkspaceLoadGuard();
      try {
        set({ errorMessage: null, isBusy: true });
        await loadWorkspace({
          isCurrent,
          rootPath,
          selectedFilePath: activeFilePath,
        });
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        set({ errorMessage: getReadableError(error) });
      }

      if (isCurrent()) {
        set({ isBusy: false });
      }
    },
    requestDelete: (node) => set({ confirmState: buildDeletePrompt(node) }),
    resetState: () => set({ ...initialState }),
    rootBookId: null,
    rootBookName: null,
    rootNode: null,
    rootPath: null,
    saveActiveFile: async () => {
      const { activeFilePath, draftContent, rootPath } = get();
      if (!activeFilePath || !rootPath) {
        return;
      }

      try {
        set({ errorMessage: null, isBusy: true });
        await writeWorkspaceTextFile(rootPath, activeFilePath, draftContent);
        set({ isDirty: false });
        setStoredWorkspaceSnapshot(rootPath, activeFilePath);
      } catch (error) {
        set({ errorMessage: getReadableError(error) });
      }

      set({ isBusy: false });
    },
    selectWorkspaceByBookId: async (bookId) => {
      const isCurrent = createWorkspaceLoadGuard();
      try {
        set({ errorMessage: null, isBookshelfOpen: false, isBusy: true });
        await persistDirtyDraftIfNeeded();
        if (!isCurrent()) {
          return;
        }
        const workspace = getCachedBookWorkspaceSummary(bookId) ?? await readWorkspaceSummaryById(bookId);
        if (!isCurrent()) {
          return;
        }
        const loaded = await loadWorkspace({
          isCurrent,
          rootPath: workspace.path,
          selectedFilePath: null,
          workspaceSummary: workspace,
        });
        if (!loaded || !isCurrent()) {
          return;
        }
        set({ hasInitialized: true });
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        set({ errorMessage: getReadableError(error) });
      }

      if (isCurrent()) {
        set({ isBusy: false });
      }
    },
    selectFile: async (path) => {
      const { expandedPaths, rootNode, rootPath } = get();
      if (!rootPath || !isTextEditableFile(path)) {
        return;
      }

      try {
        set({ errorMessage: null, isBusy: true });
        const content = await readWorkspaceTextFile(rootPath, path);
        const nextExpandedPaths = rootNode
          ? [...new Set([...expandedPaths, ...buildExpandedPaths(rootNode, path)])]
          : expandedPaths;
        set({
          activeFilePath: path,
          draftContent: content,
          expandedPaths: nextExpandedPaths,
          isDirty: false,
        });
        setStoredWorkspaceSnapshot(rootPath, path);
      } catch (error) {
        set({ errorMessage: getReadableError(error) });
      }

      set({ isBusy: false });
    },
    setPromptValue: (value) => {
      const promptState = get().promptState;
      if (!promptState) {
        return;
      }
      set({ promptState: { ...promptState, value } });
    },
    submitPrompt: async () => {
      const { activeFilePath, promptState, rootPath } = get();
      if (!promptState) {
        return;
      }

      const trimmedValue = normalizeEntryName(promptState.value);
      const validationMessage = validateEntryName(trimmedValue);
      if (validationMessage) {
        set({ errorMessage: validationMessage });
        return;
      }

      try {
        set({ errorMessage: null, isBusy: true });

        if (promptState.mode === "createBook") {
          await persistDirtyDraftIfNeeded();
          const workspace = await createBookWorkspace("", trimmedValue);
          const availableBooks = await readAvailableBooks();
          set({ promptState: null });
          await loadWorkspace({
            rootPath: workspace.path,
            selectedFilePath: null,
            workspaceSummary: workspace,
          });
          set({
            availableBooks,
            hasInitialized: true,
            bookshelfError: null,
            isBookshelfOpen: false,
          });
          set({ isBusy: false });
          return;
        }

        if (!rootPath) {
          throw new Error("当前没有打开的书籍目录。");
        }

        if (promptState.mode === "createFolder" && promptState.parentPath) {
          await createWorkspaceDirectory(rootPath, promptState.parentPath, trimmedValue);
          set({ promptState: null });
          await reloadWorkspace(activeFilePath);
          set({ isBusy: false });
          return;
        }

        if (promptState.mode === "createFile" && promptState.parentPath) {
          const nextFilePath = await createWorkspaceTextFile(rootPath, promptState.parentPath, trimmedValue);
          set({ promptState: null });
          await loadWorkspace({
            rootPath,
            selectedFilePath: nextFilePath,
          });
          set({ isBusy: false });
          return;
        }

        if (promptState.mode === "rename" && promptState.targetPath) {
          const nextPath = await renameWorkspaceEntry(rootPath, promptState.targetPath, trimmedValue);
          const nextSelectedFilePath = replacePathPrefix(activeFilePath, promptState.targetPath, nextPath);
          set({ promptState: null });
          await reloadWorkspace(nextSelectedFilePath);
        }
      } catch (error) {
        set({ errorMessage: getReadableError(error) });
      }

      set({ isBusy: false });
    },
    toggleDirectory: (path) => {
      const expandedPaths = get().expandedPaths;
      set({
        expandedPaths: expandedPaths.includes(path)
          ? expandedPaths.filter((item) => item !== path)
          : [...expandedPaths, path],
      });
    },
    updateDraft: (value) => set({ draftContent: value, isDirty: true }),
  };
});
