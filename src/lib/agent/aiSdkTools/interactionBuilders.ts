import { z } from "zod";
import { defineTool } from "../modelGateway";
import type { ToolBuilder, ToolRunner } from "./types";

export function createInteractionToolBuilders(runTool: ToolRunner): Record<string, ToolBuilder> {
  return {
    ask: (toolName, tool) =>
      defineTool({
        description:
          "当需求不明确或存在多个合理方向时，向用户发起单选或多选问题；工具会自动补上最后一项“用户输入”。",
        inputSchema: z.object({
          title: z.string().min(1).describe("问题标题。"),
          description: z.string().optional().describe("可选的问题说明。"),
          selectionMode: z
            .enum(["single", "multiple"])
            .default("single")
            .describe("single 为单选，multiple 为多选。"),
          options: z
            .array(
              z.object({
                id: z.string().min(1).describe("选项唯一标识。"),
                label: z.string().min(1).describe("选项显示名称。"),
                description: z.string().optional().describe("选项补充说明。"),
              }),
            )
            .min(1)
            .describe("预设选项列表，不要包含“用户输入”，系统会自动追加。"),
          customPlaceholder: z
            .string()
            .optional()
            .describe("选择“用户输入”后输入框的占位提示。"),
          minSelections: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("多选时最少需要选择多少项。"),
          maxSelections: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("多选时最多允许选择多少项。"),
          confirmLabel: z
            .string()
            .optional()
            .describe("确认按钮文案。"),
        }),
        execute: async (input, options) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
            { toolCallId: options?.toolCallId },
          );
          return result.data ?? result.summary;
        },
      }),
    todo: (toolName, tool) =>
      defineTool({
        description:
          "更新当前会话里的短计划，并保持同一时间最多一个 in_progress。可选 phase 字段标记长链路阶段（如 plot/bible/outline/chapter/write/review/polish）。",
        inputSchema: z.object({
          items: z
            .array(
              z.object({
                activeForm: z
                  .string()
                  .optional()
                  .describe("当步骤处于进行中时，更自然的进行时描述。"),
                content: z.string().min(1).describe("这一步要做什么。"),
                status: z
                  .enum(["pending", "in_progress", "completed"])
                  .default("pending"),
                phase: z
                  .string()
                  .optional()
                  .describe(
                    "可选：所属阶段标签。建议网文链路使用 plot / bible / outline / chapter / write / review / polish 等短词。",
                  ),
              }),
            )
            .describe("当前整份计划。允许整份重写。"),
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
    browse: (toolName, tool) =>
      defineTool({
        description:
          "浏览工作区结构。支持查看目录树、列出目录内容、检查路径概况，以及对 list 结果做筛选、排序和限量。",
        inputSchema: z.object({
          depth: z
            .number()
            .int()
            .positive()
            .max(8)
            .optional()
            .describe("仅在 mode=tree 时使用。限制返回的树深度，默认 2。"),
          extensions: z
            .array(z.string())
            .optional()
            .describe("仅在 mode=list 时使用。按文件扩展名过滤，如 ['md', '.json']。"),
          kind: z
            .enum(["all", "directory", "file"])
            .default("all")
            .describe("仅在 mode=list 时使用。筛选目录、文件或全部。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(200)
            .optional()
            .describe("仅在 mode=list 时使用。限制返回的子项数量。"),
          mode: z
            .enum(["list", "stat", "tree"])
            .default("list")
            .describe(
              "list 列出目录直接子项；stat 查看路径概况；tree 返回裁剪后的目录树。",
            ),
          path: z
            .string()
            .optional()
            .describe("要浏览的相对工作区路径；不传时默认为工作区根目录。"),
          sortBy: z
            .enum(["name", "type"])
            .default("name")
            .describe("仅在 mode=list 时使用。name 按名称排序，type 先目录后文件。"),
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
    search: (toolName, tool) =>
      defineTool({
        description:
          "搜索目录名、文件名和正文内容，支持大小写、整词、排序和上下文窗口，用于更精准地定位目标。",
        inputSchema: z.object({
          afterLines: z
            .number()
            .int()
            .nonnegative()
            .max(20)
            .optional()
            .describe("仅对正文命中生效。返回命中行之后的上下文行数。"),
          beforeLines: z
            .number()
            .int()
            .nonnegative()
            .max(20)
            .optional()
            .describe("仅对正文命中生效。返回命中行之前的上下文行数。"),
          caseSensitive: z
            .boolean()
            .optional()
            .describe("为 true 时启用大小写敏感匹配。默认 false。"),
          extensions: z
            .array(z.string())
            .optional()
            .describe("可选的扩展名过滤，如 ['md', '.json']。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(200)
            .optional()
            .describe("最多返回多少条结果。默认 50。"),
          matchMode: z
            .enum(["phrase", "all_terms", "any_term"])
            .default("phrase")
            .describe("phrase 按完整短语匹配；all_terms 要求所有词都命中；any_term 允许任一词命中。"),
          maxPerFile: z
            .number()
            .int()
            .positive()
            .max(20)
            .optional()
            .describe("每个文件最多保留多少条结果。"),
          path: z
            .string()
            .optional()
            .describe("可选，相对工作区路径，只在该路径下过滤结果。"),
          query: z
            .string()
            .describe("搜索关键词，建议传短语、章节名、角色名或字段名。"),
          sortBy: z
            .enum(["path", "relevance"])
            .default("relevance")
            .describe("结果排序方式。relevance 更偏重命中质量，path 按路径排序。"),
          scope: z
            .enum(["all", "content", "names"])
            .default("all")
            .describe(
              "all 搜目录名+文件名+正文，content 只搜正文，names 只搜目录名和文件名。",
            ),
          wholeWord: z
            .boolean()
            .optional()
            .describe("为 true 时优先匹配整词边界，适合英文名词或标识符。"),
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
