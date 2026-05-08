/**
 * 把 workspace 工具映射转换为 AI SDK 期望的 ToolSet（zod 输入校验 + execute 适配）。
 *
 * 之前直接定义在 session.ts 中，几乎占据 60% 的体量。这里独立成模块，方便后续按工具族
 * 进一步拆分。所有 tool 描述（中文）保持与原来一致，避免对 LLM 输出造成扰动。
 */

import { z } from "zod";
import type { ToolSet } from "ai";
import { defineTool } from "./modelGateway";
import type { AgentTool, AgentToolInteractiveContext } from "./runtime";
import type { AskToolAnswer, AskUserRequest } from "./types";
import { createToolRequestId, withAbort } from "./asyncUtils";

type ToolBuilder = (toolName: string, tool: AgentTool) => ToolSet[string];

type ToolExecutionOptions = {
  toolCallId?: string;
};

type ToolRequestStateChangeHandler = (event: {
  requestId: string;
  status: "start" | "finish";
}) => void;

/** 把 workspace 工具集映射为 AI SDK ToolSet：仅暴露 enabledToolIds 中声明的工具。 */
export function buildAiSdkTools(
  workspaceTools: Record<string, AgentTool>,
  enabledToolIds: string[],
  abortSignal?: AbortSignal,
  onToolRequestStateChange?: ToolRequestStateChangeHandler,
  interactive?: {
    askUser?: (toolCallId: string | undefined, request: AskUserRequest) => Promise<AskToolAnswer>;
  },
): ToolSet {
  const toolSet: ToolSet = {};

  // 通用执行包装：在执行前后通知 onToolRequestStateChange，并接入 abort 信号。
  const runTool = async (
    toolName: string,
    tool: AgentTool,
    input: Record<string, unknown>,
    options?: ToolExecutionOptions,
  ) => {
    const requestId = createToolRequestId(toolName);
    const interactiveContext: AgentToolInteractiveContext | undefined = interactive?.askUser
      ? {
          askUser: (request) => interactive.askUser!(options?.toolCallId, request),
        }
      : undefined;
    onToolRequestStateChange?.({ requestId, status: "start" });
    try {
      return await withAbort(abortSignal, () =>
        tool.execute(input, {
          abortSignal,
          requestId,
          toolCallId: options?.toolCallId,
          interactive: interactiveContext,
        }),
      );
    } finally {
      onToolRequestStateChange?.({ requestId, status: "finish" });
    }
  };

  const builders: Record<string, ToolBuilder> = {
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
    json: (toolName, tool) =>
      defineTool({
        description:
          "读取或局部更新 JSON。优先用它改字段、对象和数组；支持模板补齐、历史追加和 patch；多步变更优先 action=batch 或 patch，一次写回。",
        inputSchema: z.object({
          action: z
            .enum([
              "append",
              "batch",
              "delete",
              "ensure_template",
              "get",
              "history_append",
              "merge",
              "patch",
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
                value: z.unknown().optional().describe("add / replace / test 时使用的值。"),
              }),
            )
            .optional()
            .describe("仅在 action=patch 时使用。按顺序执行的 JSON Patch 操作。"),
          operations: z
            .array(
              z.object({
                action: z
                  .enum(["append", "delete", "merge", "set", "text_append"])
                  .describe("batch 中的单步动作。"),
                pointer: z
                  .string()
                  .optional()
                  .describe(
                    "batch 中该步操作的 JSON Pointer。空字符串表示根节点。",
                  ),
                value: z
                  .unknown()
                  .optional()
                  .describe("append / merge / set 时要写入的新值。"),
                separator: z
                  .string()
                  .optional()
                  .describe("仅在 batch 的 text_append 时使用。追加文本前插入的分隔符。"),
              }),
            )
            .optional()
            .describe("仅在 action=batch 时使用。按顺序依次执行的操作列表。"),
          limit: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("仅在 action=history_append 时使用。限制历史数组最大保留条数。"),
          path: z.string().describe("目标 JSON 文件的相对工作区路径。"),
          pointer: z
            .string()
            .optional()
            .describe(
              "JSON Pointer。空字符串表示根节点，例如 /stage、/chapters/0/title。",
            ),
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

  for (const toolId of enabledToolIds) {
    const workspaceTool = workspaceTools[toolId];
    const buildTool = builders[toolId];
    if (!workspaceTool || !buildTool) {
      continue;
    }
    toolSet[toolId] = buildTool(toolId, workspaceTool);
  }

  return toolSet;
}
