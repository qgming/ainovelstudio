import {
  readWorkspaceTextFile,
  writeWorkspaceTextFile,
} from "../../bookWorkspace/api";
import type { AgentTool } from "../runtime";
import {
  appendJsonValueAtPointer,
  cloneJsonValue,
  deleteJsonValueAtPointer,
  getJsonValueAtPointer,
  mergeJsonValueAtPointer,
  normalizeJsonAction,
  parseJsonDocument,
  parseJsonPointer,
  serializeJsonWithStyle,
  setJsonValueAtPointer,
} from "./json";
import {
  applyTextEdit,
  normalizeEditAction,
  normalizeReadMode,
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
        const pointer = String(input.pointer ?? "");
        const segments = parseJsonPointer(pointer);
        const currentContents = await readWorkspaceTextFile(
          rootPath,
          path,
          getAbortContext(context),
        );
        const currentJson = parseJsonDocument(currentContents, path);
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
