import { z } from "zod";
import { defineTool } from "../modelGateway";
import type { ToolBuilder, ToolRunner } from "./types";
import type { AgentToolPromptSpec } from "./toolPromptSpecs";

const jsonInputSchema = z.object({
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
    .default("get")
    .describe("JSON 动作。get 读指针值；overview 看结构；search 搜 key/value；create 新建文件；set 覆盖指针值；merge 合并对象；append 追加数组；text_append 追加字符串；delete 删除节点；ensure_template 补默认结构；history_append 追加带时间历史；batch/patch 多步一次写回。"),
  patch: z
    .array(
      z.object({
        from: z
          .string()
          .optional()
          .describe("copy / move 时来源 JSON Pointer，例如 /chapters/0。"),
        op: z
          .enum(["add", "copy", "move", "remove", "replace", "test"])
          .describe("RFC 6902 风格的 patch 动作：add/copy/move/remove/replace/test。"),
        path: z.string().describe("patch 目标 JSON Pointer，例如 /stage 或 /chapters/0/title。"),
        value: z
          .unknown()
          .optional()
          .describe("add / replace / test 时使用的值；remove/copy/move 通常不填。"),
      }),
    )
    .optional()
    .describe("仅 action=patch 使用。按顺序执行的 JSON Patch 操作；适合标准 add/remove/replace/copy/move/test。"),
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
          .describe("batch 中的单步动作；不支持 get/search/overview/create/patch。"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("batch 中 history_append 的历史数组保留上限。"),
        pointer: z
          .string()
          .optional()
          .describe("batch 中该步操作的 JSON Pointer。空字符串表示根节点；路径不存在时 set/ensure_template 可创建中间对象。"),
        separator: z
          .string()
          .optional()
          .describe("仅 batch 的 text_append 使用。追加文本前插入的分隔符，例如 '\\n'。"),
        timestamp: z
          .string()
          .optional()
          .describe("batch 中 history_append 的写入时间；不填则工具生成当前时间。"),
        timestampField: z
          .string()
          .optional()
          .describe("batch 中 history_append 的时间字段名，默认 updatedAt。"),
        value: z
          .unknown()
          .optional()
          .describe("该步要写入的新值。set/merge/append/text_append/ensure_template/history_append 通常必填；delete 不填。"),
      }),
    )
    .optional()
    .describe("仅 action=batch 使用。按顺序依次执行多个局部更新，一次读写文件；多字段更新优先用它。"),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("仅 action=search 使用。是否区分大小写；中文通常不填。"),
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
    .describe("读取或写入后返回 value 的最大字符数，默认 4000；大对象可调小，避免工具结果过长。"),
  maxDepth: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("仅 action=overview 使用。结构概览递归深度，默认 2；越大返回越长。"),
  maxEntries: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("仅 action=overview 使用。最多返回多少个结构节点，默认 80。"),
  overwrite: z
    .boolean()
    .optional()
    .describe("仅 action=create 使用。目标文件存在时是否覆盖，默认 false；不确定时先 get/overview 或让 create 失败保护。"),
  path: z.string().describe("目标 JSON 文件的相对工作区路径，不要传绝对路径。"),
  pointer: z
    .string()
    .optional()
    .describe("JSON Pointer。空字符串或不填表示根节点；对象字段用 /field，数组下标用 /0，例如 /stage、/chapters/0/title。"),
  query: z
    .string()
    .optional()
    .describe("仅 action=search 使用。要搜索的 key 或 value 文本；找字段名时 searchIn=key。"),
  searchIn: z
    .enum(["all", "key", "value"])
    .optional()
    .describe("仅 action=search 使用。all 搜 key+value；key 只搜字段名；value 只搜值。"),
  separator: z
    .string()
    .optional()
    .describe("仅 action=text_append 使用。追加文本前插入的分隔符，例如 '\\n' 或 '\\n\\n'。"),
  timestamp: z
    .string()
    .optional()
    .describe("仅 action=history_append 使用。手动指定写入时间；不填则工具生成当前时间。"),
  timestampField: z
    .string()
    .optional()
    .describe("仅 action=history_append 使用。记录时间字段名，默认 updatedAt。"),
  value: z
    .unknown()
    .optional()
    .describe("写入的新值。set/merge/append/text_append/ensure_template/history_append/create 通常需要；delete/get/overview/search 不需要。"),
});

const pathInputSchema = z.object({
  action: z
    .enum(["create_folder", "move", "rename"])
    .describe("路径动作。create_folder 需要 parentPath+name；rename 需要 path+name；move 需要 path+targetParentPath。"),
  name: z
    .string()
    .optional()
    .describe("create_folder/rename 使用的新名称，只写文件夹名或文件名，不要带父路径。"),
  parentPath: z
    .string()
    .optional()
    .describe("create_folder 使用的父目录相对路径；根目录可传空字符串或不填。"),
  path: z
    .string()
    .optional()
    .describe("rename/move 使用的现有目标相对路径。删除请使用 workspace_delete。"),
  targetParentPath: z
    .string()
    .optional()
    .describe("仅 move 使用。移动到的目标父目录相对路径。"),
});

const skillReadInputSchema = z.object({
  action: z
    .enum(["list", "read"])
    .default("list")
    .describe("技能动作。list 列出技能；read 读 SKILL.md 或 references/templates 文件。"),
  relativePath: z
    .string()
    .optional()
    .describe("action=read 时技能内相对路径，如 SKILL.md、references/voice.md、templates/prompt.md。"),
  skillId: z
    .string()
    .optional()
    .describe("read 动作通常都需要 skillId；先 list 获取准确 id。"),
});

const skillManageInputSchema = z.object({
  action: z
    .enum([
      "create",
      "create_reference",
      "delete",
      "write",
    ])
    .default("create")
    .describe("技能动作。create 新建技能；create_reference 新建参考文件；write 写回技能文件；delete 删除技能。"),
  content: z
    .string()
    .optional()
    .describe("action=write 时要写入技能文件的完整新内容。写 SKILL.md 时必须保留合法 frontmatter。"),
  description: z
    .string()
    .optional()
    .describe("action=create 时的新 skill 简介，会写入 SKILL.md 头部 description。"),
  name: z
    .string()
    .optional()
    .describe(
      "action=create 时是新 skill 名称/id；action=create_reference 时是新参考文件名，不必带 .md。",
    ),
  relativePath: z
    .string()
    .optional()
    .describe(
      "action=read/write 时技能内相对路径，如 SKILL.md、references/voice.md、templates/prompt.md。",
    ),
  skillId: z
    .string()
    .optional()
    .describe("管理动作通常都需要 skillId；先 list 获取准确 id。"),
});

export const DATA_TOOL_SPECS = {
  workspace_json: {
    description:
      "读写 JSON 文件的首选工具。读取先 overview/search/get；修改字段用 set/merge/append/text_append/delete；多字段更新用 batch；标准 JSON Patch 用 patch；新建 JSON 用 create。不要用 write 修改 JSON 字段。",
    inputSchema: jsonInputSchema,
  },
  workspace_path: {
    description:
      "只处理路径结构，不写正文内容。创建文件夹、重命名、移动用它；删除另拆为独立高风险工具。写作场景创建空白文本文件优先用 workspace_write，写文本用 workspace_edit / workspace_write，写 JSON 内容用 workspace_json。",
    inputSchema: pathInputSchema,
  },
  skill_read: {
    description:
      "读取本地 skill。任务命中技能时先 list/read SKILL.md 获取完整规则；需要参考材料时再读 references。",
    inputSchema: skillReadInputSchema,
  },
  skill_manage: {
    description:
      "管理本地 skill。用户要求创建或修改技能时用 create/create_reference/write/delete 落盘。write 写的是技能文件完整内容，不是补丁片段。",
    inputSchema: skillManageInputSchema,
  },
} satisfies Record<string, AgentToolPromptSpec>;

export function createDataToolBuilders(runTool: ToolRunner): Record<string, ToolBuilder> {
  return {
    workspace_json: (toolName, tool) =>
      defineTool({
        description: DATA_TOOL_SPECS.workspace_json.description,
        inputSchema: DATA_TOOL_SPECS.workspace_json.inputSchema,
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    workspace_path: (toolName, tool) =>
      defineTool({
        description: DATA_TOOL_SPECS.workspace_path.description,
        inputSchema: DATA_TOOL_SPECS.workspace_path.inputSchema,
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.summary;
        },
      }),
    workspace_delete: (toolName, tool) =>
      defineTool({
        description: "删除工作区文件或文件夹。",
        inputSchema: z.object({
          path: z.string().describe("要删除的工作区相对路径，不要传绝对路径。"),
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
    skill_read: (toolName, tool) =>
      defineTool({
        description: DATA_TOOL_SPECS.skill_read.description,
        inputSchema: DATA_TOOL_SPECS.skill_read.inputSchema,
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    skill_manage: (toolName, tool) =>
      defineTool({
        description: DATA_TOOL_SPECS.skill_manage.description,
        inputSchema: DATA_TOOL_SPECS.skill_manage.inputSchema,
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
