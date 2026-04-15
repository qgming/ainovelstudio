import {
  createWorkspaceDirectory,
  createWorkspaceTextFile,
  deleteWorkspaceEntry,
  moveWorkspaceEntry,
  readWorkspaceTree,
  renameWorkspaceEntry,
  searchWorkspaceContent,
} from "../../bookWorkspace/api";
import type { AgentTool } from "../runtime";
import {
  findTreeNode,
  formatBrowseListSummary,
  formatSearchSummary,
  listTreeChildren,
  matchesExtensionFilter,
  matchesPathScope,
  normalizeBrowseMode,
  normalizePathAction,
  normalizeSearchScope,
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

export function createWorkspaceStructureTools({
  onWorkspaceMutated,
  rootPath,
}: WorkspaceToolContext): Record<string, AgentTool> {
  return {
    browse: {
      description: "浏览工作区结构",
      execute: async (input, context) => {
        const mode = normalizeBrowseMode(input.mode);
        const relativePath = normalizeRelativePath(
          rootPath,
          String(input.path ?? ""),
        );
        const depth = asPositiveInt(input.depth, 2);
        const tree = await readWorkspaceTree(rootPath, getAbortContext(context));
        const node = findTreeNode(rootPath, tree, relativePath);
        if (!node) {
          throw new Error(`未找到路径：${relativePath || "."}`);
        }

        const displayPath = toDisplayPath(rootPath, node.path);
        if (mode === "tree") {
          return ok(
            `已浏览 ${displayPath} 的目录树。`,
            pruneTree(rootPath, node, depth),
          );
        }

        if (mode === "stat") {
          return ok(
            `已读取 ${displayPath} 的路径信息。`,
            summarizeTreeNode(rootPath, node),
          );
        }

        if (node.kind !== "directory") {
          throw new Error("browse.list 只能用于目录。");
        }

        const children = listTreeChildren(rootPath, node);
        return ok(formatBrowseListSummary(displayPath, children), {
          children,
          kind: node.kind,
          name: node.name,
          path: displayPath,
        });
      },
    },
    search: {
      description: "搜索工作区内容",
      execute: async (input, context) => {
        const query = ensureString(input.query, "search.query");
        const limit = asPositiveInt(input.limit, 50);
        const pathFilter = normalizeRelativePath(
          rootPath,
          String(input.path ?? ""),
        );
        const scope = normalizeSearchScope(input.scope);
        const extensions = Array.isArray(input.extensions)
          ? input.extensions
              .map((extension) => String(extension).trim().toLowerCase())
              .filter((extension) => extension)
              .map((extension) =>
                extension.startsWith(".") ? extension : `.${extension}`,
              )
          : [];
        const needsExtraResults = Boolean(
          pathFilter || scope !== "all" || extensions.length > 0,
        );
        const rawLimit = Math.min(needsExtraResults ? limit * 4 : limit, 200);
        const matches = await searchWorkspaceContent(
          rootPath,
          query,
          rawLimit,
          getAbortContext(context),
        );
        const filtered = matches
          .filter((match) => {
            if (scope === "content" && match.matchType !== "content") {
              return false;
            }
            if (scope === "names" && match.matchType === "content") {
              return false;
            }
            if (
              !matchesPathScope(
                pathFilter,
                normalizeRelativePath(rootPath, match.path),
              )
            ) {
              return false;
            }
            return matchesExtensionFilter(
              extensions,
              match.path,
              match.matchType,
            );
          })
          .slice(0, limit);

        return ok(formatSearchSummary(query, filtered), filtered);
      },
    },
    path: {
      description: "处理工作区路径结构",
      execute: async (input, context) => {
        const action = normalizePathAction(input.action);
        if (action === "create_file") {
          const createdPath = await createWorkspaceTextFile(
            rootPath,
            String(input.parentPath ?? ""),
            ensureString(input.name, "path.name"),
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(`已创建文件 ${toDisplayPath(rootPath, createdPath)}`);
        }

        if (action === "create_folder") {
          const createdPath = await createWorkspaceDirectory(
            rootPath,
            String(input.parentPath ?? ""),
            ensureString(input.name, "path.name"),
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(`已创建文件夹 ${toDisplayPath(rootPath, createdPath)}`);
        }

        if (action === "move") {
          const movedPath = await moveWorkspaceEntry(
            rootPath,
            ensureString(input.path, "path.path"),
            ensureString(input.targetParentPath, "path.targetParentPath"),
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(`已迁移到 ${toDisplayPath(rootPath, movedPath)}`);
        }

        if (action === "delete") {
          const path = ensureString(input.path, "path.path");
          await deleteWorkspaceEntry(rootPath, path, getAbortContext(context));
          await onWorkspaceMutated?.();
          return ok(`已删除 ${toDisplayPath(rootPath, path)}`);
        }

        const renamedPath = await renameWorkspaceEntry(
          rootPath,
          ensureString(input.path, "path.path"),
          ensureString(input.name, "path.name"),
          getAbortContext(context),
        );
        await onWorkspaceMutated?.();
        return ok(`已重命名为 ${toDisplayPath(rootPath, renamedPath)}`);
      },
    },
  };
}
