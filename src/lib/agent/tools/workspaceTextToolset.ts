import {
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
} from "../../bookWorkspace/api";
import type { AgentTool } from "../runtime";
import {
  applyJsonPatch,
  appendJsonValueAtPointer,
  appendJsonHistoryAtPointer,
  cloneJsonValue,
  deleteJsonValueAtPointer,
  ensureJsonTemplateAtPointer,
  getJsonValueAtPointer,
  mergeJsonValueAtPointer,
  normalizeJsonAction,
  parseJsonDocument,
  parseJsonPointer,
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

export function createWorkspaceTextTools({
  onWorkspaceMutated,
  rootPath,
}: WorkspaceToolContext): Record<string, AgentTool> {
  return {
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
      description: "整文件写入文本",
      execute: async (input, context) => {
        const path = ensureString(input.path, "write.path");
        const content = String(input.content ?? "");
        await writeWorkspaceTextFile(
          rootPath,
          path,
          content,
          getAbortContext(context),
        );
        await onWorkspaceMutated?.();
        return ok(`已写入 ${path}`);
      },
    },
    json: {
      description: "读取或局部更新 JSON 文件",
      execute: async (input, context) => {
        const action = normalizeJsonAction(input.action);
        const path = ensureString(input.path, "json.path");
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
            operations: results,
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
            operations,
            operationsApplied: operations.length,
            path,
          });
        }

        const pointer = String(input.pointer ?? "");
        const segments = parseJsonPointer(pointer);
        if (action === "get") {
          return ok(
            `已读取 ${path} 中 ${pointer || "/"} 的 JSON 数据。`,
            getJsonValueAtPointer(currentJson, segments),
          );
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
            value: Array.isArray(target) ? target[target.length - 1] : target,
          });
        }

        if (action === "ensure_template") {
          return ok(`已按模板补齐 ${path} 中 ${pointer || "/"} 的 JSON 数据。`, {
            action,
            path,
            pointer: pointer || "/",
            value: getJsonValueAtPointer(nextJson, segments),
          });
        }

        return ok(`已更新 ${path} 中 ${pointer || "/"} 的 JSON 数据。`, {
          action,
          path,
          pointer: pointer || "/",
          value: getJsonValueAtPointer(nextJson, segments),
        });
      },
    },
  };
}
