import { z } from "zod";
import { normalizeTodoToolInput } from "../tools/resourceHelpers";
import { createAiSdkToolBuilder } from "./output";
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

const todoObjectInputSchema = z.preprocess((value) => normalizeTodoToolInput(value), z.object({
  items: z
    .array(todoItemSchema)
    .describe("当前整份计划数组。每次传完整计划，保持最多一个 in_progress；简单任务可不用 todo。"),
}));

const yoloControlInputSchema = z.object({
  action: z
    .enum(["complete", "continue", "blocked"])
    .describe("YOLO 检查动作。complete=目标完成；continue=还需继续下一轮；blocked=需要用户授权或补充信息。"),
  evidence: z.array(z.string()).default([]).describe("完成证据。complete 时至少 1 条，写具体文件、工具结果或落地事项。"),
  goal: z.string().min(1).describe("当前 YOLO 总目标，必须复述用户目标。"),
  nextAction: z.string().optional().describe("continue 时必填，写下一轮最重要动作。"),
  reason: z.string().min(1).describe("本次检查结论的原因。"),
  remaining: z.array(z.string()).default([]).describe("continue 时必填，列出剩余任务；complete 时必须为空。"),
  requiredUserAction: z.string().optional().describe("blocked 时必填，说明需要用户做什么。"),
  stateUpdated: z.boolean().default(false).describe("成果涉及项目状态时是否已维护状态文件；complete 时必须为 true。"),
  verification: z.array(z.string()).default([]).describe("验证结果。complete 时至少 1 条，写已读取/统计/搜索核对的结果。"),
});

const workflowNodeSchema = z.object({
  gate: z.string().min(1).describe("节点完成门禁，必须能通过 evidence 验证。"),
  id: z.string().min(1).describe("节点稳定 id，短横线或下划线命名。"),
  outputContract: z.string().optional().describe("可选。该节点必须产出的格式、写回路径、证据要求或汇报结构。"),
  roleId: z.string().min(1).describe("该节点的执行职责 ID，例如 inspect、chapter-write、continuity-review、state-maintain、report。"),
  systemPrompt: z.string().min(1).describe("节点专属补充系统提示词。写清身份、执行边界、判断标准、禁止事项和输出要求。"),
  title: z.string().min(1).describe("节点名称，短而清楚。"),
  tools: z.array(z.string()).optional().describe("该节点建议使用的工具 id。"),
  type: z.enum(["task", "decision", "loop", "parallel", "report"]).default("task"),
});

const workflowEdgeSchema = z.object({
  condition: z.string().optional().describe("可选分支条件；普通顺序边可不填。"),
  from: z.string().min(1),
  id: z.string().optional(),
  to: z.string().min(1),
});

const workflowDefinitionSchema = z.object({
  edges: z.array(workflowEdgeSchema).default([]),
  id: z.string().min(1),
  nodes: z.array(workflowNodeSchema).min(1),
  title: z.string().min(1),
});

const workflowControlInputSchema = z.object({
  action: z
    .enum([
      "draft_workflow",
      "request_approval",
      "start_workflow",
      "complete_node",
      "choose_branch",
      "loop",
      "blocked",
      "complete_workflow",
    ])
    .describe("工作流控制动作：草拟、请求确认、启动、完成节点、选择分支、循环、阻塞或完成。"),
  branchReason: z.string().optional().describe("choose_branch 时必填，解释为什么选择该分支。"),
  evidence: z.array(z.string()).optional().describe("完成节点或工作流的证据列表。"),
  nextNodeId: z.string().optional().describe("complete_node / choose_branch / loop 后要进入的节点。"),
  nodeId: z.string().optional().describe("当前控制的节点 id。"),
  reason: z.string().optional().describe("阻塞、循环或完成说明。"),
  workflow: workflowDefinitionSchema
    .optional()
    .describe("draft_workflow、request_approval 或 start_workflow 可传入的流程定义。"),
  workflowId: z.string().optional().describe("当前工作流 id。"),
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
  ask_user: {
    description:
      "向用户提问。只有需求模糊且不同选择会显著影响结果时使用；可自行判断、可先读文件确认、或用户已给明确目标时不要问。工具会自动补“用户输入”。",
    inputSchema: askInputSchema,
  },
  update_plan: {
    description:
      "更新当前会话短计划。≥3 步或长链路任务使用；每次传完整 items，并保持最多一个 in_progress。简单单步任务不要为了形式调用。",
    inputSchema: todoObjectInputSchema,
  },
  yolo_control: {
    description:
      "YOLO 模式每轮结果检查专用工具。每轮结束必须调用一次；不要用自然语言代替 complete/continue/blocked。",
    inputSchema: yoloControlInputSchema,
  },
  workflow_control: {
    description:
      "工作流模式专用工具。用于草拟可确认流程、启动执行、推进节点、选择分支、循环、阻塞和完成工作流。",
    inputSchema: workflowControlInputSchema,
  },
  workspace_browse: {
    description:
      "浏览工作区结构。未知路径或需要了解目录时使用；已知关键词用 search，已知准确文件用 read。",
    inputSchema: browseInputSchema,
  },
  workspace_search: {
    description:
      "搜索工作区目录名、文件名和正文内容。找路径、角色名、章节、字段、锚点时使用；找到准确路径后用 read 精读。",
    inputSchema: searchInputSchema,
  },
} satisfies Record<string, AgentToolPromptSpec>;

export function createInteractionToolBuilders(runTool: ToolRunner): Record<string, ToolBuilder> {
  return {
    ask_user: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.ask_user, ({ toolCallId }) => ({ toolCallId })),
    update_plan: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.update_plan),
    yolo_control: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.yolo_control, ({ toolCallId }) => ({ toolCallId })),
    workflow_control: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.workflow_control, ({ toolCallId }) => ({ toolCallId })),
    workspace_browse: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.workspace_browse),
    workspace_search: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.workspace_search),
  };
}
