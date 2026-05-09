import { z } from "zod";
import { defineTool } from "../modelGateway";
import type { ToolBuilder, ToolRunner } from "./types";

export function createWriteToolBuilders(runTool: ToolRunner): Record<string, ToolBuilder> {
  return {
    edit: (toolName, tool) =>
      defineTool({
        description:
          "对文本做局部编辑。支持精确锚点替换，以及按行段整体替换，不需要整份重写。",
        inputSchema: z.object({
          action: z
            .enum([
              "append",
              "insert_after",
              "insert_before",
              "prepend",
              "replace_anchor_range",
              "replace_heading_range",
              "replace_lines",
              "replace",
            ])
            .default("replace"),
          afterLines: z
            .number()
            .int()
            .nonnegative()
            .max(200)
            .optional()
            .describe("仅在 action=replace_anchor_range 时使用。命中行之后额外覆盖多少行。"),
          anchor: z
            .string()
            .optional()
            .describe("仅在 action=replace_anchor_range 时使用。用于定位的锚点文本。"),
          beforeLines: z
            .number()
            .int()
            .nonnegative()
            .max(200)
            .optional()
            .describe("仅在 action=replace_anchor_range 时使用。命中行之前额外覆盖多少行。"),
          caseSensitive: z
            .boolean()
            .optional()
            .describe("仅在 action=replace_anchor_range 时使用。是否大小写敏感。"),
          content: z.string().describe("要写入的新文本。"),
          endLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 action=replace_lines 时使用。结束行号，包含该行。"),
          expectedCount: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("replaceAll=false 时，预期 target 命中的次数，默认 1。"),
          heading: z
            .string()
            .optional()
            .describe("仅在 action=replace_heading_range 时使用。Markdown 标题文本，可带或不带 #。"),
          occurrence: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("在 replace_anchor_range 或 replace_heading_range 中使用第几次命中，默认 1。"),
          path: z.string().describe("目标文本文件的相对工作区路径。"),
          replaceAll: z
            .boolean()
            .optional()
            .describe("为 true 时，对所有命中的 target 生效。"),
          startLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 action=replace_lines 时使用。起始行号，从 1 开始。"),
          target: z
            .string()
            .optional()
            .describe(
              "replace / insert_before / insert_after 时需要的锚点文本。",
            ),
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
    write: (toolName, tool) =>
      defineTool({
        description: "整文件覆盖写入。只有在你已经准备好完整新内容时使用。",
        inputSchema: z.object({
          content: z.string().describe("文件的新完整内容。"),
          path: z.string().describe("目标文件的相对工作区路径。"),
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
  };
}
