import { z } from "zod";
import { createAiSdkToolBuilder } from "./output";
import type { ToolBuilder, ToolRunner } from "./types";
import type { AgentToolPromptSpec } from "./toolPromptSpecs";

const editInputSchema = z.object({
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
    .default("replace")
    .describe("编辑动作。replace=替换精确 target；append/prepend=文件末尾/开头追加；insert_before/insert_after=围绕 target 插入；replace_lines=按行号替换；replace_anchor_range=按锚点附近窗口替换；replace_heading_range=替换 Markdown 标题块。"),
  afterLines: z
    .number()
    .int()
    .nonnegative()
    .max(200)
    .optional()
    .describe("仅 action=replace_anchor_range 使用。命中 anchor 行之后额外覆盖多少行；只填需要被替换的范围，避免过大。"),
  anchor: z
    .string()
    .optional()
    .describe("仅 action=replace_anchor_range 使用。文件中必须能唯一定位的原文锚点；优先选短而稳定的一整行。"),
  beforeLines: z
    .number()
    .int()
    .nonnegative()
    .max(200)
    .optional()
    .describe("仅 action=replace_anchor_range 使用。命中 anchor 行之前额外覆盖多少行；默认不填则覆盖窗口较小。"),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("仅 action=replace_anchor_range 使用。中文通常不填；英文标识符大小写重要时传 true。"),
  content: z.string().describe("要写入的新文本片段。replace/replace_lines/replace_* 时是替换后的完整片段；append/prepend/insert_* 时是新增片段。"),
  endLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("仅 action=replace_lines 使用。结束行号，包含该行；必须 >= startLine。"),
  expectedCount: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("仅 target 类动作使用。replaceAll=false 时预期 target 命中次数，默认 1；命中数不符会失败，防止误改。"),
  heading: z
    .string()
    .optional()
    .describe("仅 action=replace_heading_range 使用。Markdown 标题文本，可带或不带 #；工具会替换该标题块直到下一个同级/更高标题前。"),
  occurrence: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("replace_anchor_range 或 replace_heading_range 使用第几次命中，默认 1；同名标题/锚点多处出现时必须指定。"),
  path: z.string().describe("目标文本文件的相对工作区路径，不要传绝对路径。修改已有文件前通常应已 read 过当前内容。"),
  replaceAll: z
    .boolean()
    .optional()
    .describe("仅 action=replace 使用。为 true 时替换所有 target；除非用户明确要求全局替换，否则保持 false。"),
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("仅 action=replace_lines 使用。起始行号，从 1 开始；替换大段内容前先 read range 核对行号。"),
  target: z
    .string()
    .optional()
    .describe(
      "replace / insert_before / insert_after 时必填。必须是当前文件里的原文片段；不要填新文本或模糊描述。",
    ),
});

const writeInputSchema = z.object({
  action: z
    .enum(["create", "append", "replace"])
    .default("append")
    .describe("写入方式。create=创建空白文本文件；append=追加到已有文件末尾；replace=覆盖已有文件全文。"),
  content: z
    .string()
    .optional()
    .describe("要写入的文本内容。action=create 时不填；append/replace 时填写。长章节建议分多次 append。"),
  path: z.string().describe("必填。目标文件的相对工作区路径，不要传绝对路径，不要省略文件名；章节正文优先用 正文/第001章.md、正文/第012章.md 这类路径；大纲用 大纲/xxx.md，设定用 设定/xxx.md。"),
});

export const WRITE_TOOL_SPECS = {
  workspace_write: {
    description:
      "创建或写入文本文件。action=create 创建空白文件；action=append 追加内容；action=replace 覆盖全文。JSON 文件优先用 workspace_json。",
    inputSchema: writeInputSchema,
  },
  workspace_edit: {
    description:
      "对已有文本文件做局部编辑并写回。改少量文字、插入片段、替换某个标题块或按行号替换时首选；必须提供 path、action、content，并按 action 提供 target / 行号 / anchor / heading。不要用它创建全新完整文件。",
    inputSchema: editInputSchema,
  },
} satisfies Record<string, AgentToolPromptSpec>;

export function createWriteToolBuilders(runTool: ToolRunner): Record<string, ToolBuilder> {
  return {
    workspace_write: createAiSdkToolBuilder(runTool, WRITE_TOOL_SPECS.workspace_write),
    workspace_edit: createAiSdkToolBuilder(runTool, WRITE_TOOL_SPECS.workspace_edit),
  };
}
