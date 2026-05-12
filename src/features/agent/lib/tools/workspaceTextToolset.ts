import {
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
} from "@features/books/api/bookWorkspaceApi";
import type { AgentTool } from "../runtime";
import {
  applyJsonPatch,
  appendJsonValueAtPointer,
  appendJsonTextAtPointer,
  appendJsonHistoryAtPointer,
  buildJsonOverview,
  cloneJsonValue,
  compactJsonForTool,
  deleteJsonValueAtPointer,
  ensureJsonTemplateAtPointer,
  getJsonValueAtPointer,
  mergeJsonValueAtPointer,
  normalizeJsonAction,
  parseJsonDocument,
  parseJsonPointer,
  searchJson,
  serializeJsonWithStyle,
  setJsonValueAtPointer,
} from "./json";
import {
  applyJsonOperations,
  normalizeJsonBatchOperation,
} from "./jsonBatch";
import {
  readRangeAroundAnchor,
  readRangeByHeading,
  resolveAnchorWindow,
  resolveHeadingWindow,
} from "./workspaceReadHelpers";
import {
  applyTextEdit,
  normalizeEditAction,
  normalizeReadMode,
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

function getJsonMaxChars(value: unknown) {
  return Math.min(asPositiveInt(value, 4000), 20000);
}

function normalizeWriteAction(value: unknown) {
  return value === "replace" ? "replace" : "append";
}

function isMissingWorkspaceTextFileError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:目标路径|文件).*(?:不存在|未找到)|not found/i.test(message);
}

function compactJsonOperationValues<T extends { value?: unknown }>(items: T[], maxChars: number): T[] {
  return items.map((item) =>
    "value" in item && item.value !== undefined
      ? { ...item, value: compactJsonForTool(item.value, maxChars) }
      : item
  );
}

export function createWorkspaceTextTools({
  onWorkspaceMutated,
  rootPath,
}: WorkspaceToolContext): Record<string, AgentTool> {
  return {
    create: {
      description: "创建空白文本文件",
      execute: async (input, context) => {
        const path = normalizeToolPath(ensureString(input.path, "create.path"));
        if (!path || path === ".") {
          throw new Error("create.path 必须是文件相对路径。");
        }
        const existingContent = await readWorkspaceTextFile(
          rootPath,
          path,
          getAbortContext(context),
        ).catch((error: unknown) => {
          if (isMissingWorkspaceTextFileError(error)) return null;
          throw error;
        });
        if (existingContent !== null) {
          throw new Error(`create 目标文件已存在：${path}。如需写入内容请使用 write 或 edit。`);
        }
        await writeWorkspaceTextFile(
          rootPath,
          path,
          "",
          getAbortContext(context),
        );
        await onWorkspaceMutated?.();
        return ok(`已创建空白文件 ${path}`);
      },
    },
    read: {
      description: "读取文本文件",
      execute: async (input, context) => {
        const path = ensureString(input.path, "read.path");
        const mode = normalizeReadMode(input.mode);
        const content = await readWorkspaceTextFile(
          rootPath,
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
              anchor: ensureString(input.anchor, "read.anchor"),
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
              heading: ensureString(input.heading, "read.heading"),
              occurrence: asPositiveInt(input.occurrence, 1),
              path,
            }),
          );
        }

        const startLine = asPositiveInt(input.startLine, 1);
        const endLine = asPositiveInt(input.endLine, startLine);
        if (endLine < startLine) {
          throw new Error("read.range 的 endLine 不能小于 startLine。");
        }
        const startIndex = startLine - 1;
        const endIndex = Math.min(endLine, lines.length);
        return ok(
          renderLineWindow(path, startLine, lines.slice(startIndex, endIndex)),
        );
      },
    },
    edit: {
      description: "对文本文件做局部编辑",
      execute: async (input, context) => {
        const action = normalizeEditAction(input.action);
        const path = ensureString(input.path, "edit.path");
        const content = String(input.content ?? "");
        const target = input.target == null ? undefined : String(input.target);
        const expectedCount = asPositiveInt(input.expectedCount, 1);
        const replaceAll = Boolean(input.replaceAll);
        const currentContent = await readWorkspaceTextFile(
          rootPath,
          path,
          getAbortContext(context),
        );
        if (action === "replace_lines") {
          const startLine = asPositiveInt(input.startLine, 1);
          const endLine = asPositiveInt(input.endLine, startLine);
          const result = replaceTextByLineRange(
            currentContent,
            content,
            startLine,
            endLine,
          );
          await writeWorkspaceTextFile(
            rootPath,
            path,
            result.nextContent,
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(
            `已更新 ${path}（replace_lines，行 ${result.startLine}-${result.endLine}）。`,
          );
        }
        if (action === "replace_anchor_range") {
          const lines = splitTextLines(currentContent);
          const { startIndex, endIndex } = resolveAnchorWindow({
            afterLines: asNonNegativeInt(input.afterLines, 20),
            anchor: ensureString(input.anchor, "edit.anchor"),
            beforeLines: asNonNegativeInt(input.beforeLines, 20),
            caseSensitive: Boolean(input.caseSensitive),
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
            rootPath,
            path,
            result.nextContent,
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(
            `已更新 ${path}（replace_anchor_range，行 ${result.startLine}-${result.endLine}）。`,
          );
        }
        if (action === "replace_heading_range") {
          const lines = splitTextLines(currentContent);
          const { startIndex, endIndex } = resolveHeadingWindow({
            heading: ensureString(input.heading, "edit.heading"),
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
            rootPath,
            path,
            result.nextContent,
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(
            `已更新 ${path}（replace_heading_range，行 ${result.startLine}-${result.endLine}）。`,
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
          rootPath,
          path,
          result.nextContent,
          getAbortContext(context),
        );
        await onWorkspaceMutated?.();
        return ok(`已更新 ${path}（${action}，命中 ${result.matchCount} 处）。`);
      },
    },
    write: {
      description: "向已有文本文件写入内容",
      execute: async (input, context) => {
        const path = ensureString(input.path, "write.path");
        const action = normalizeWriteAction(input.action);
        const content = String(input.content ?? "");
        const currentContent = await readWorkspaceTextFile(
          rootPath,
          path,
          getAbortContext(context),
        );
        const nextContent = action === "replace"
          ? content
          : `${currentContent}${content}`;
        await writeWorkspaceTextFile(
          rootPath,
          path,
          nextContent,
          getAbortContext(context),
        );
        await onWorkspaceMutated?.();
        return ok(action === "replace" ? `已覆盖写入 ${path}` : `已追加写入 ${path}`);
      },
    },
    json: {
      description: "读取或局部更新 JSON 文件",
      execute: async (input, context) => {
        const action = normalizeJsonAction(input.action);
        const path = ensureString(input.path, "json.path");
        const maxChars = getJsonMaxChars(input.maxChars);
        if (action === "create") {
          if (!input.overwrite) {
            try {
              await readWorkspaceTextFile(rootPath, path, getAbortContext(context));
              throw new Error(
                `json.create 目标文件已存在：${path}。如需覆盖请传 overwrite=true。`,
              );
            } catch (error) {
              if (error instanceof Error && error.message.includes("overwrite=true")) {
                throw error;
              }
            }
          }
          const nextJson = input.value === undefined ? {} : cloneJsonValue(input.value);
          await writeWorkspaceTextFile(
            rootPath,
            path,
            `${JSON.stringify(nextJson, null, 2)}\n`,
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();
          return ok(`已创建 JSON 文件 ${path}。`, {
            action,
            path,
            value: compactJsonForTool(nextJson, maxChars),
          });
        }
        const currentContents = await readWorkspaceTextFile(
          rootPath,
          path,
          getAbortContext(context),
        );
        const currentJson = parseJsonDocument(currentContents, path);
        if (action === "batch") {
          if (!Array.isArray(input.operations) || input.operations.length === 0) {
            throw new Error("json.batch 需要提供非空 operations。");
          }

          const operations = input.operations.map(normalizeJsonBatchOperation);
          const { results, root: nextJson } = applyJsonOperations(
            cloneJsonValue(currentJson),
            operations,
          );
          await writeWorkspaceTextFile(
            rootPath,
            path,
            serializeJsonWithStyle(nextJson, currentContents),
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();

          return ok(`已批量更新 ${path} 中 ${results.length} 个 JSON 操作。`, {
            action,
            operations: compactJsonOperationValues(results, maxChars),
            operationsApplied: results.length,
            path,
          });
        }

        if (action === "patch") {
          if (!Array.isArray(input.patch) || input.patch.length === 0) {
            throw new Error("json.patch 需要提供非空 patch。");
          }

          const { operations, root: nextJson } = applyJsonPatch(
            cloneJsonValue(currentJson),
            input.patch as Parameters<typeof applyJsonPatch>[1],
          );
          await writeWorkspaceTextFile(
            rootPath,
            path,
            serializeJsonWithStyle(nextJson, currentContents),
            getAbortContext(context),
          );
          await onWorkspaceMutated?.();

          return ok(`已按 patch 更新 ${path} 中 ${operations.length} 个 JSON 操作。`, {
            action,
            operations: compactJsonOperationValues(operations, maxChars),
            operationsApplied: operations.length,
            path,
          });
        }

        const pointer = String(input.pointer ?? "");
        const segments = parseJsonPointer(pointer);
        if (action === "get") {
          return ok(`已读取 ${path} 中 ${pointer || "/"} 的 JSON 数据。`, {
            action,
            path,
            pointer: pointer || "/",
            value: compactJsonForTool(
              getJsonValueAtPointer(currentJson, segments),
              maxChars,
            ),
          });
        }
        if (action === "overview") {
          const target = getJsonValueAtPointer(currentJson, segments);
          return ok(`已读取 ${path} 中 ${pointer || "/"} 的 JSON 结构概览。`, {
            action,
            path,
            pointer: pointer || "/",
            ...buildJsonOverview(target, {
              maxDepth: asNonNegativeInt(input.maxDepth, 2),
              maxEntries: asPositiveInt(input.maxEntries, 80),
              pointer: pointer || "/",
            }),
          });
        }
        if (action === "search") {
          const target = getJsonValueAtPointer(currentJson, segments);
          const query = ensureString(input.query, "json.query");
          return ok(`已在 ${path} 中搜索 JSON：${query}`, {
            action,
            path,
            pointer: pointer || "/",
            ...searchJson(target, {
              caseSensitive: Boolean(input.caseSensitive),
              limit: asPositiveInt(input.limit, 30),
              pointer: pointer || "/",
              query,
              searchIn:
                input.searchIn === "key" || input.searchIn === "value"
                  ? input.searchIn
                  : "all",
            }),
          });
        }

        if (input.value === undefined && action !== "delete") {
          throw new Error(`json.${action} 需要提供 value。`);
        }

        let nextJson = cloneJsonValue(currentJson);
        if (action === "set") {
          nextJson = setJsonValueAtPointer(nextJson, segments, input.value);
        } else if (action === "ensure_template") {
          nextJson = ensureJsonTemplateAtPointer(nextJson, segments, input.value);
        } else if (action === "history_append") {
          nextJson = appendJsonHistoryAtPointer(nextJson, segments, input.value, {
            limit:
              typeof input.limit === "number" ? input.limit : undefined,
            timestamp:
              typeof input.timestamp === "string" ? input.timestamp : undefined,
            timestampField:
              typeof input.timestampField === "string"
                ? input.timestampField
                : undefined,
          });
        } else if (action === "merge") {
          nextJson = mergeJsonValueAtPointer(nextJson, segments, input.value);
        } else if (action === "append") {
          nextJson = appendJsonValueAtPointer(nextJson, segments, input.value);
        } else if (action === "text_append") {
          nextJson = appendJsonTextAtPointer(nextJson, segments, input.value, {
            separator:
              typeof input.separator === "string" ? input.separator : undefined,
          });
        } else {
          nextJson = deleteJsonValueAtPointer(nextJson, segments);
        }

        await writeWorkspaceTextFile(
          rootPath,
          path,
          serializeJsonWithStyle(nextJson, currentContents),
          getAbortContext(context),
        );
        await onWorkspaceMutated?.();

        if (action === "delete") {
          return ok(`已删除 ${path} 中 ${pointer || "/"} 的 JSON 节点。`, {
            action,
            deleted: true,
            path,
            pointer: pointer || "/",
          });
        }

        if (action === "history_append") {
          const target = getJsonValueAtPointer(nextJson, segments);
          return ok(`已向 ${path} 中 ${pointer || "/"} 追加一条历史记录。`, {
            action,
            path,
            pointer: pointer || "/",
            value: compactJsonForTool(
              Array.isArray(target) ? target[target.length - 1] : target,
              maxChars,
            ),
          });
        }

        if (action === "ensure_template") {
          return ok(`已按模板补齐 ${path} 中 ${pointer || "/"} 的 JSON 数据。`, {
            action,
            path,
            pointer: pointer || "/",
            value: compactJsonForTool(
              getJsonValueAtPointer(nextJson, segments),
              maxChars,
            ),
          });
        }

        return ok(`已更新 ${path} 中 ${pointer || "/"} 的 JSON 数据。`, {
          action,
          path,
          pointer: pointer || "/",
          value: compactJsonForTool(
            getJsonValueAtPointer(nextJson, segments),
            maxChars,
          ),
        });
      },
    },
  };
}
