import { invoke } from "@tauri-apps/api/core";
import type {
  BookWorkspaceSummary,
  TreeNode,
  WorkspaceGrepResult,
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
    if (typeof parsed.bookId !== "string") {
      return null;
    }

    return {
      bookId: parsed.bookId,
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

export function setStoredWorkspaceSnapshot(bookId: string, selectedFilePath: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    WORKSPACE_STORAGE_KEY,
    JSON.stringify({ bookId, selectedFilePath }),
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

export function openBookFolder(bookId: string) {
  return invoke<void>("open_book_folder", { bookId });
}

export function listBookWorkspaces() {
  return invoke<BookWorkspaceSummary[]>("list_book_workspaces").then((summaries) => {
    cacheBookWorkspaceSummaries(summaries);
    return summaries;
  });
}

export function getBookWorkspaceSummary(bookId: string) {
  return invoke<BookWorkspaceSummary>("get_book_workspace_summary", { bookId }).then((summary) => {
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

export function exportBookZip(bookId: string) {
  return invoke<string | null>("export_book_zip", { bookId });
}

export function deleteBookWorkspace(bookId: string) {
  return invoke<void>("delete_book_workspace", { bookId });
}

export function ensureBookWorkspaceTemplate(bookId: string) {
  return invoke<string[]>("ensure_book_workspace_template", { bookId });
}

export function readWorkspaceTree(bookId: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<TreeNode>("read_workspace_tree", { bookId }, options);
}

export function readWorkspaceTextFile(bookId: string, path: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("read_text_file", { bookId, path }, options);
}

export function writeWorkspaceTextFile(bookId: string, path: string, contents: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<void>("write_text_file", { bookId, path, contents }, options);
}

// 字符串替换编辑：把文件中唯一出现的 oldString 替换为 newString。
// oldString 为空时表示创建新文件（要求文件不存在）。
export function editWorkspaceTextFile(
  bookId: string,
  path: string,
  oldString: string,
  newString: string,
  options?: InvokeCancellationOptions,
) {
  return invokeWithCancellation<void>(
    "edit_text_file",
    { bookId, path, oldString, newString },
    options,
  );
}

export type SearchWorkspaceContentOptions = InvokeCancellationOptions & {
  includeAdjacent?: boolean;
  intent?: WorkspaceSearchIntent | string;
  limit?: number;
  scope?: string[];
  tokenBudget?: number;
};

export function searchWorkspaceContent(
  bookId: string,
  query: string,
  options?: SearchWorkspaceContentOptions,
) {
  return invokeWithCancellation<WorkspaceSearchResult>("search_workspace_content", {
    includeAdjacent: options?.includeAdjacent,
    intent: options?.intent,
    limit: options?.limit,
    query,
    bookId,
    scope: options?.scope,
    tokenBudget: options?.tokenBudget,
  }, options);
}

export type GrepWorkspaceContentOptions = InvokeCancellationOptions & {
  isRegex?: boolean;
  caseSensitive?: boolean;
  scope?: string[];
  limit?: number;
  contextLines?: number;
};

export function grepWorkspaceContent(
  bookId: string,
  pattern: string,
  options?: GrepWorkspaceContentOptions,
) {
  return invokeWithCancellation<WorkspaceGrepResult>("grep_workspace_content", {
    bookId,
    pattern,
    isRegex: options?.isRegex,
    caseSensitive: options?.caseSensitive,
    scope: options?.scope,
    limit: options?.limit,
    contextLines: options?.contextLines,
  }, options);
}

export function readWorkspaceTextLine(bookId: string, path: string, lineNumber: number, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<WorkspaceLineResult>("read_text_file_line", { lineNumber, path, bookId }, options);
}

export function replaceWorkspaceTextLine(
  bookId: string,
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
    bookId,
  }, options);
}

export function createBookWorkspace(parentPath: string, bookName: string) {
  return invoke<BookWorkspaceSummary>("create_book_workspace", { parentPath, bookName }).then((summary) => {
    cacheBookWorkspaceSummary(summary);
    return summary;
  });
}

export function createWorkspaceDirectory(bookId: string, parentPath: string, name: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("create_workspace_directory", { bookId, parentPath, name }, options);
}

export function createWorkspaceTextFile(bookId: string, parentPath: string, name: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("create_workspace_text_file", { bookId, parentPath, name }, options);
}

export function renameWorkspaceEntry(bookId: string, path: string, nextName: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("rename_workspace_entry", { bookId, path, nextName }, options);
}

export function moveWorkspaceEntry(bookId: string, path: string, targetParentPath: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("move_workspace_entry", { bookId, path, targetParentPath }, options);
}

export function deleteWorkspaceEntry(bookId: string, path: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<void>("delete_workspace_entry", { bookId, path }, options);
}

// —— 文件关联(无向多对多)相关 API ——

export function listEntryRelations(bookId: string, entryPath: string) {
  return invoke<WorkspaceRelation[]>("list_entry_relations", { bookId, entryPath });
}

export function listBookRelations(bookId: string) {
  return invoke<WorkspaceRelation[]>("list_book_relations", { bookId });
}

export function createEntryRelation(
  bookId: string,
  entryAPath: string,
  entryBPath: string,
  relationship: string,
  note?: string | null,
) {
  return invoke<WorkspaceRelation>("create_entry_relation", {
    bookId,
    entryAPath,
    entryBPath,
    relationship,
    note: note ?? null,
  });
}

// note 的三态语义:undefined=不修改;null=清空;字符串=改为指定值。
// 通过 clearNote=true 表达"清空",避免 Option<Option<String>> 在 serde 上的歧义。
export function updateEntryRelation(
  bookId: string,
  relationId: string,
  changes: { note?: string | null; relationship?: string },
) {
  const payload: Record<string, unknown> = { bookId, relationId };
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

export function deleteEntryRelation(bookId: string, relationId: string) {
  return invoke<void>("delete_entry_relation", { bookId, relationId });
}

// —— per-book 会话存储（.sessions/）：供 pi AgentHarness 的 JsonlSessionRepo 落盘 ——
// path 均相对 .sessions/，后端做 .. 越界校验并锁在该目录内。

export type SessionFsEntry = {
  name: string;
  isDir: boolean;
};

export function sessionFsExists(bookId: string, path: string) {
  return invoke<boolean>("session_fs_exists", { bookId, path });
}

export function sessionFsRead(bookId: string, path: string) {
  return invoke<string>("session_fs_read", { bookId, path });
}

export function sessionFsWrite(bookId: string, path: string, contents: string) {
  return invoke<void>("session_fs_write", { bookId, path, contents });
}

export function sessionFsAppend(bookId: string, path: string, contents: string) {
  return invoke<void>("session_fs_append", { bookId, path, contents });
}

export function sessionFsCreateDir(bookId: string, path: string) {
  return invoke<void>("session_fs_create_dir", { bookId, path });
}

export function sessionFsRemove(bookId: string, path: string) {
  return invoke<void>("session_fs_remove", { bookId, path });
}

export function sessionFsListDir(bookId: string, path: string) {
  return invoke<SessionFsEntry[]>("session_fs_list_dir", { bookId, path });
}
