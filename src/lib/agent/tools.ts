import {
  createWorkspaceDirectory,
  createWorkspaceTextFile,
  deleteWorkspaceEntry,
  readWorkspaceTextFile,
  readWorkspaceTextLine,
  readWorkspaceTree,
  renameWorkspaceEntry,
  replaceWorkspaceTextLine,
  searchWorkspaceContent,
  writeWorkspaceTextFile,
} from "../bookWorkspace/api";
import type { WorkspaceSearchMatch } from "../bookWorkspace/types";
import type { AgentTool, ToolResult } from "./runtime";

type WorkspaceToolContext = {
  onWorkspaceMutated?: () => Promise<void>;
  rootPath: string;
};

function ok(summary: string, data?: unknown): ToolResult {
  return { ok: true, summary, data };
}

function formatLinePreview(text: string) {
  return text.length > 0 ? text : "(空行)";
}

function formatSearchSummary(query: string, matches: WorkspaceSearchMatch[]) {
  if (matches.length === 0) {
    return `未找到与“${query}”相关的文件夹、文件名或正文内容。`;
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

export function createWorkspaceToolset({ onWorkspaceMutated, rootPath }: WorkspaceToolContext): Record<string, AgentTool> {
  return {
    create_file: {
      description: "在指定目录中创建文本文件",
      execute: async (input) => {
        const parentPath = String(input.parentPath ?? "");
        const name = String(input.name ?? "");
        const createdPath = await createWorkspaceTextFile(rootPath, parentPath, name);
        await onWorkspaceMutated?.();
        return ok(`已创建文件 ${createdPath}`);
      },
    },
    create_folder: {
      description: "在指定目录中创建文件夹",
      execute: async (input) => {
        const parentPath = String(input.parentPath ?? "");
        const name = String(input.name ?? "");
        const createdPath = await createWorkspaceDirectory(rootPath, parentPath, name);
        await onWorkspaceMutated?.();
        return ok(`已创建文件夹 ${createdPath}`);
      },
    },
    delete_path: {
      description: "删除指定文件或目录",
      execute: async (input) => {
        const path = String(input.path ?? "");
        await deleteWorkspaceEntry(rootPath, path);
        await onWorkspaceMutated?.();
        return ok(`已删除 ${path}`);
      },
    },
    line_edit: {
      description: "按行读取或替换指定文件中的文本内容",
      execute: async (input) => {
        const action = String(input.action ?? "get");
        const path = String(input.path ?? "");
        const lineNumber = Number(input.lineNumber ?? 0);

        if (action === "replace") {
          const contents = String(input.contents ?? "");
          const result = await replaceWorkspaceTextLine(rootPath, path, lineNumber, contents);
          await onWorkspaceMutated?.();
          return ok(
            `已更新 ${result.path} 第 ${result.lineNumber} 行：${formatLinePreview(result.text)}`,
            result,
          );
        }

        const result = await readWorkspaceTextLine(rootPath, path, lineNumber);
        return ok(
          `${result.path} 第 ${result.lineNumber} 行：${formatLinePreview(result.text)}`,
          result,
        );
      },
    },
    read_file: {
      description: "读取指定文本文件内容",
      execute: async (input) => {
        const path = String(input.path ?? "");
        const content = await readWorkspaceTextFile(rootPath, path);
        return ok(content);
      },
    },
    read_workspace_tree: {
      description: "读取当前工作区目录树",
      execute: async () => {
        const tree = await readWorkspaceTree(rootPath);
        return ok(`已读取工作区 ${tree.name}`, tree);
      },
    },
    rename_path: {
      description: "重命名工作区文件或目录",
      execute: async (input) => {
        const path = String(input.path ?? "");
        const nextName = String(input.nextName ?? "");
        const nextPath = await renameWorkspaceEntry(rootPath, path, nextName);
        await onWorkspaceMutated?.();
        return ok(`已重命名为 ${nextPath}`);
      },
    },
    search_workspace_content: {
      description: "搜索文件夹名、文件名和文件正文，并返回命中路径与行信息",
      execute: async (input) => {
        const query = String(input.query ?? "");
        const limit =
          typeof input.limit === "number" && Number.isFinite(input.limit)
            ? Math.trunc(input.limit)
            : undefined;
        const matches = await searchWorkspaceContent(rootPath, query, limit);
        return ok(formatSearchSummary(query, matches), matches);
      },
    },
    write_file: {
      description: "将内容写回文本文件",
      execute: async (input) => {
        const path = String(input.path ?? "");
        const contents = String(input.contents ?? "");
        await writeWorkspaceTextFile(rootPath, path, contents);
        await onWorkspaceMutated?.();
        return ok(`已写入 ${path}`);
      },
    },
  };
}
