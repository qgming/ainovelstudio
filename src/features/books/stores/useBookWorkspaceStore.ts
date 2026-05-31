import { create } from "zustand";
import {
  clearStoredWorkspaceSnapshot,
  createBookWorkspace,
  createEntryRelation,
  createWorkspaceDirectory,
  createWorkspaceTextFile,
  deleteEntryRelation,
  deleteWorkspaceEntry,
  ensureBookWorkspaceTemplate,
  getBookWorkspaceSummaryById,
  getStoredWorkspaceSnapshot,
  listBookRelations,
  listBookWorkspaces,
  readWorkspaceTextFile,
  readWorkspaceTree,
  renameWorkspaceEntry,
  setStoredWorkspaceSnapshot,
  updateEntryRelation,
  writeWorkspaceTextFile,
} from "@features/books/api/bookWorkspaceApi";
import { getCachedBookWorkspaceSummary } from "@features/books/lib/summaryCache";
import { isTextEditableFile, normalizeEntryName, validateEntryName } from "@features/books/lib/paths";
import {
  buildExpandedPaths,
  collectAllDirectoryPaths,
  findNodeByPath,
  isSameOrDescendant,
  replacePathPrefix,
} from "@features/books/lib/tree";
import type {
  BookWorkspaceSummary,
  ConfirmState,
  PromptState,
  TreeNode,
  WorkspaceRelation,
} from "@features/books/types";

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
  syncWorkspaceFromMirrorIfChanged: () => Promise<boolean>;
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
  // —— 文件关联(无向多对多) ——
  // 以 entry 的相对路径(去掉 "books/书名/" 前缀)为 key 的关联缓存。
  // 注意:后端返回的 entryAPath/entryBPath 也是 relative path。
  relationsByEntry: Record<string, WorkspaceRelation[]>;
  relationCountByEntry: Record<string, number>;
  refreshRelations: () => Promise<void>;
  createRelation: (
    entryAPath: string,
    entryBPath: string,
    relationship: string,
    note?: string | null,
  ) => Promise<WorkspaceRelation>;
  updateRelation: (
    relationId: string,
    changes: { note?: string | null; relationship?: string },
  ) => Promise<WorkspaceRelation>;
  deleteRelation: (relationId: string) => Promise<void>;
};

type LoadWorkspaceOptions = {
  isCurrent?: () => boolean;
  bookId: string;
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
  relationCountByEntry: {} as Record<string, number>,
  relationsByEntry: {} as Record<string, WorkspaceRelation[]>,
  rootBookId: null as string | null,
  rootBookName: null as string | null,
  rootNode: null as TreeNode | null,
  rootPath: null as string | null,
};

function buildCreateBookPrompt(): PromptState {
  return {
    confirmLabel: "创建书籍",
    description: "输入书名后，系统会在 SQLite 书库中初始化中文模板结构。",
    label: "书名",
    mode: "createBook",
    title: "新建书籍",
    value: "",
  };
}

function buildCreateFolderPrompt(parentPath: string): PromptState {
  return {
    confirmLabel: "确认新建",
    description: "在当前结构节点下创建一个新的文件夹。",
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

async function readWorkspaceSummaryById(bookId: string): Promise<BookWorkspaceSummary> {
  const summary = await getBookWorkspaceSummaryById(bookId);
  if (!summary || typeof summary.id !== "string" || typeof summary.path !== "string" || typeof summary.name !== "string") {
    throw new Error("书籍元数据不完整。");
  }
  return summary;
}

const DEFAULT_OPEN_FILE_RELATIVE_PATHS = [".project/README.md", "README.md"] as const;

function getRelativeTreePath(rootPath: string, nodePath: string) {
  if (nodePath === rootPath) {
    return "";
  }

  const rootPrefix = `${rootPath}/`;
  return nodePath.startsWith(rootPrefix) ? nodePath.slice(rootPrefix.length) : nodePath;
}

function findFileByRelativePath(rootNode: TreeNode, rootPath: string, relativePath: string): TreeNode | null {
  const normalizedTarget = relativePath.toLowerCase();
  const stack = [...(rootNode.children ?? [])];

  while (stack.length > 0) {
    const node = stack.shift();
    if (!node) {
      continue;
    }

    if (node.kind === "file" && getRelativeTreePath(rootPath, node.path).toLowerCase() === normalizedTarget) {
      return node;
    }

    stack.push(...(node.children ?? []));
  }

  return null;
}

function findDefaultOpenFilePath(rootNode: TreeNode, rootPath: string) {
  for (const relativePath of DEFAULT_OPEN_FILE_RELATIVE_PATHS) {
    const node = findFileByRelativePath(rootNode, rootPath, relativePath);
    if (node && isTextEditableFile(node.path)) {
      return node.path;
    }
  }

  return null;
}

export const useBookWorkspaceStore = create<BookWorkspaceStore>((set, get) => {
  let workspaceLoadRequestId = 0;

  function createWorkspaceLoadGuard() {
    const requestId = ++workspaceLoadRequestId;
    return () => requestId === workspaceLoadRequestId;
  }

  async function loadWorkspace({
    bookId,
    selectedFilePath,
    isCurrent = () => true,
    workspaceSummary,
  }: LoadWorkspaceOptions) {
    await ensureBookWorkspaceTemplate(bookId);
    if (!isCurrent()) {
      return false;
    }
    const [rootNode, workspace] = await Promise.all([
      readWorkspaceTree(bookId),
      workspaceSummary ? Promise.resolve(workspaceSummary) : readWorkspaceSummaryById(bookId),
    ]);
    if (!isCurrent()) {
      return false;
    }
    // displayPath（books/<书名>）只作展示与路径拼接（tree 前缀/关联显示），不再参与解析。
    const displayPath = workspace.path;
    const selectedNode = selectedFilePath ? findNodeByPath(rootNode, selectedFilePath) : null;
    const nextSelectedFilePath =
      selectedNode?.kind === "file" && isTextEditableFile(selectedNode.path)
        ? selectedNode.path
        : findDefaultOpenFilePath(rootNode, displayPath);
    const expandedPaths = buildExpandedPaths(rootNode, nextSelectedFilePath);

    if (nextSelectedFilePath && isTextEditableFile(nextSelectedFilePath)) {
      const content = await readWorkspaceTextFile(bookId, nextSelectedFilePath);
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
        rootPath: displayPath,
      });
      setStoredWorkspaceSnapshot(workspace.id, nextSelectedFilePath);
      // 切换/刷新工作区后,异步刷新关联缓存,失败由 refreshRelations 内部消化。
      void get().refreshRelations();
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
      rootPath: displayPath,
    });

    setStoredWorkspaceSnapshot(workspace.id, null);
    void get().refreshRelations();
    return true;
  }

  async function reloadWorkspace(nextSelectedFilePath: string | null) {
    const bookId = get().rootBookId;
    if (!bookId) {
      return;
    }

    await loadWorkspace({ bookId, selectedFilePath: nextSelectedFilePath });
  }

  async function persistDirtyDraftIfNeeded() {
    const { activeFilePath, draftContent, isDirty, rootBookId } = get();
    if (!rootBookId || !activeFilePath || !isDirty) {
      return;
    }

    await writeWorkspaceTextFile(rootBookId, activeFilePath, draftContent);
    set({ isDirty: false });
    setStoredWorkspaceSnapshot(rootBookId, activeFilePath);
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
      const { activeFilePath, confirmState, rootBookId } = get();
      if (!confirmState || !rootBookId) {
        return;
      }

      try {
        set({ errorMessage: null, isBusy: true });
        await deleteWorkspaceEntry(rootBookId, confirmState.path);
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
          bookId: snapshot.bookId,
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
      const { activeFilePath, draftContent, isDirty, rootBookId } = get();
      if (!rootBookId) {
        return;
      }

      const isCurrent = createWorkspaceLoadGuard();
      try {
        set({ errorMessage: null, isBusy: true });

        if (isDirty && activeFilePath) {
          await writeWorkspaceTextFile(rootBookId, activeFilePath, draftContent);
          if (!isCurrent()) {
            return;
          }
          setStoredWorkspaceSnapshot(rootBookId, activeFilePath);
        }

        await loadWorkspace({
          isCurrent,
          bookId: rootBookId,
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
      const { activeFilePath, rootBookId } = get();
      if (!rootBookId) {
        return;
      }

      const isCurrent = createWorkspaceLoadGuard();
      try {
        set({ errorMessage: null, isBusy: true });
        await loadWorkspace({
          isCurrent,
          bookId: rootBookId,
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
    syncWorkspaceFromMirrorIfChanged: async () => {
      // 真实文件存储下不再有镜像旁路；文件即存储，无需从镜像同步。
      // 保留方法签名以兼容调用方，直接重新加载当前工作区即可。
      const { activeFilePath, rootBookId } = get();
      if (!rootBookId) {
        return false;
      }

      const isCurrent = createWorkspaceLoadGuard();
      try {
        await loadWorkspace({
          isCurrent,
          bookId: rootBookId,
          selectedFilePath: activeFilePath,
        });
        return isCurrent();
      } catch (error) {
        if (isCurrent()) {
          set({ errorMessage: getReadableError(error) });
        }
        return false;
      }
    },
    requestDelete: (node) => set({ confirmState: buildDeletePrompt(node) }),
    resetState: () => set({ ...initialState }),
    rootBookId: null,
    rootBookName: null,
    rootNode: null,
    rootPath: null,
    saveActiveFile: async () => {
      const { activeFilePath, draftContent, rootBookId } = get();
      if (!activeFilePath || !rootBookId) {
        return;
      }

      try {
        set({ errorMessage: null, isBusy: true });
        await writeWorkspaceTextFile(rootBookId, activeFilePath, draftContent);
        set({ isDirty: false });
        setStoredWorkspaceSnapshot(rootBookId, activeFilePath);
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
          bookId: workspace.id,
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
      const { expandedPaths, rootNode, rootBookId } = get();
      if (!rootBookId || !isTextEditableFile(path)) {
        return;
      }

      try {
        set({ errorMessage: null, isBusy: true });
        const content = await readWorkspaceTextFile(rootBookId, path);
        const nextExpandedPaths = rootNode
          ? [...new Set([...expandedPaths, ...buildExpandedPaths(rootNode, path)])]
          : expandedPaths;
        set({
          activeFilePath: path,
          draftContent: content,
          expandedPaths: nextExpandedPaths,
          isDirty: false,
        });
        setStoredWorkspaceSnapshot(rootBookId, path);
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
      const { activeFilePath, promptState, rootBookId } = get();
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
            bookId: workspace.id,
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

        if (!rootBookId) {
          throw new Error("当前没有打开书籍工作区。");
        }

        if (promptState.mode === "createFolder" && promptState.parentPath) {
          await createWorkspaceDirectory(rootBookId, promptState.parentPath, trimmedValue);
          set({ promptState: null });
          await reloadWorkspace(activeFilePath);
          set({ isBusy: false });
          return;
        }

        if (promptState.mode === "createFile" && promptState.parentPath) {
          const nextFilePath = await createWorkspaceTextFile(rootBookId, promptState.parentPath, trimmedValue);
          set({ promptState: null });
          await loadWorkspace({
            bookId: rootBookId,
            selectedFilePath: nextFilePath,
          });
          set({ isBusy: false });
          return;
        }

        if (promptState.mode === "rename" && promptState.targetPath) {
          const nextPath = await renameWorkspaceEntry(rootBookId, promptState.targetPath, trimmedValue);
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
    // —— 文件关联 ——
    refreshRelations: async () => {
      const { rootBookId, rootPath } = get();
      if (!rootBookId || !rootPath) {
        return;
      }
      try {
        const rawRelations = await listBookRelations(rootBookId);
        // 后端返回 entryAPath/entryBPath 是相对路径,这里用 displayPath(rootPath)转成展示路径,
        // 让 UI 组件可以直接拿 node.path 去比对。
        const relations: WorkspaceRelation[] = rawRelations.map((relation) => ({
          ...relation,
          entryAPath: relation.entryAPath ? `${rootPath}/${relation.entryAPath}` : rootPath,
          entryBPath: relation.entryBPath ? `${rootPath}/${relation.entryBPath}` : rootPath,
        }));

        const relationsByEntry: Record<string, WorkspaceRelation[]> = {};
        const relationCountByEntry: Record<string, number> = {};
        for (const relation of relations) {
          for (const entryPath of [relation.entryAPath, relation.entryBPath]) {
            if (!relationsByEntry[entryPath]) {
              relationsByEntry[entryPath] = [];
            }
            relationsByEntry[entryPath].push(relation);
            relationCountByEntry[entryPath] = (relationCountByEntry[entryPath] ?? 0) + 1;
          }
        }
        set({ relationCountByEntry, relationsByEntry });
      } catch (error) {
        // 拉取失败不阻塞主流程,只清空缓存避免显示陈旧数据。
        set({
          errorMessage: getReadableError(error),
          relationCountByEntry: {},
          relationsByEntry: {},
        });
      }
    },
    createRelation: async (entryAPath, entryBPath, relationship, note) => {
      const rootBookId = get().rootBookId;
      if (!rootBookId) {
        throw new Error("当前没有打开的书籍。");
      }
      const created = await createEntryRelation(
        rootBookId,
        entryAPath,
        entryBPath,
        relationship,
        note ?? null,
      );
      await get().refreshRelations();
      return created;
    },
    updateRelation: async (relationId, changes) => {
      const rootBookId = get().rootBookId;
      if (!rootBookId) {
        throw new Error("当前没有打开的书籍。");
      }
      const updated = await updateEntryRelation(rootBookId, relationId, changes);
      await get().refreshRelations();
      return updated;
    },
    deleteRelation: async (relationId) => {
      const rootBookId = get().rootBookId;
      if (!rootBookId) {
        throw new Error("当前没有打开的书籍。");
      }
      await deleteEntryRelation(rootBookId, relationId);
      await get().refreshRelations();
    },
  };
});
