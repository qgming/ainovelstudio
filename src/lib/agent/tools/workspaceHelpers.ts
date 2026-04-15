import type { TreeNode, WorkspaceSearchMatch } from "../../bookWorkspace/types";
import {
  ensureString,
  normalizeToolPath,
  toDisplayPath,
} from "./shared";

export type BrowseMode = "list" | "stat" | "tree";
export type SearchScope = "all" | "content" | "names";
export type ReadMode = "full" | "head" | "range" | "tail";
export type EditAction =
  | "append"
  | "insert_after"
  | "insert_before"
  | "prepend"
  | "replace";
export type PathAction =
  | "create_file"
  | "create_folder"
  | "delete"
  | "move"
  | "rename";

export function splitTextLines(contents: string) {
  const normalized = contents.replace(/\r\n/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");
  if (hasTrailingNewline) {
    lines.pop();
  }
  if (lines.length === 0) {
    lines.push("");
  }
  return lines;
}

export function renderLineWindow(path: string, startLine: number, lines: string[]) {
  const endLine = startLine + lines.length - 1;
  return [
    `[${path} | lines ${startLine}-${endLine}]`,
    ...lines.map((line, index) => `${startLine + index} | ${line}`),
  ].join("\n");
}

export function formatSearchSummary(
  query: string,
  matches: WorkspaceSearchMatch[],
) {
  if (matches.length === 0) {
    return `未找到与“${query}”相关的结果。`;
  }

  return [
    `共找到 ${matches.length} 条与“${query}”相关的结果：`,
    ...matches.map((match) => {
      if (match.matchType === "content") {
        return `- [内容] ${match.path}:${match.lineNumber} ${match.lineText ?? ""}`.trimEnd();
      }

      const label = match.matchType === "directory_name" ? "文件夹" : "文件名";
      return `- [${label}] ${match.path}`;
    }),
  ].join("\n");
}

export function formatBrowseListSummary(
  path: string,
  children: Array<{ kind: string; path: string }>,
) {
  if (children.length === 0) {
    return `${path} 为空目录。`;
  }

  return [
    `${path} 下共有 ${children.length} 项：`,
    ...children.map(
      (child) =>
        `- [${child.kind === "directory" ? "目录" : "文件"}] ${child.path}`,
    ),
  ].join("\n");
}

export function findTreeNode(
  rootPath: string,
  node: TreeNode,
  relativePath: string,
): TreeNode | null {
  if (toDisplayPath(rootPath, node.path) === (relativePath || ".")) {
    return node;
  }

  for (const child of node.children ?? []) {
    const found = findTreeNode(rootPath, child, relativePath);
    if (found) {
      return found;
    }
  }

  return null;
}

export function pruneTree(rootPath: string, node: TreeNode, depth: number): TreeNode {
  return {
    ...node,
    path: toDisplayPath(rootPath, node.path),
    children:
      depth <= 0
        ? undefined
        : node.children?.map((child) => pruneTree(rootPath, child, depth - 1)),
  };
}

export function summarizeTreeNode(rootPath: string, node: TreeNode) {
  return {
    childCount: node.children?.length ?? 0,
    extension: node.extension,
    kind: node.kind,
    name: node.name,
    path: toDisplayPath(rootPath, node.path),
  };
}

export function listTreeChildren(rootPath: string, node: TreeNode) {
  return (node.children ?? []).map((child) => ({
    childCount: child.children?.length ?? 0,
    extension: child.extension,
    kind: child.kind,
    name: child.name,
    path: toDisplayPath(rootPath, child.path),
  }));
}

export function normalizeSearchScope(value: unknown): SearchScope {
  return value === "content" || value === "names" ? value : "all";
}

export function normalizeBrowseMode(value: unknown): BrowseMode {
  return value === "stat" || value === "tree" ? value : "list";
}

export function normalizeReadMode(value: unknown): ReadMode {
  return value === "head" || value === "range" || value === "tail"
    ? value
    : "full";
}

export function normalizeEditAction(value: unknown): EditAction {
  if (
    value === "append" ||
    value === "insert_after" ||
    value === "insert_before" ||
    value === "prepend"
  ) {
    return value;
  }
  return "replace";
}

export function normalizePathAction(value: unknown): PathAction {
  if (
    value === "create_file" ||
    value === "create_folder" ||
    value === "delete" ||
    value === "move"
  ) {
    return value;
  }
  return "rename";
}

export function matchesPathScope(pathFilter: string, candidatePath: string) {
  if (!pathFilter) {
    return true;
  }

  return (
    candidatePath === pathFilter || candidatePath.startsWith(`${pathFilter}/`)
  );
}

export function matchesExtensionFilter(
  extensions: string[],
  candidatePath: string,
  matchType: WorkspaceSearchMatch["matchType"],
) {
  if (extensions.length === 0) {
    return true;
  }
  if (matchType === "directory_name") {
    return false;
  }

  const normalizedPath = normalizeToolPath(candidatePath).toLowerCase();
  return extensions.some((extension) => normalizedPath.endsWith(extension));
}

function countExactMatches(source: string, target: string) {
  if (!target) {
    throw new Error("edit.target 不能为空。");
  }

  let count = 0;
  let index = 0;
  while ((index = source.indexOf(target, index)) >= 0) {
    count += 1;
    index += target.length;
  }
  return count;
}

export function applyTextEdit(
  source: string,
  action: EditAction,
  target: string | undefined,
  content: string,
  expectedCount: number,
  replaceAll: boolean,
) {
  if (action === "append") {
    return { matchCount: 1, nextContent: `${source}${content}` };
  }

  if (action === "prepend") {
    return { matchCount: 1, nextContent: `${content}${source}` };
  }

  const exactTarget = ensureString(target, "edit.target");
  const matchCount = countExactMatches(source, exactTarget);
  if (matchCount === 0) {
    throw new Error("未找到 edit.target 指定的文本。");
  }
  if (!replaceAll && matchCount !== expectedCount) {
    throw new Error(
      `edit.target 命中 ${matchCount} 处，与 expectedCount=${expectedCount} 不一致。`,
    );
  }

  if (action === "replace") {
    return {
      matchCount,
      nextContent: replaceAll
        ? source.split(exactTarget).join(content)
        : source.replace(exactTarget, content),
    };
  }

  const replacement =
    action === "insert_before"
      ? `${content}${exactTarget}`
      : `${exactTarget}${content}`;

  return {
    matchCount,
    nextContent: replaceAll
      ? source.split(exactTarget).join(replacement)
      : source.replace(exactTarget, replacement),
  };
}
