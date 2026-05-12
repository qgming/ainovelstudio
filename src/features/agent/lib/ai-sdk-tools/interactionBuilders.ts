import { z } from "zod";
import { defineTool } from "../modelGateway";
import { MODE_CONTROL_DEFAULT_MODE } from "../modeControl";
import type { ToolBuilder, ToolRunner } from "./types";
import type { AgentToolPromptSpec } from "./toolPromptSpecs";

const todoItemSchema = z.object({
  activeForm: z
    .string()
    .optional()
    .describe("当步骤处于 in_progress 时的进行时描述，例如“正在读取大纲”。可不填。"),
  content: z.string().min(1).describe("这一步要做什么；写成可验证的小动作，不要写空泛目标。"),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .default("pending")
    .describe("步骤状态。当前正在做的步骤最多一个 in_progress；已完成用 completed；未开始用 pending。"),
  phase: z
    .string()
    .optional()
    .describe(
      "可选：所属阶段标签。建议网文链路使用 plot / bible / outline / chapter / write / review / polish 等短词。",
    ),
});

function parseTodoItemsInput(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const askInputSchema = z.object({
  title: z.string().min(1).describe("问题标题，用一句话说明需要用户决定什么。"),
  description: z.string().optional().describe("可选的问题说明。解释为什么必须问，不要写长篇背景。"),
  selectionMode: z
    .enum(["single", "multiple"])
    .default("single")
    .describe("single 为单选，multiple 为多选。默认 single；只有多个选项可同时成立时用 multiple。"),
  options: z
    .array(
      z.object({
        id: z.string().min(1).describe("选项唯一标识，使用稳定短 id，如 keep-style。"),
        label: z.string().min(1).describe("选项显示名称，短而清楚。"),
        description: z.string().optional().describe("选项补充说明，说明影响或取舍。"),
      }),
    )
    .min(1)
    .describe("预设选项列表，2-4 个最合适；不要包含“用户输入”，系统会自动追加。"),
  customPlaceholder: z
    .string()
    .optional()
    .describe("选择“用户输入”后输入框的占位提示。"),
  minSelections: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("仅 multiple 使用。多选时最少需要选择多少项。"),
  maxSelections: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("仅 multiple 使用。多选时最多允许选择多少项。"),
  confirmLabel: z
    .string()
    .optional()
    .describe("确认按钮文案；通常不填。"),
});

const todoObjectInputSchema = z.object({
  items: z
    .array(todoItemSchema)
    .describe("当前整份计划数组。每次传完整计划，保持最多一个 in_progress；简单任务可不用 todo。"),
});

const todoInputSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") {
    return value;
  }
  const input = value as Record<string, unknown>;
  return {
    ...input,
    items: parseTodoItemsInput(input.items ?? input.todos),
  };
}, todoObjectInputSchema);

const modeControlInputSchema = z.object({
  mode: z
    .string()
    .min(1)
    .default(MODE_CONTROL_DEFAULT_MODE)
    .describe("当前受控模式，例如 autopilot、flow、book。YOLO 使用 autopilot；不确定则保持默认。"),
  action: z
    .enum(["complete", "blocked", "continue", "complete_stage", "complete_workflow"])
    .describe("控制动作。YOLO 任务完成用 complete；flow 阶段完成用 complete_stage；遇到无法继续用 blocked；全部流程完成用 complete_workflow。"),
  workflowId: z.string().optional().describe("flow 模式使用，默认 chapter-harness。"),
  stage: z
    .enum(["inspect", "skill_load", "plan", "act", "verify", "state_maintain", "report"])
    .optional()
    .describe("flow 模式使用，必须等于当前程序阶段；不要跳阶段。"),
  evidence: z.array(z.string()).optional().describe("flow 模式阶段完成或工作流完成的证据列表，写具体已完成事项或工具结果。"),
  reason: z.string().optional().describe("控制信号原因，简洁说明验证证据或阻塞原因。"),
  nextAction: z.string().optional().describe("blocked 或 continue 时填写下一步动作。"),
});

const browseInputSchema = z.object({
  depth: z
    .number()
    .int()
    .positive()
    .max(8)
    .optional()
    .describe("仅 mode=tree 使用。限制返回的树深度，默认 2；项目很大时保持 1-3。"),
  extensions: z
    .array(z.string())
    .optional()
    .describe("仅 mode=list 使用。按文件扩展名过滤，如 ['md', '.json']；不确定扩展名则不填。"),
  kind: z
    .enum(["all", "directory", "file"])
    .default("all")
    .describe("仅 mode=list 使用。筛选目录、文件或全部。"),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("仅 mode=list 使用。限制返回的子项数量，默认由工具决定；目录很大时传 50-100。"),
  mode: z
    .enum(["list", "stat", "tree"])
    .default("list")
    .describe(
      "list 列出目录直接子项；stat 查看路径是否存在、类型和大小；tree 返回裁剪后的目录树。未知结构先 list 或 tree。",
    ),
  path: z
    .string()
    .optional()
    .describe("要浏览的相对工作区路径；不传时默认为工作区根目录。不要传绝对路径。"),
  sortBy: z
    .enum(["name", "type"])
    .default("name")
    .describe("仅 mode=list 使用。name 按名称排序，type 先目录后文件。"),
});

const searchInputSchema = z.object({
  afterLines: z
    .number()
    .int()
    .nonnegative()
    .max(20)
    .optional()
    .describe("仅正文命中生效。返回命中行之后的上下文行数；需要看语境时传 2-5。"),
  beforeLines: z
    .number()
    .int()
    .nonnegative()
    .max(20)
    .optional()
    .describe("仅正文命中生效。返回命中行之前的上下文行数；需要看语境时传 2-5。"),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("为 true 时启用大小写敏感匹配。中文通常不填；英文变量名可传 true。"),
  extensions: z
    .array(z.string())
    .optional()
    .describe("可选的扩展名过滤，如 ['md', '.json']；搜索正文稿常用 ['md','txt']。"),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe("最多返回多少条结果，默认 50。先小范围定位可传 20-50。"),
  matchMode: z
    .enum(["phrase", "all_terms", "any_term"])
    .default("phrase")
    .describe("phrase 按完整短语匹配，适合人名/标题；all_terms 要求所有词都命中；any_term 放宽召回。"),
  maxPerFile: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .describe("每个文件最多保留多少条结果，避免单个大文件刷屏。"),
  path: z
    .string()
    .optional()
    .describe("可选，相对工作区路径，只在该路径下过滤结果；不要传绝对路径。"),
  query: z
    .string()
    .describe("搜索关键词。建议传短语、章节名、角色名、字段名；不要传很长问题。"),
  sortBy: z
    .enum(["path", "relevance"])
    .default("relevance")
    .describe("结果排序方式。relevance 更偏重命中质量；path 方便按文件顺序扫。"),
  scope: z
    .enum(["all", "content", "names"])
    .default("all")
    .describe(
      "all 搜目录名+文件名+正文；content 只搜正文；names 只搜目录名和文件名。找路径用 names，找内容用 content。",
    ),
  wholeWord: z
    .boolean()
    .optional()
    .describe("为 true 时优先匹配整词边界，适合英文名词或标识符。"),
});

export const INTERACTION_TOOL_SPECS = {
  ask: {
    description:
      "向用户提问。只有需求模糊且不同选择会显著影响结果时使用；可自行判断、可先读文件确认、或用户已给明确目标时不要问。工具会自动补“用户输入”。",
    inputSchema: askInputSchema,
  },
  todo: {
    description:
      "更新当前会话短计划。≥3 步或长链路任务使用；每次传完整 items，并保持最多一个 in_progress。简单单步任务不要为了形式调用。",
    inputSchema: todoObjectInputSchema,
  },
  mode_control: {
    description:
      "向应用提交当前模式的流程控制信号。YOLO 完成时用 complete；flow 模式阶段推进用 complete_stage、blocked、complete_workflow。",
    inputSchema: modeControlInputSchema,
  },
  browse: {
    description:
      "浏览工作区结构。未知路径或需要了解目录时使用；已知关键词用 search，已知准确文件用 read。",
    inputSchema: browseInputSchema,
  },
  search: {
    description:
      "搜索工作区目录名、文件名和正文内容。找路径、角色名、章节、字段、锚点时使用；找到准确路径后用 read 精读。",
    inputSchema: searchInputSchema,
  },
} satisfies Record<string, AgentToolPromptSpec>;

export function createInteractionToolBuilders(runTool: ToolRunner): Record<string, ToolBuilder> {
  return {
    ask: (toolName, tool) =>
      defineTool({
        description: INTERACTION_TOOL_SPECS.ask.description,
        inputSchema: INTERACTION_TOOL_SPECS.ask.inputSchema,
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
        description: INTERACTION_TOOL_SPECS.todo.description,
        inputSchema: todoInputSchema,
        execute: async (input) => {
          const result = await runTool(
            toolName,
            tool,
            input as unknown as Record<string, unknown>,
          );
          return result.data ?? result.summary;
        },
      }),
    mode_control: (toolName, tool) =>
      defineTool({
        description: INTERACTION_TOOL_SPECS.mode_control.description,
        inputSchema: INTERACTION_TOOL_SPECS.mode_control.inputSchema,
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
    browse: (toolName, tool) =>
      defineTool({
        description: INTERACTION_TOOL_SPECS.browse.description,
        inputSchema: INTERACTION_TOOL_SPECS.browse.inputSchema,
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
        description: INTERACTION_TOOL_SPECS.search.description,
        inputSchema: INTERACTION_TOOL_SPECS.search.inputSchema,
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
