import type { AgentToolExecutionContext, ToolResult } from "../runtime";

export type WorkspaceToolContext = {
  onWorkspaceMutated?: () => Promise<void>;
  rootPath: string;
};

export type LocalResourceToolContext = {
  refreshAgents?: () => Promise<void>;
  refreshSkills?: () => Promise<void>;
};

export function getAbortContext(context?: AgentToolExecutionContext) {
  if (!context?.abortSignal && !context?.requestId) {
    return undefined;
  }

  return {
    abortSignal: context.abortSignal,
    requestId: context.requestId,
  };
}

export function ok(summary: string, data?: unknown): ToolResult {
  return { ok: true, summary, data };
}

export function normalizeToolPath(value: string) {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
}

export function normalizeRelativePath(rootPath: string, path: string) {
  const normalizedPath = normalizeToolPath(path);
  const normalizedRootPath = normalizeToolPath(rootPath);
  if (
    !normalizedPath ||
    normalizedPath === "." ||
    normalizedPath === normalizedRootPath
  ) {
    return "";
  }

  if (
    normalizedRootPath &&
    normalizedPath.startsWith(`${normalizedRootPath}/`)
  ) {
    return normalizedPath.slice(normalizedRootPath.length + 1);
  }

  return normalizedPath;
}

export function toDisplayPath(rootPath: string, path: string) {
  const relativePath = normalizeRelativePath(rootPath, path);
  return relativePath || ".";
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asPositiveInt(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function ensureString(value: unknown, fieldName: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`${fieldName} 不能为空。`);
  }
  return normalized;
}
