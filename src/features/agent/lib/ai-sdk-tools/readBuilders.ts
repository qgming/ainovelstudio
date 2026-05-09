import { z } from "zod";
import { defineTool } from "../modelGateway";
import type { ToolBuilder, ToolRunner } from "./types";

export function createReadToolBuilders(runTool: ToolRunner): Record<string, ToolBuilder> {
  return {
    fanqie_leaderboard: (toolName, tool) =>
      defineTool({
        description:
          "读取番茄小说排行榜，支持男频/女频、阅读榜/新书榜、分类或总榜，并可按具体排名或排名范围返回书名、作者、简介、在读数、字数、状态和详情链接。",
        inputSchema: z.object({
          board: z
            .enum(["fanqie-overall", "male-reading", "male-new", "female-reading", "female-new"])
            .optional()
            .describe("主榜 ID。fanqie-overall=今日番茄总榜；未传筛选参数时默认 fanqie-overall。"),
          gender: z
            .union([z.literal(0), z.literal(1)])
            .optional()
            .describe("可选。0=女频，1=男频。board 已传时忽略。"),
          type: z
            .union([z.literal(1), z.literal(2)])
            .optional()
            .describe("可选。1=新书榜，2=阅读榜。board 已传时忽略。"),
          categoryId: z
            .number()
            .int()
            .optional()
            .describe("分类 ID；-1 表示总榜。优先级高于 categoryName。"),
          categoryName: z
            .string()
            .optional()
            .describe("分类名称，如 都市高武、快穿、总榜。未传默认总榜。"),
          rank: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("查询单个具体排名，如第 3 名。传 rank 时忽略 rankFrom/rankTo/limit。"),
          rankFrom: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("排名范围起点，默认 1。"),
          rankTo: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("排名范围终点。未传时使用 rankFrom + limit - 1。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(180)
            .optional()
            .describe("最多返回多少本，默认 30，最大 180。"),
          forceRefresh: z
            .boolean()
            .optional()
            .describe("是否绕过今日缓存强制刷新。默认 false。"),
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
    web_search: (toolName, tool) =>
      defineTool({
        description:
          "搜索公开网络信息并返回标题、摘要和链接，支持站点过滤，适合查询外部资料、平台规则和最新公开网页内容。",
        inputSchema: z.object({
          domains: z
            .array(z.string())
            .optional()
            .describe("可选。限制结果优先来自这些站点域名，如 ['openai.com', 'platform.openai.com']。"),
          language: z
            .string()
            .optional()
            .describe("结果语言，默认 zh-CN。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(10)
            .optional()
            .describe("最多返回多少条结果，默认 5，最大 10。"),
          query: z.string().min(1).describe("搜索关键词或问题。"),
          safesearch: z
            .union([z.literal(0), z.literal(1), z.literal(2)])
            .optional()
            .describe("安全搜索等级：0 关闭，1 中等，2 严格。默认 1。"),
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
    web_fetch: (toolName, tool) =>
      defineTool({
        description:
          "读取指定网页并提取标题与主要正文，支持整页、锚点附近或标题块定向提取。",
        inputSchema: z.object({
          afterBlocks: z
            .number()
            .int()
            .nonnegative()
            .max(20)
            .optional()
            .describe("仅在 mode=anchor_range 时使用。命中块之后额外返回多少块。"),
          anchor: z
            .string()
            .optional()
            .describe("仅在 mode=anchor_range 时使用。用于定位的正文锚点。"),
          beforeBlocks: z
            .number()
            .int()
            .nonnegative()
            .max(20)
            .optional()
            .describe("仅在 mode=anchor_range 时使用。命中块之前额外返回多少块。"),
          caseSensitive: z
            .boolean()
            .optional()
            .describe("仅在 mode=anchor_range 时使用。是否大小写敏感。"),
          heading: z
            .string()
            .optional()
            .describe("仅在 mode=heading_range 时使用。要提取的标题文本，可带或不带 #。"),
          includeLinks: z
            .boolean()
            .optional()
            .describe("是否额外提取正文区域内的结构化链接列表。"),
          includeTables: z
            .boolean()
            .optional()
            .describe("是否额外提取正文区域内的结构化表格。"),
          maxChars: z
            .number()
            .int()
            .positive()
            .max(20000)
            .optional()
            .describe("正文最大返回字符数，默认 8000，最大 20000。"),
          mode: z
            .enum(["full", "anchor_range", "heading_range"])
            .default("full")
            .describe("full 返回整页正文；anchor_range 返回锚点附近块；heading_range 返回指定标题块。"),
          occurrence: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("在 anchor_range 或 heading_range 中使用第几次命中，默认 1。"),
          url: z.string().url().describe("要读取的完整网页地址。"),
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
    read: (toolName, tool) =>
      defineTool({
        description:
          "读取文本文件。已知准确路径时使用；支持全文、头尾、行段、锚点范围和 Markdown 标题范围。",
        inputSchema: z.object({
          afterLines: z
            .number()
            .int()
            .nonnegative()
            .max(200)
            .optional()
            .describe("仅在 mode=anchor_range 时使用。命中行之后额外返回多少行。"),
          anchor: z
            .string()
            .optional()
            .describe("仅在 mode=anchor_range 时使用。用于定位的锚点文本。"),
          beforeLines: z
            .number()
            .int()
            .nonnegative()
            .max(200)
            .optional()
            .describe("仅在 mode=anchor_range 时使用。命中行之前额外返回多少行。"),
          caseSensitive: z
            .boolean()
            .optional()
            .describe("仅在 mode=anchor_range 时使用。是否大小写敏感。"),
          endLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 mode=range 时使用。结束行号，包含该行。"),
          heading: z
            .string()
            .optional()
            .describe("仅在 mode=heading_range 时使用。Markdown 标题文本，可带或不带 #。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(400)
            .optional()
            .describe("在 head 或 tail 模式下返回的最大行数，默认 80。"),
          mode: z
            .enum([
              "anchor_range",
              "full",
              "head",
              "heading_range",
              "range",
              "tail",
            ])
            .default("full")
            .describe(
              "full 返回全文；head / tail 返回头尾片段；range 返回指定行段；anchor_range 返回锚点附近内容；heading_range 返回 Markdown 标题块。",
            ),
          occurrence: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("在 anchor_range 或 heading_range 中使用第几次命中，默认 1。"),
          path: z.string().describe("目标文本文件的相对工作区路径。"),
          startLine: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 mode=range 时使用。起始行号，从 1 开始。"),
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
    word_count: (toolName, tool) =>
      defineTool({
        description:
          "统计文本文件字符数、中文字符数、段落数等。支持单文件（path）、多文件（paths 数组）或目录递归（dir + 可选 extensions）批量统计。批量返回每文件统计 + 总和 + 中位字符数。",
        inputSchema: z.object({
          path: z
            .string()
            .optional()
            .describe("单文件模式：目标文本文件的相对工作区路径。"),
          paths: z
            .array(z.string())
            .optional()
            .describe("多文件模式：要批量统计的相对路径列表。"),
          dir: z
            .string()
            .optional()
            .describe("目录模式：递归统计该目录下所有文本文件。"),
          extensions: z
            .array(z.string())
            .optional()
            .describe(
              "目录模式可选：扩展名过滤（如 ['.md','.txt']）；缺省时统计 md/markdown/txt/text/json。",
            ),
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
    canon_query: (toolName, tool) =>
      defineTool({
        description:
          "查询长篇 canon 事实源。用于核对人物、地点、伏笔、能力边界、文风基线和章节摘要，减少凭印象续写。",
        inputSchema: z.object({
          kind: z
            .enum(["canon", "status", "style", "chapter", "memory"])
            .default("canon")
            .describe("查询范围类型，默认 canon；status/style/chapter/memory 会收窄到对应目录。"),
          limit: z
            .number()
            .int()
            .positive()
            .max(30)
            .optional()
            .describe("最多返回多少条线索，默认 12。"),
          query: z.string().min(1).describe("要查询的人物、地点、伏笔、能力边界或章节线索。"),
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
