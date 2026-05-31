import {
  createWorkspaceDirectory,
  deleteWorkspaceEntry,
  moveWorkspaceEntry,
  readWorkspaceTree,
  renameWorkspaceEntry,
  searchWorkspaceContent,
} from "@features/books/api/bookWorkspaceApi";
import type { WorkspaceSearchIntent } from "@features/books/types";
import type { AgentTool } from "../runtime";
import {
  findTreeNode,
  formatBrowseListSummary,
  formatSearchSummary,
  listTreeChildren,
  normalizeBrowseMode,
  normalizePathAction,
  pruneTree,
  summarizeTreeNode,
} from "./workspaceHelpers";
import {
  asPositiveInt,
  ensureString,
  getAbortContext,
  ok,
  normalizeRelativePath,
  toDisplayPath,
  type WorkspaceToolContext,
} from "./shared";

type BrowseChild = ReturnType<typeof listTreeChildren>[number];

function normalizeSearchIntent(value: unknown): WorkspaceSearchIntent {
  return value === "fact" ||
    value === "character" ||
    value === "plot" ||
    value === "chapter" ||
    value === "path" ||
    value === "status" ||
    value === "conflict"
    ? value
    : "auto";
}

function normalizeSearchScopeInput(rootPath: string, value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeRelativePath(rootPath, String(item ?? "")))
      .filter(Boolean);
  }
  const single = normalizeRelativePath(rootPath, String(value ?? ""));
  return single ? [single] : [];
}

function normalizeBrowseKind(value: unknown) {
  return value === "directory" || value === "file" ? value : "all";
}

function normalizeBrowseSortBy(value: unknown) {
  return value === "type" ? "type" : "name";
}

function sortBrowseChildren(children: BrowseChild[], sortBy: "name" | "type") {
  return [...children].sort((left, right) => {
    if (sortBy === "type" && left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.path.localeCompare(right.path, "zh-CN");
  });
}

function matchesBrowseExtensions(
  child: BrowseChild,
  extensions: string[],
) {
  if (extensions.length === 0) {
    return true;
  }
  if (child.kind !== "file") {
    return false;
  }

  const normalizedPath = child.path.toLowerCase();
  return extensions.some((extension) => normalizedPath.endsWith(extension));
}

export function createWorkspaceStructureTools({
  onWorkspaceMutated,
  bookId,
  displayPath,
}: WorkspaceToolContext): Record<string, AgentTool> {
  return {
    workspace_browse: {
      description: "浏览工作区结构",
      execute: async (input, context) => {
        const mode = normalizeBrowseMode(input.mode);
        const relativePath = normalizeRelativePath(
          displayPath,
          String(input.path ?? ""),
        );
        const depth = asPositiveInt(input.depth, 2);
        const tree = await readWorkspaceTree(bookId, getAbortContext(context));
        const node = findTreeNode(displayPath, tree, relativePath);
        if (!node) {
          throw new Error(`未找到路径：${relativePath || "."}`);
        }

        const nodeDisplayPath = toDisplayPath(displayPath, node.path);
        if (mode === "tree") {
          return ok(
            `已浏览 ${nodeDisplayPath} 的目录树。`,
            pruneTree(displayPath, node, depth),
          );
        }

        if (mode === "stat") {
          return ok(
            `已读取 ${nodeDisplayPath} 的路径信息。`,
            summarizeTreeNode(displayPath, node),
          );
        }

        if (node.kind !== "directory") {
          throw new Error("workspace_browse.list 只能用于目录。");
        }

        const kindFilter = normalizeBrowseKind(input.kind);
        const sortBy = normalizeBrowseSortBy(input.sortBy);
        const limit =
          input.limit == null ? null : asPositiveInt(input.limit, 50);
        const extensions = Array.isArray(input.extensions)
          ? input.extensions
              .map((extension) => String(extension).trim().toLowerCase())
              .filter((extension) => extension)
              .map((extension) =>
                extension.startsWith(".") ? extension : `.${extension}`,
              )
          : [];
        const children = sortBrowseChildren(
          listTreeChildren(displayPath, node).filter((child) => {
            if (kindFilter !== "all" && child.kind !== kindFilter) {
              return false;
            }
            return matchesBrowseExtensions(child, extensions);
          }),
          sortBy,
        );
        const limitedChildren =
          limit == null ? children : children.slice(0, limit);
        return ok(formatBrowseListSummary(nodeDisplayPath, limitedChildren), {
          children: limitedChildren,
          kind: node.kind,
          name: node.name,
          path: nodeDisplayPath,
        });
      },
    },
    workspace_search: {
      description: "检索工作区事实源和正文证据",
      execute: async (input, context) => {
        const abortContext = getAbortContext(context);
        const query = ensureString(input.query, "workspace_search.query");
        const limit = Math.min(asPositiveInt(input.limit, 8), 30);
        const tokenBudget = Math.min(
          Math.max(asPositiveInt(input.tokenBudget, 4000), 800),
          12000,
        );
        const intent = normalizeSearchIntent(input.intent);
        const scope = normalizeSearchScopeInput(displayPath, input.scope ?? input.path);
        const result = await searchWorkspaceContent(bookId, query, {
          abortSignal: abortContext?.abortSignal,
          includeAdjacent: input.includeAdjacent !== false,
          intent,
          limit,
          requestId: abortContext?.requestId,
          scope,
          tokenBudget,
        });

        return ok(formatSearchSummary(result), result);
      },
    },
    workspace_path: {
      description: "创建文件夹、重命名或移动工作区路径",
      execute: async (input, context) => {
        const action = normalizePathAction(input.action);
        if (action === "create_folder") {
          const createdPath = await createWorkspaceDirectory(
            bookId,
            String(input.parentPath ?? ""),
            ensureString(input.name, "workspace_path.name"),
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(`已创建文件夹 ${toDisplayPath(displayPath, createdPath)}`);
        }

        if (action === "move") {
          const movedPath = await moveWorkspaceEntry(
            bookId,
            ensureString(input.path, "workspace_path.path"),
            ensureString(input.targetParentPath, "workspace_path.targetParentPath"),
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(`已迁移到 ${toDisplayPath(displayPath, movedPath)}`);
        }

        const renamedPath = await renameWorkspaceEntry(
          bookId,
          ensureString(input.path, "workspace_path.path"),
          ensureString(input.name, "workspace_path.name"),
          getAbortContext(context),
        );
        await onWorkspaceMutated?.();
        return ok(`已重命名为 ${toDisplayPath(displayPath, renamedPath)}`);
      },
    },
    workspace_delete: {
      description: "删除工作区文件或文件夹",
      execute: async (input, context) => {
        const path = ensureString(input.path, "workspace_delete.path");
        await deleteWorkspaceEntry(bookId, path, getAbortContext(context));
        await onWorkspaceMutated?.();
        return ok(`已删除 ${toDisplayPath(displayPath, path)}`);
      },
    },
  };
}
