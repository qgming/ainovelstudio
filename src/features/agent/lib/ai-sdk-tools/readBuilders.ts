import { z } from "zod";
import { defineTool } from "../modelGateway";
import type { ToolBuilder, ToolRunner } from "./types";
import type { AgentToolPromptSpec } from "./toolPromptSpecs";

const fanqieLeaderboardInputSchema = z.object({
  board: z
    .enum(["fanqie-overall", "male-reading", "male-new", "female-reading", "female-new"])
    .optional()
    .describe("主榜 ID。优先直接传 board：fanqie-overall=今日番茄总榜，male-reading=男频阅读榜，male-new=男频新书榜，female-reading=女频阅读榜，female-new=女频新书榜。"),
  gender: z
    .union([z.literal(0), z.literal(1)])
    .optional()
    .describe("不传 board 时可用。0=女频，1=男频；board 已传时忽略。"),
  type: z
    .union([z.literal(1), z.literal(2)])
    .optional()
    .describe("不传 board 时可用。1=新书榜，2=阅读榜；board 已传时忽略。"),
  categoryId: z
    .number()
    .int()
    .optional()
    .describe("分类 ID；-1 表示总榜。已知 categoryId 时优先用它，高于 categoryName。"),
  categoryName: z
    .string()
    .optional()
    .describe("分类名称，如 都市高武、快穿、总榜。未传默认总榜；不确定分类 ID 时用名称。"),
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
    .describe("排名范围起点，默认 1。和 rankTo 或 limit 配合使用。"),
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
    .describe("最多返回多少本，默认 30，最大 180。只要前 N 名时传 limit。"),
  forceRefresh: z
    .boolean()
    .optional()
    .describe("是否绕过今日缓存强制刷新。默认 false；除非用户要求最新实时数据或怀疑缓存过期。"),
});

const webSearchInputSchema = z.object({
  domains: z
    .array(z.string())
    .optional()
    .describe("可选。限制结果优先来自这些站点域名，如 ['openai.com', 'platform.openai.com']；查官方规则时建议填写。"),
  language: z
    .string()
    .optional()
    .describe("结果语言，默认 zh-CN；查英文资料可传 en。"),
  limit: z
    .number()
    .int()
    .positive()
    .max(10)
    .optional()
    .describe("最多返回多少条结果，默认 5，最大 10；需要快速定位时 3-5 足够。"),
  query: z.string().min(1).describe("搜索关键词或完整问题。包含实体名、平台名、时间范围会更准。"),
  safesearch: z
    .union([z.literal(0), z.literal(1), z.literal(2)])
    .optional()
    .describe("安全搜索等级：0 关闭，1 中等，2 严格。默认 1。"),
});

const webFetchInputSchema = z.object({
  afterBlocks: z
    .number()
    .int()
    .nonnegative()
    .max(20)
    .optional()
    .describe("仅 mode=anchor_range 使用。命中 anchor 块之后额外返回多少块。"),
  anchor: z
    .string()
    .optional()
    .describe("仅 mode=anchor_range 使用。网页正文中的定位锚点；应来自已知页面文本。"),
  beforeBlocks: z
    .number()
    .int()
    .nonnegative()
    .max(20)
    .optional()
    .describe("仅 mode=anchor_range 使用。命中 anchor 块之前额外返回多少块。"),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("仅 mode=anchor_range 使用。是否大小写敏感。"),
  heading: z
    .string()
    .optional()
    .describe("仅 mode=heading_range 使用。要提取的标题文本，可带或不带 #。"),
  includeLinks: z
    .boolean()
    .optional()
    .describe("是否额外提取正文区域内的结构化链接列表；需要继续追链接时传 true。"),
  includeTables: z
    .boolean()
    .optional()
    .describe("是否额外提取正文区域内的结构化表格；页面含价格/榜单/参数表时传 true。"),
  maxChars: z
    .number()
    .int()
    .positive()
    .max(20000)
    .optional()
    .describe("正文最大返回字符数，默认 8000，最大 20000；页面很长时先 full 小 maxChars，再 anchor/heading 精读。"),
  mode: z
    .enum(["full", "anchor_range", "heading_range"])
    .default("full")
    .describe("full 返回整页正文；anchor_range 返回锚点附近块；heading_range 返回指定标题块。已有标题/锚点时优先定向读取。"),
  occurrence: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("anchor_range 或 heading_range 中使用第几次命中，默认 1。"),
  url: z.string().url().describe("要读取的完整网页地址，必须包含 http/https。"),
});

const readInputSchema = z.object({
  afterLines: z
    .number()
    .int()
    .nonnegative()
    .max(200)
    .optional()
    .describe("仅 mode=anchor_range 使用。命中 anchor 行之后额外返回多少行。"),
  anchor: z
    .string()
    .optional()
    .describe("仅 mode=anchor_range 使用。文件中已有的定位锚点；优先选唯一短句或标题。"),
  beforeLines: z
    .number()
    .int()
    .nonnegative()
    .max(200)
    .optional()
    .describe("仅 mode=anchor_range 使用。命中 anchor 行之前额外返回多少行。"),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("仅 mode=anchor_range 使用。英文标识符大小写重要时传 true。"),
  endLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("仅 mode=range 使用。结束行号，包含该行；必须 >= startLine。"),
  heading: z
    .string()
    .optional()
    .describe("仅 mode=heading_range 使用。Markdown 标题文本，可带或不带 #；读取该标题块直到下个同级/更高标题前。"),
  limit: z
    .number()
    .int()
    .positive()
    .max(400)
    .optional()
    .describe("head/tail 模式返回的最大行数，默认 80；大文件先用 head/tail/range，避免 full。"),
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
      "full 返回全文；head/tail 返回头尾片段；range 返回行段；anchor_range 返回锚点附近；heading_range 返回 Markdown 标题块。大文件优先定向模式。",
    ),
  occurrence: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("anchor_range 或 heading_range 使用第几次命中，默认 1；同名标题多处出现时指定。"),
  path: z.string().describe("目标文本文件的相对工作区路径，不要传绝对路径。"),
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("仅 mode=range 使用。起始行号，从 1 开始。"),
});

const wordCountInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("单文件模式：目标文本文件的相对工作区路径。path、paths、dir 三选一。"),
  paths: z
    .array(z.string())
    .optional()
    .describe("多文件模式：要批量统计的相对路径列表。path、paths、dir 三选一。"),
  dir: z
    .string()
    .optional()
    .describe("目录模式：递归统计该目录下所有文本文件。path、paths、dir 三选一。"),
  extensions: z
    .array(z.string())
    .optional()
    .describe(
      "目录模式可选：扩展名过滤（如 ['.md','.txt']）；缺省统计 md/markdown/txt/text/json。",
    ),
});

const canonQueryInputSchema = z.object({
  kind: z
    .enum(["canon", "status", "setting", "outline", "chapter"])
    .default("canon")
    .describe("查询范围类型。canon=项目事实源；status=状态；setting=设定；outline=大纲；chapter=正文线索。默认 canon。"),
  limit: z
    .number()
    .int()
    .positive()
    .max(30)
    .optional()
    .describe("最多返回多少条线索，默认 12。"),
  query: z.string().min(1).describe("要查询的人物、地点、伏笔、能力边界、章节事件或关键词；用具体名词短语。"),
});

export const READ_TOOL_SPECS = {
  leaderboard: {
    description:
      "读取番茄小说排行榜，支持男频/女频、阅读榜/新书榜、分类或总榜，并可按具体排名或排名范围返回书名、作者、简介、在读数、字数、状态、排行变化和详情链接。",
    inputSchema: fanqieLeaderboardInputSchema,
  },
  web_search: {
    description:
      "搜索公开网络信息并返回标题、摘要和链接。需要最新/外部事实时使用；拿到具体链接后用 web_read 精读。查官方规则优先传 domains 限定站点。",
    inputSchema: webSearchInputSchema,
  },
  web_read: {
    description:
      "读取指定网页正文。通常先 web_search 找链接，再 web_read；已知 URL 可直接用。页面很长时用 heading_range 或 anchor_range 精读。",
    inputSchema: webFetchInputSchema,
  },
  workspace_read: {
    description:
      "读取工作区文本文件。已知准确路径时使用；未知路径先 browse/search。大文件不要直接 full，优先 head/tail/range/anchor_range/heading_range。",
    inputSchema: readInputSchema,
  },
  text_stats: {
    description:
      "统计文本文件字符数、中文字符数、段落数等。支持单文件（path）、多文件（paths 数组）或目录递归（dir + 可选 extensions）批量统计。批量返回每文件统计 + 总和 + 中位字符数。",
    inputSchema: wordCountInputSchema,
  },
  project_memory_search: {
    description:
      "查询项目事实源。用于核对人物、地点、伏笔、能力边界、状态、大纲或正文线索，减少凭印象续写。",
    inputSchema: canonQueryInputSchema,
  },
} satisfies Record<string, AgentToolPromptSpec>;

export function createReadToolBuilders(runTool: ToolRunner): Record<string, ToolBuilder> {
  return {
    leaderboard: (toolName, tool) =>
      defineTool({
        description: READ_TOOL_SPECS.leaderboard.description,
        inputSchema: READ_TOOL_SPECS.leaderboard.inputSchema,
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
        description: READ_TOOL_SPECS.web_search.description,
        inputSchema: READ_TOOL_SPECS.web_search.inputSchema,
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    web_read: (toolName, tool) =>
      defineTool({
        description: READ_TOOL_SPECS.web_read.description,
        inputSchema: READ_TOOL_SPECS.web_read.inputSchema,
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    workspace_read: (toolName, tool) =>
      defineTool({
        description: READ_TOOL_SPECS.workspace_read.description,
        inputSchema: READ_TOOL_SPECS.workspace_read.inputSchema,
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    text_stats: (toolName, tool) =>
      defineTool({
        description: READ_TOOL_SPECS.text_stats.description,
        inputSchema: READ_TOOL_SPECS.text_stats.inputSchema,
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    project_memory_search: (toolName, tool) =>
      defineTool({
        description: READ_TOOL_SPECS.project_memory_search.description,
        inputSchema: READ_TOOL_SPECS.project_memory_search.inputSchema,
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
