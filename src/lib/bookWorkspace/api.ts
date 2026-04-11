import { invoke } from "@tauri-apps/api/core";
import type {
  TreeNode,
  WorkspaceLineResult,
  WorkspaceSearchMatch,
  WorkspaceSnapshot,
} from "./types";

const WORKSPACE_STORAGE_KEY = "ainovelstudio-book-workspace";

function readSnapshot(): WorkspaceSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
    if (typeof parsed.rootPath !== "string") {
      return null;
    }

    return {
      rootPath: parsed.rootPath,
      selectedFilePath:
        typeof parsed.selectedFilePath === "string" ? parsed.selectedFilePath : null,
    };
  } catch {
    return null;
  }
}

export function getStoredWorkspaceSnapshot() {
  return readSnapshot();
}

export function setStoredWorkspaceSnapshot(rootPath: string, selectedFilePath: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    WORKSPACE_STORAGE_KEY,
    JSON.stringify({ rootPath, selectedFilePath }),
  );
}

export function clearStoredWorkspaceSnapshot() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

export function pickWorkspaceDirectory() {
  return invoke<string | null>("pick_book_directory");
}

export function readWorkspaceTree(rootPath: string) {
  return invoke<TreeNode>("read_workspace_tree", { rootPath });
}

export function readWorkspaceTextFile(rootPath: string, path: string) {
  return invoke<string>("read_text_file", { rootPath, path });
}

export function writeWorkspaceTextFile(rootPath: string, path: string, contents: string) {
  return invoke<void>("write_text_file", { rootPath, path, contents });
}

export function searchWorkspaceContent(rootPath: string, query: string, limit?: number) {
  return invoke<WorkspaceSearchMatch[]>("search_workspace_content", { limit, query, rootPath });
}

export function readWorkspaceTextLine(rootPath: string, path: string, lineNumber: number) {
  return invoke<WorkspaceLineResult>("read_text_file_line", { lineNumber, path, rootPath });
}

export function replaceWorkspaceTextLine(
  rootPath: string,
  path: string,
  lineNumber: number,
  contents: string,
  context?: {
    nextLine?: string;
    previousLine?: string;
  },
) {
  return invoke<WorkspaceLineResult>("replace_text_file_line", {
    contents,
    lineNumber,
    nextLine: context?.nextLine,
    path,
    previousLine: context?.previousLine,
    rootPath,
  });
}

export function createBookWorkspace(parentPath: string, bookName: string) {
  return invoke<string>("create_book_workspace", { parentPath, bookName });
}

export function createWorkspaceDirectory(rootPath: string, parentPath: string, name: string) {
  return invoke<string>("create_workspace_directory", { rootPath, parentPath, name });
}

export function createWorkspaceTextFile(rootPath: string, parentPath: string, name: string) {
  return invoke<string>("create_workspace_text_file", { rootPath, parentPath, name });
}

export function renameWorkspaceEntry(rootPath: string, path: string, nextName: string) {
  return invoke<string>("rename_workspace_entry", { rootPath, path, nextName });
}

export function deleteWorkspaceEntry(rootPath: string, path: string) {
  return invoke<void>("delete_workspace_entry", { rootPath, path });
}
