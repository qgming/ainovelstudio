import { readWorkspaceTextFile, readWorkspaceTree } from "../../bookWorkspace/api";
import type { TreeNode } from "../../bookWorkspace/types";
import type { AgentTool } from "../runtime";
import {
  getAbortContext,
  ok,
  ensureString,
  normalizeRelativePath,
  toDisplayPath,
  type WorkspaceToolContext,
} from "./shared";
import { findTreeNode } from "./workspaceHelpers";

type TextCountStats = {
  path: string;
  characterCount: number;
  nonWhitespaceCharacterCount: number;
  chineseCharacterCount: number;
  latinWordCount: number;
  digitCount: number;
  lineCount: number;
  paragraphCount: number;
};

type BatchTotals = {
  fileCount: number;
  characterCount: number;
  nonWhitespaceCharacterCount: number;
  chineseCharacterCount: number;
  latinWordCount: number;
  paragraphCount: number;
};

const DEFAULT_TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".json",
]);

function countMatches(text: string, pattern: RegExp) {
  return Array.from(text.matchAll(pattern)).length;
}

function computeTextCountStats(path: string, content: string): TextCountStats {
  const characters = Array.from(content);
  const normalized = content.replace(/\r\n/g, "\n");
  const paragraphs = normalized
    .split(/\n\s*\n/gu)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return {
    path,
    characterCount: characters.length,
    nonWhitespaceCharacterCount: characters.filter((char) => !/\s/u.test(char))
      .length,
    chineseCharacterCount: countMatches(content, /\p{Script=Han}/gu),
    latinWordCount: countMatches(content, /[A-Za-z]+(?:[’'-][A-Za-z]+)*/g),
    digitCount: countMatches(content, /\d/gu),
    lineCount: content.length === 0 ? 0 : normalized.split("\n").length,
    paragraphCount: paragraphs.length,
  };
}

function formatWordCountSummary(stats: TextCountStats) {
  return [
    `已统计 ${stats.path}：`,
    `- 字符数：${stats.characterCount}`,
    `- 非空白字符数：${stats.nonWhitespaceCharacterCount}`,
    `- 中文字符数：${stats.chineseCharacterCount}`,
    `- 英文单词数：${stats.latinWordCount}`,
    `- 数字数：${stats.digitCount}`,
    `- 行数：${stats.lineCount}`,
    `- 段落数：${stats.paragraphCount}`,
  ].join("\n");
}

// 批量字数：扁平展开目录下所有文本文件路径
function collectTextFilePaths(
  rootPath: string,
  node: TreeNode,
  extensions: Set<string>,
  out: string[],
) {
  if (node.kind === "file") {
    const ext = (node.extension ?? "").toLowerCase();
    const normalizedExt = ext.startsWith(".") ? ext : ext ? `.${ext}` : "";
    if (extensions.size === 0 || extensions.has(normalizedExt)) {
      out.push(toDisplayPath(rootPath, node.path));
    }
    return;
  }
  for (const child of node.children ?? []) {
    collectTextFilePaths(rootPath, child, extensions, out);
  }
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

function summarizeBatch(items: TextCountStats[]): BatchTotals & {
  medianCharacterCount: number;
} {
  const totals: BatchTotals = {
    fileCount: items.length,
    characterCount: 0,
    nonWhitespaceCharacterCount: 0,
    chineseCharacterCount: 0,
    latinWordCount: 0,
    paragraphCount: 0,
  };
  for (const item of items) {
    totals.characterCount += item.characterCount;
    totals.nonWhitespaceCharacterCount += item.nonWhitespaceCharacterCount;
    totals.chineseCharacterCount += item.chineseCharacterCount;
    totals.latinWordCount += item.latinWordCount;
    totals.paragraphCount += item.paragraphCount;
  }
  return {
    ...totals,
    medianCharacterCount: median(items.map((item) => item.characterCount)),
  };
}

function formatBatchSummary(items: TextCountStats[]): string {
  const totals = summarizeBatch(items);
  const top = [...items]
    .sort((a, b) => b.characterCount - a.characterCount)
    .slice(0, 5);
  return [
    `已统计 ${totals.fileCount} 个文件：`,
    `- 总字符数：${totals.characterCount}`,
    `- 总中文字符数：${totals.chineseCharacterCount}`,
    `- 总段落数：${totals.paragraphCount}`,
    `- 中位字符数：${totals.medianCharacterCount}`,
    "字符数前 5：",
    ...top.map((item) => `- ${item.path}：${item.characterCount}`),
  ].join("\n");
}

function normalizeExtensions(input: unknown): Set<string> {
  if (!Array.isArray(input)) {
    return new Set();
  }
  const set = new Set<string>();
  for (const raw of input) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (!value) continue;
    set.add(value.startsWith(".") ? value : `.${value}`);
  }
  return set;
}

export function createWorkspaceWordCountTools({
  rootPath,
}: WorkspaceToolContext): Record<string, AgentTool> {
  return {
    word_count: {
      description:
        "统计文本文件的字数和结构指标。支持 path（单文件）、paths（多文件）、dir（目录递归批量统计）三种模式。",
      execute: async (input, context) => {
        const abortContext = getAbortContext(context);

        // 单文件模式（兼容旧调用）
        if (input.path && !input.paths && !input.dir) {
          const path = ensureString(input.path, "word_count.path");
          const content = await readWorkspaceTextFile(rootPath, path, abortContext);
          const stats = computeTextCountStats(path, content);
          return ok(formatWordCountSummary(stats), stats);
        }

        // 解析批量目标列表
        let targetPaths: string[] = [];
        if (Array.isArray(input.paths) && input.paths.length > 0) {
          targetPaths = input.paths.map((value, index) =>
            ensureString(value, `word_count.paths[${index}]`),
          );
        } else if (input.dir != null) {
          const dirRel = normalizeRelativePath(rootPath, String(input.dir ?? ""));
          const tree = await readWorkspaceTree(rootPath, abortContext);
          const node = findTreeNode(rootPath, tree, dirRel);
          if (!node) {
            throw new Error(`未找到路径：${dirRel || "."}`);
          }
          if (node.kind !== "directory") {
            throw new Error("word_count.dir 必须指向目录。");
          }
          const exts = normalizeExtensions(input.extensions);
          const filterExts = exts.size > 0 ? exts : DEFAULT_TEXT_EXTENSIONS;
          collectTextFilePaths(rootPath, node, filterExts, targetPaths);
        } else {
          throw new Error(
            "word_count 需要传入 path、paths 或 dir 之一。",
          );
        }

        if (targetPaths.length === 0) {
          return ok("未找到匹配的文本文件。", {
            files: [],
            totals: summarizeBatch([]),
          });
        }

        const items: TextCountStats[] = [];
        for (const path of targetPaths) {
          const content = await readWorkspaceTextFile(rootPath, path, abortContext);
          items.push(computeTextCountStats(path, content));
        }
        const totals = summarizeBatch(items);
        return ok(formatBatchSummary(items), {
          files: items,
          totals,
        });
      },
    },
  };
}
