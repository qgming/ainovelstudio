import { invoke } from "@tauri-apps/api/core";
import type {
  TreeNode,
  WorkspaceLineResult,
  WorkspaceSearchMatch,
  WorkspaceSnapshot,
} from "./types";

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

export function readWorkspaceTree(rootPath: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<TreeNode>("read_workspace_tree", { rootPath }, options);
}

export function readWorkspaceTextFile(rootPath: string, path: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<string>("read_text_file", { rootPath, path }, options);
}

export function writeWorkspaceTextFile(rootPath: string, path: string, contents: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<void>("write_text_file", { rootPath, path, contents }, options);
}

export function searchWorkspaceContent(rootPath: string, query: string, limit?: number, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<WorkspaceSearchMatch[]>("search_workspace_content", { limit, query, rootPath }, options);
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
  return invoke<string>("create_book_workspace", { parentPath, bookName });
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

export function deleteWorkspaceEntry(rootPath: string, path: string, options?: InvokeCancellationOptions) {
  return invokeWithCancellation<void>("delete_workspace_entry", { rootPath, path }, options);
}
