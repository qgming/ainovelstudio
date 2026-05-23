import { invoke } from "@tauri-apps/api/core";
import type {
  BookWorkspaceSummary,
  TreeNode,
  WorkspaceLineResult,
  WorkspaceRelation,
  WorkspaceSearchIntent,
  WorkspaceSearchResult,
  WorkspaceSnapshot,
} from "../types";
import {
  cacheBookWorkspaceSummaries,
  cacheBookWorkspaceSummary,
} from "../lib/summaryCache";

export type InvokeCancellationOptions = {
  abortSignal?: AbortSignal;
  requestId?: string;
};

function createToolAbortError() {
  return new DOMException("Tool execution aborted.", "AbortError");
}

export async function cancelToolRequest(requestId: string) {
  await invoke<void>("cancel_tool_request", { requestId }).catch(() => undefined);
}

export async function cancelToolRequests(requestIds: string[]) {
  const uniqueRequestIds = Array.from(new Set(requestIds.filter((requestId) => requestId.trim())));
  if (uniqueRequestIds.length === 0) {
    return;
  }

  await invoke<void>("cancel_tool_requests", { requestIds: uniqueRequestIds }).catch(async () => {
    await Promise.allSettled(uniqueRequestIds.map((requestId) => cancelToolRequest(requestId)));
  });
}

export async function invokeWithCancellation<T>(
  command: string,
  payload: Record<string, unknown>,
  options?: InvokeCancellationOptions,
) {
  const requestId = options?.requestId;
  const abortSignal = options?.abortSignal;

  if (!requestId || !abortSignal) {
    return invoke<T>(command, payload);
  }

  if (abortSignal.aborted) {
    await cancelToolRequest(requestId);
    throw createToolAbortError();
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const handleAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      abortSignal.removeEventListener("abort", handleAbort);
      void cancelToolRequest(requestId);
      reject(createToolAbortError());
    };

    abortSignal.addEventListener("abort", handleAbort, { once: true });
    void invoke<T>(command, { ...payload, requestId })
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        abortSignal.removeEventListener("abort", handleAbort);
        resolve(value);
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        abortSignal.removeEventListener("abort", handleAbort);
        reject(error);
      });
  });
}

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

export function openBookFolder(rootPath: string) {
  return invoke<void>("open_book_folder", { rootPath });
}

export function syncBookFolderToWorkspace(rootPath: string) {
  return invoke<boolean>("sync_book_folder_to_workspace", { rootPath });
}

export function syncChangedBookFolderToWorkspace(rootPath: string) {
  return invoke<boolean>("sync_changed_book_folder_to_workspace", { rootPath });
}

export function listBookWorkspaces() {
  return invoke<BookWorkspaceSummary[]>("list_book_workspaces").then((summaries) => {
    cacheBookWorkspaceSummaries(summaries);
    return summaries;
  });
}

export function getBookWorkspaceSummary(rootPath: string) {
  return invoke<BookWorkspaceSummary>("get_book_workspace_summary", { rootPath }).then((summary) => {
    cacheBookWorkspaceSummary(summary);
    return summary;
  });
}

export function getBookWorkspaceSummaryById(bookId: string) {
  return invoke<BookWorkspaceSummary>("get_book_workspace_summary_by_id", { bookId }).then((summary) => {
    cacheBookWorkspaceSummary(summary);
    return summary;
  });
}

export function importBookZip(fileName: string, archiveBytes: number[]) {
  return invoke<BookWorkspaceSummary>("import_book_zip", { fileName, archiveBytes }).then((summary) => {
    cacheBookWorkspaceSummary(summary);
    return summary;
  });
}

export function exportBookZip(rootPath: string) {
  return invoke<string | null>("export_book_zip", { rootPath });
}

export function deleteBookWorkspace(rootPath: string) {
  return invoke<void>("delete_book_workspace", { rootPath });
}

export function ensureBookWorkspaceTemplate(rootPath: string) {
  return invoke<string[]>("ensure_book_workspace_template", { rootPath });
}

export function readWorkspaceTree(rootPath: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<TreeNode>("read_workspace_tree", { rootPath }, options);
}

export function readWorkspaceTextFile(rootPath: string, path: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("read_text_file", { rootPath, path }, options);
}

export function writeWorkspaceTextFile(rootPath: string, path: string, contents: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<void>("write_text_file", { rootPath, path, contents }, options);
}

export type SearchWorkspaceContentOptions = InvokeCancellationOptions & {
  includeAdjacent?: boolean;
  intent?: WorkspaceSearchIntent | string;
  limit?: number;
  scope?: string[];
  tokenBudget?: number;
};

export function searchWorkspaceContent(
  rootPath: string,
  query: string,
  options?: SearchWorkspaceContentOptions,
) {
  return invokeWithCancellation<WorkspaceSearchResult>("search_workspace_content", {
    includeAdjacent: options?.includeAdjacent,
    intent: options?.intent,
    limit: options?.limit,
    query,
    rootPath,
    scope: options?.scope,
    tokenBudget: options?.tokenBudget,
  }, options);
}

export function readWorkspaceTextLine(rootPath: string, path: string, lineNumber: number, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<WorkspaceLineResult>("read_text_file_line", { lineNumber, path, rootPath }, options);
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
  options?: InvokeCancellationOptions,
) {
  return invokeWithCancellation<WorkspaceLineResult>("replace_text_file_line", {
    contents,
    lineNumber,
    nextLine: context?.nextLine,
    path,
    previousLine: context?.previousLine,
    rootPath,
  }, options);
}

export function createBookWorkspace(parentPath: string, bookName: string) {
  return invoke<BookWorkspaceSummary>("create_book_workspace", { parentPath, bookName }).then((summary) => {
    cacheBookWorkspaceSummary(summary);
    return summary;
  });
}

export function createWorkspaceDirectory(rootPath: string, parentPath: string, name: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("create_workspace_directory", { rootPath, parentPath, name }, options);
}

export function createWorkspaceTextFile(rootPath: string, parentPath: string, name: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("create_workspace_text_file", { rootPath, parentPath, name }, options);
}

export function renameWorkspaceEntry(rootPath: string, path: string, nextName: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("rename_workspace_entry", { rootPath, path, nextName }, options);
}

export function moveWorkspaceEntry(rootPath: string, path: string, targetParentPath: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("move_workspace_entry", { rootPath, path, targetParentPath }, options);
}

export function deleteWorkspaceEntry(rootPath: string, path: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<void>("delete_workspace_entry", { rootPath, path }, options);
}

// —— 文件关联(无向多对多)相关 API ——

export function listEntryRelations(rootPath: string, entryPath: string) {
  return invoke<WorkspaceRelation[]>("list_entry_relations", { rootPath, entryPath });
}

export function listBookRelations(rootPath: string) {
  return invoke<WorkspaceRelation[]>("list_book_relations", { rootPath });
}

export function createEntryRelation(
  rootPath: string,
  entryAPath: string,
  entryBPath: string,
  relationship: string,
  note?: string | null,
) {
  return invoke<WorkspaceRelation>("create_entry_relation", {
    rootPath,
    entryAPath,
    entryBPath,
    relationship,
    note: note ?? null,
  });
}

// note 的三态语义:undefined=不修改;null=清空;字符串=改为指定值。
// 通过 clearNote=true 表达"清空",避免 Option<Option<String>> 在 serde 上的歧义。
export function updateEntryRelation(
  rootPath: string,
  relationId: string,
  changes: { note?: string | null; relationship?: string },
) {
  const payload: Record<string, unknown> = { rootPath, relationId };
  if (changes.relationship !== undefined) {
    payload.relationship = changes.relationship;
  }
  if (changes.note === null) {
    payload.clearNote = true;
  } else if (typeof changes.note === "string") {
    payload.note = changes.note;
  }
  return invoke<WorkspaceRelation>("update_entry_relation", payload);
}

export function deleteEntryRelation(rootPath: string, relationId: string) {
  return invoke<void>("delete_entry_relation", { rootPath, relationId });
}
