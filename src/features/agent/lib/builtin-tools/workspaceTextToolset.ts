import {
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
} from "@features/books/api/bookWorkspaceApi";
import type { AgentTool } from "../session/runtime";
import {
  readRangeAroundAnchor,
  readRangeByHeading,
  resolveHeadingWindow,
} from "./workspaceReadHelpers";
import {
  applyTextEdit,
  normalizeEditAction,
  normalizeReadMode,
  replaceBetween,
  replaceTextByLineRange,
  renderLineWindow,
  splitTextLines,
} from "./workspaceHelpers";
import {
  asPositiveInt,
  ensureString,
  getAbortContext,
  normalizeToolPath,
  ok,
  type WorkspaceToolContext,
} from "./shared";

function asNonNegativeInt(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? Math.trunc(value)
      : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeWriteAction(value: unknown) {
  if (value === "create" || value === "replace") {
    return value;
  }
  return "append";
}

function isMissingWorkspaceTextFileError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:目标路径|文件).*(?:不存在|未找到)|not found|只能读取文件内容/i.test(message);
}

export function createWorkspaceTextTools({
  onWorkspaceMutated,
  bookId,
}: WorkspaceToolContext): Record<string, AgentTool> {
  return {
    workspace_write: {
      description: "向工作区文本文件写入内容或创建空白文件",
      execute: async (input, context) => {
        const path = normalizeToolPath(ensureString(input.path, "workspace_write.path"));
        if (!path || path === ".") {
          throw new Error("workspace_write.path 必须是文件相对路径。");
        }
        const action = normalizeWriteAction(input.action);
        const abortContext = getAbortContext(context);
        if (action === "create") {
          const existingContent = await readWorkspaceTextFile(
            bookId,
            path,
            abortContext,
          ).catch((error: unknown) => {
            if (isMissingWorkspaceTextFileError(error)) return null;
            throw error;
          });
          if (existingContent !== null) {
            throw new Error(`workspace_write 目标文件已存在：${path}。`);
          }
          await writeWorkspaceTextFile(bookId, path, "", abortContext);
          await onWorkspaceMutated?.();
          return ok(`已创建空白文件 ${path}`);
        }

        // append 和 replace：如果文件不存在则自动创建
        const currentContent = await readWorkspaceTextFile(
          bookId,
          path,
          abortContext,
        ).catch((error: unknown) => {
          if (isMissingWorkspaceTextFileError(error)) return "";
          throw error;
        });
        const content = String(input.content ?? "");
        const nextContent = action === "replace"
          ? content
          : `${currentContent}${content}`;
        await writeWorkspaceTextFile(
          bookId,
          path,
          nextContent,
          abortContext,
        );
        await onWorkspaceMutated?.();

        // 如果是从空内容写入，说明是新创建的文件
        const isNewFile = currentContent === "";
        if (action === "replace") {
          return ok(isNewFile ? `已创建并写入 ${path}` : `已覆盖写入 ${path}`);
        } else {
          return ok(isNewFile ? `已创建并写入 ${path}` : `已追加写入 ${path}`);
        }
      },
    },
    workspace_read: {
      description: "读取文本文件",
      execute: async (input, context) => {
        const path = ensureString(input.path, "workspace_read.path");
        const mode = normalizeReadMode(input.mode);
        const content = await readWorkspaceTextFile(
          bookId,
          path,
          getAbortContext(context),
        );
        if (mode === "full") {
          return ok(content);
        }

        const lines = splitTextLines(content);
        if (mode === "head") {
          const limit = Math.min(asPositiveInt(input.limit, 80), lines.length);
          return ok(renderLineWindow(path, 1, lines.slice(0, limit)));
        }

        if (mode === "tail") {
          const limit = Math.min(asPositiveInt(input.limit, 80), lines.length);
          const startLine = Math.max(lines.length - limit + 1, 1);
          return ok(renderLineWindow(path, startLine, lines.slice(-limit)));
        }

        if (mode === "anchor_range") {
          return ok(
            readRangeAroundAnchor({
              afterLines: asNonNegativeInt(input.afterLines, 20),
              anchor: ensureString(input.anchor, "workspace_read.anchor"),
              beforeLines: asNonNegativeInt(input.beforeLines, 20),
              caseSensitive: Boolean(input.caseSensitive),
              contents: content,
              occurrence: asPositiveInt(input.occurrence, 1),
              path,
            }),
          );
        }

        if (mode === "heading_range") {
          return ok(
            readRangeByHeading({
              contents: content,
              heading: ensureString(input.heading, "workspace_read.heading"),
              occurrence: asPositiveInt(input.occurrence, 1),
              path,
            }),
          );
        }

        if (mode === "between") {
          const before = ensureString(input.before, "workspace_read.before");
          const after = ensureString(input.after, "workspace_read.after");
          const includeAnchors = Boolean(input.includeAnchors);
          const occurrence = asPositiveInt(input.occurrence, 1);

          // 使用 replaceBetween 的逻辑来定位，但只提取内容不替换
          const result = replaceBetween(
            content,
            before,
            after,
            "", // 不需要替换内容
            includeAnchors,
            occurrence,
          );

          // 提取两个锚点之间的内容
          let startPos = includeAnchors ? result.beforeIndex : result.beforeIndex + before.length;
          let endPos = includeAnchors ? result.afterIndex + after.length : result.afterIndex;
          const extractedContent = content.substring(startPos, endPos);

          return ok(extractedContent);
        }

        const startLine = asPositiveInt(input.startLine, 1);
        const endLine = asPositiveInt(input.endLine, startLine);
        if (endLine < startLine) {
          throw new Error("workspace_read.range 的 endLine 不能小于 startLine。");
        }
        const startIndex = startLine - 1;
        const endIndex = Math.min(endLine, lines.length);
        return ok(
          renderLineWindow(path, startLine, lines.slice(startIndex, endIndex)),
        );
      },
    },
    workspace_edit: {
      description: "对文本文件做局部编辑",
      execute: async (input, context) => {
        const action = normalizeEditAction(input.action);
        const path = ensureString(input.path, "workspace_edit.path");
        const content = String(input.content ?? "");
        const target = input.target == null ? undefined : String(input.target);
        const expectedCount = asPositiveInt(input.expectedCount, 1);
        const replaceAll = Boolean(input.replaceAll);
        const currentContent = await readWorkspaceTextFile(
          bookId,
          path,
          getAbortContext(context),
        );
        if (action === "replace_heading_range") {
          const lines = splitTextLines(currentContent);
          const { startIndex, endIndex } = resolveHeadingWindow({
            heading: ensureString(input.heading, "workspace_edit.heading"),
            lines,
            occurrence: asPositiveInt(input.occurrence, 1),
          });
          const result = replaceTextByLineRange(
            currentContent,
            content,
            startIndex + 1,
            endIndex,
          );
          await writeWorkspaceTextFile(
            bookId,
            path,
            result.nextContent,
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(
            `已更新 ${path}（replace_heading_range，行 ${result.startLine}-${result.endLine}）。`,
          );
        }
        if (action === "replace_between") {
          const before = ensureString(input.before, "workspace_edit.before");
          const after = ensureString(input.after, "workspace_edit.after");
          const includeAnchors = Boolean(input.includeAnchors);
          const occurrence = asPositiveInt(input.occurrence, 1);
          const result = replaceBetween(
            currentContent,
            before,
            after,
            content,
            includeAnchors,
            occurrence,
          );
          await writeWorkspaceTextFile(
            bookId,
            path,
            result.nextContent,
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(
            `已更新 ${path}（replace_between，在"${before}"与"${after}"之间${includeAnchors ? "（含锚点）" : ""}）。`,
          );
        }
        const result = applyTextEdit(
          currentContent,
          action,
          target,
          content,
          expectedCount,
          replaceAll,
        );
        await writeWorkspaceTextFile(
          bookId,
          path,
          result.nextContent,
          getAbortContext(context),
        );
        await onWorkspaceMutated?.();
        return ok(`已更新 ${path}（${action}，命中 ${result.matchCount} 处）。`);
      },
    },
  };
}
