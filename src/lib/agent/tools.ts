import {
  createWorkspaceDirectory,
  createWorkspaceTextFile,
  deleteWorkspaceEntry,
  readWorkspaceTextFile,
  readWorkspaceTree,
  renameWorkspaceEntry,
  writeWorkspaceTextFile,
} from "../bookWorkspace/api";
import type { AgentTool, ToolResult } from "./runtime";

type WorkspaceToolContext = {
  onWorkspaceMutated?: () => Promise<void>;
  rootPath: string;
};

function ok(summary: string, data?: unknown): ToolResult {
  return { ok: true, summary, data };
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
