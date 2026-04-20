import {
  createWorkspaceDirectory,
  createWorkspaceTextFile,
  deleteWorkspaceEntry,
  readWorkspaceTextFile,
  moveWorkspaceEntry,
  readWorkspaceTree,
  renameWorkspaceEntry,
  searchWorkspaceContent,
} from "../../bookWorkspace/api";
import type { WorkspaceSearchMatch } from "../../bookWorkspace/types";
import type { AgentTool } from "../runtime";
import {
  addSearchContextWindow,
  buildSearchQueries,
  dedupeSearchMatches,
  filterSearchMatch,
  normalizeSearchMatchMode,
  limitSearchMatchesPerFile,
  normalizeSearchSortBy,
  sortSearchMatches,
} from "./workspaceSearchHelpers";
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

type BrowseChild = ReturnType<typeof listTreeChildren>[number];

function asNonNegativeInt(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
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

async function buildSearchContextMap(
  rootPath: string,
  matches: WorkspaceSearchMatch[],
  context: ReturnType<typeof getAbortContext>,
) {
  const contentPaths = Array.from(
    new Set(
      matches
        .filter((match) => match.matchType === "content" && match.lineNumber)
        .map((match) => match.path),
    ),
  );

  const files = await Promise.all(
    contentPaths.map(async (path) => [
      path,
      await readWorkspaceTextFile(rootPath, path, context),
    ] as const),
  );

  return new Map(files);
}

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
          listTreeChildren(rootPath, node).filter((child) => {
            if (kindFilter !== "all" && child.kind !== kindFilter) {
              return false;
            }
            return matchesBrowseExtensions(child, extensions);
          }),
          sortBy,
        );
        const limitedChildren =
          limit == null ? children : children.slice(0, limit);
        return ok(formatBrowseListSummary(displayPath, limitedChildren), {
          children: limitedChildren,
          kind: node.kind,
          name: node.name,
          path: displayPath,
        });
      },
    },
    search: {
      description: "搜索工作区内容",
      execute: async (input, context) => {
        const abortContext = getAbortContext(context);
        const query = ensureString(input.query, "search.query");
        const limit = asPositiveInt(input.limit, 50);
        const beforeLines = asNonNegativeInt(input.beforeLines, 0);
        const afterLines = asNonNegativeInt(input.afterLines, 0);
        const caseSensitive = Boolean(input.caseSensitive);
        const matchMode = normalizeSearchMatchMode(input.matchMode);
        const wholeWord = Boolean(input.wholeWord);
        const maxPerFile = asNonNegativeInt(input.maxPerFile, 0);
        const pathFilter = normalizeRelativePath(
          rootPath,
          String(input.path ?? ""),
        );
        const scope = normalizeSearchScope(input.scope);
        const sortBy = normalizeSearchSortBy(input.sortBy);
        const extensions = Array.isArray(input.extensions)
          ? input.extensions
              .map((extension) => String(extension).trim().toLowerCase())
              .filter((extension) => extension)
              .map((extension) =>
                extension.startsWith(".") ? extension : `.${extension}`,
              )
          : [];
        const needsExtraResults = Boolean(
          afterLines > 0 ||
            beforeLines > 0 ||
            caseSensitive ||
            matchMode !== "phrase" ||
            maxPerFile > 0 ||
            pathFilter ||
            scope !== "all" ||
            sortBy === "relevance" ||
            wholeWord ||
            extensions.length > 0,
        );
        const rawLimit = Math.min(needsExtraResults ? limit * 6 : limit, 200);
        const rawQueries = buildSearchQueries(query, matchMode);
        const rawMatches = await Promise.all(
          rawQueries.map((rawQuery) =>
            searchWorkspaceContent(
              rootPath,
              rawQuery,
              rawLimit,
              abortContext,
            ),
          ),
        );
        const matches = dedupeSearchMatches(rawMatches.flat());
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
          .flatMap((match) => {
            const filteredMatch = filterSearchMatch(match, {
              caseSensitive,
              matchMode,
              query,
              wholeWord,
            });
            return filteredMatch ? [filteredMatch] : [];
          });
        const sorted = sortSearchMatches(filtered, sortBy);
        const limited = maxPerFile > 0
          ? limitSearchMatchesPerFile(sorted, maxPerFile)
          : sorted;
        const trimmed = limited.slice(0, limit);
        const fileContents =
          beforeLines > 0 || afterLines > 0
            ? await buildSearchContextMap(rootPath, trimmed, abortContext)
            : null;
        const enriched = trimmed.map((match) => {
          const contents = fileContents?.get(match.path);
          if (!contents) {
            return match;
          }
          return addSearchContextWindow(match, contents, beforeLines, afterLines);
        });

        return ok(formatSearchSummary(query, enriched), enriched);
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
