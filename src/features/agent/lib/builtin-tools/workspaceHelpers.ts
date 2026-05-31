import type { TreeNode, WorkspaceGrepResult, WorkspaceSearchResult } from "@features/books/types";
import {
  ensureString,
  toDisplayPath,
} from "./shared";

export type BrowseMode = "list" | "stat" | "tree";
export type ReadMode =
  | "anchor_range"
  | "full"
  | "head"
  | "heading_range"
  | "range"
  | "tail";
export type EditAction =
  | "append"
  | "insert_after"
  | "insert_before"
  | "prepend"
  | "replace_anchor_range"
  | "replace_heading_range"
  | "replace_lines"
  | "replace";
export type PathAction = "create_folder" | "move" | "rename" | "delete";

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
  result: WorkspaceSearchResult,
) {
  if (result.results.length === 0) {
    return `未找到可用于“${result.query}”的工作区上下文。`;
  }

  const truncation = result.truncated ? "，结果已按上下文预算截断" : "";
  return [
    `找到 ${result.results.length} 段与“${result.query}”相关的工作区上下文${truncation}：`,
    ...result.results.map((hit) => {
      const title = hit.sectionTitle ? ` · ${hit.sectionTitle}` : "";
      return `- ${hit.path}:${hit.startLine}-${hit.endLine} [${hit.sourceKind}${title}] ${hit.reason}`;
    }),
  ].join("\n");
}

export function formatGrepSummary(result: WorkspaceGrepResult) {
  if (result.matches.length === 0) {
    return `未匹配到“${result.pattern}”。`;
  }

  const mode = result.isRegex ? "正则" : "字面量";
  const truncation = result.truncated
    ? `（已截断，实际命中 ${result.total} 处）`
    : "";
  return [
    `${mode}匹配“${result.pattern}”命中 ${result.matches.length} 处${truncation}：`,
    ...result.matches.map((match) => `- ${match.path}:${match.lineNumber} ${match.line.trim()}`),
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

export function normalizeBrowseMode(value: unknown): BrowseMode {
  return value === "stat" || value === "tree" ? value : "list";
}

export function normalizeReadMode(value: unknown): ReadMode {
  return value === "anchor_range" ||
    value === "head" ||
    value === "heading_range" ||
    value === "range" ||
    value === "tail"
    ? value
    : "full";
}

export function normalizeEditAction(value: unknown): EditAction {
  if (
    value === "append" ||
    value === "insert_after" ||
    value === "insert_before" ||
    value === "prepend" ||
    value === "replace_anchor_range" ||
    value === "replace_heading_range" ||
    value === "replace_lines"
  ) {
    return value;
  }
  return "replace";
}

export function normalizePathAction(value: unknown): PathAction {
  if (value === "create_folder" || value === "move" || value === "delete") {
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

function countExactMatches(source: string, target: string) {
  if (!target) {
    throw new Error("workspace_edit.target 不能为空。");
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
  action: Exclude<
    EditAction,
    "replace_anchor_range" | "replace_heading_range" | "replace_lines"
  >,
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

  const exactTarget = ensureString(target, "workspace_edit.target");
  const matchCount = countExactMatches(source, exactTarget);
  if (matchCount === 0) {
    throw new Error("未找到 workspace_edit.target 指定的文本。");
  }
  if (!replaceAll && matchCount !== expectedCount) {
    throw new Error(
      `workspace_edit.target 命中 ${matchCount} 处，与 expectedCount=${expectedCount} 不一致。`,
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

export function replaceTextByLineRange(
  source: string,
  content: string,
  startLine: number,
  endLine: number,
) {
  if (endLine < startLine) {
    throw new Error("workspace_edit.replace_lines 的 endLine 不能小于 startLine。");
  }

  const lines = splitTextLines(source);
  if (startLine > lines.length) {
    throw new Error(`workspace_edit.replace_lines 的 startLine 超出文件范围：${startLine}。`);
  }

  const normalized = source.replace(/\r\n/g, "\n");
  const hasTrailingNewline = normalized.endsWith("\n");
  const boundedEndLine = Math.min(endLine, lines.length);
  const replacementLines = content
    ? content.replace(/\r\n/g, "\n").split("\n")
    : [];
  const nextLines = [
    ...lines.slice(0, startLine - 1),
    ...replacementLines,
    ...lines.slice(boundedEndLine),
  ];

  let nextContent = nextLines.join("\n");
  if (hasTrailingNewline && nextContent) {
    nextContent += "\n";
  }

  return {
    endLine: boundedEndLine,
    nextContent,
    startLine,
  };
}
