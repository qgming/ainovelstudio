import { z } from "zod";
import { defineTool } from "../modelGateway";
import type { ToolBuilder, ToolRunner } from "./types";

export function createDataToolBuilders(runTool: ToolRunner): Record<string, ToolBuilder> {
  return {
    json: (toolName, tool) =>
      defineTool({
        description:
          "读取、搜索、创建或局部更新 JSON。大 JSON 先 overview/search，再 get 精确 pointer；多步变更优先 batch 或 patch，一次写回。",
        inputSchema: z.object({
          action: z
            .enum([
              "append",
              "batch",
              "create",
              "delete",
              "ensure_template",
              "get",
              "history_append",
              "merge",
              "overview",
              "patch",
              "search",
              "set",
              "text_append",
            ])
            .default("get"),
          patch: z
            .array(
              z.object({
                from: z
                  .string()
                  .optional()
                  .describe("copy / move 时来源 JSON Pointer。"),
                op: z
                  .enum(["add", "copy", "move", "remove", "replace", "test"])
                  .describe("RFC 6902 风格的 patch 动作。"),
                path: z.string().describe("patch 目标 JSON Pointer。"),
                value: z
                  .unknown()
                  .optional()
                  .describe("add / replace / test 时使用的值。"),
              }),
            )
            .optional()
            .describe("仅在 action=patch 时使用。按顺序执行的 JSON Patch 操作。"),
          operations: z
            .array(
              z.object({
                action: z
                  .enum([
                    "append",
                    "delete",
                    "ensure_template",
                    "history_append",
                    "merge",
                    "set",
                    "text_append",
                  ])
                  .describe("batch 中的单步动作。"),
                limit: z
                  .number()
                  .int()
                  .positive()
                  .optional()
                  .describe("batch 中 history_append 的历史数组保留上限。"),
                pointer: z
                  .string()
                  .optional()
                  .describe("batch 中该步操作的 JSON Pointer。空字符串表示根节点。"),
                separator: z
                  .string()
                  .optional()
                  .describe("仅在 batch 的 text_append 时使用。追加文本前插入的分隔符。"),
                timestamp: z
                  .string()
                  .optional()
                  .describe("batch 中 history_append 的写入时间。"),
                timestampField: z
                  .string()
                  .optional()
                  .describe("batch 中 history_append 的时间字段名，默认 updatedAt。"),
                value: z
                  .unknown()
                  .optional()
                  .describe("append / merge / set 时要写入的新值。"),
              }),
            )
            .optional()
            .describe("仅在 action=batch 时使用。按顺序依次执行的操作列表。"),
          caseSensitive: z
            .boolean()
            .optional()
            .describe("仅在 action=search 时使用。是否区分大小写。"),
          limit: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("history_append 的历史数组最大保留条数；search 的最大匹配数。"),
          maxChars: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("读取或写入后返回 value 的最大字符数，默认 4000，超出会返回 preview。"),
          maxDepth: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .describe("仅在 action=overview 时使用。结构概览递归深度，默认 2。"),
          maxEntries: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 action=overview 时使用。最多返回多少个结构节点，默认 80。"),
          overwrite: z
            .boolean()
            .optional()
            .describe("仅在 action=create 时使用。目标文件存在时是否覆盖，默认 false。"),
          path: z.string().describe("目标 JSON 文件的相对工作区路径。"),
          pointer: z
            .string()
            .optional()
            .describe("JSON Pointer。空字符串表示根节点，例如 /stage、/chapters/0/title。"),
          query: z
            .string()
            .optional()
            .describe("仅在 action=search 时使用。要搜索的 key 或 value 文本。"),
          searchIn: z
            .enum(["all", "key", "value"])
            .optional()
            .describe("仅在 action=search 时使用。搜索 key、value 或两者。"),
          separator: z
            .string()
            .optional()
            .describe("仅在 action=text_append 时使用。追加文本前插入的分隔符。"),
          timestamp: z
            .string()
            .optional()
            .describe("仅在 action=history_append 时使用。手动指定写入时间。"),
          timestampField: z
            .string()
            .optional()
            .describe("仅在 action=history_append 时使用。记录时间字段名，默认 updatedAt。"),
          value: z
            .unknown()
            .optional()
            .describe("set / merge / append / text_append / ensure_template / history_append 时需要的新值。"),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    path: (toolName, tool) =>
      defineTool({
        description:
          "处理工作区中的结构性变更，如创建文件、创建文件夹、重命名、迁移和删除。",
        inputSchema: z.object({
          action: z
            .enum(["create_file", "create_folder", "delete", "move", "rename"])
            .describe("要执行的路径动作。"),
          name: z
            .string()
            .optional()
            .describe("create_file / create_folder / rename 时需要的名称。"),
          parentPath: z
            .string()
            .optional()
            .describe("create_file / create_folder 时使用的父目录路径。"),
          path: z
            .string()
            .optional()
            .describe("rename / move / delete 时的目标路径。"),
          targetParentPath: z
            .string()
            .optional()
            .describe("move 时的目标父目录路径。"),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.summary;
        },
      }),
    skill: (toolName, tool) =>
      defineTool({
        description:
          "读取或管理本地 skill。先 list，再 read / write 具体文件。",
        inputSchema: z.object({
          action: z
            .enum([
              "create",
              "create_reference",
              "delete",
              "list",
              "read",
              "write",
            ])
            .default("list"),
          content: z
            .string()
            .optional()
            .describe("write 时要写入 skill 文件的新内容。"),
          description: z
            .string()
            .optional()
            .describe("create 时的新 skill 简介。"),
          name: z
            .string()
            .optional()
            .describe(
              "create 时的新 skill 名称；create_reference 时的新参考文件名称。",
            ),
          relativePath: z
            .string()
            .optional()
            .describe(
              "read / write 时 skill 内的相对路径，如 SKILL.md 或 references/voice.md。",
            ),
          skillId: z
            .string()
            .optional()
            .describe("list 之外的动作通常都需要 skillId。"),
        }),
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
  };
}
