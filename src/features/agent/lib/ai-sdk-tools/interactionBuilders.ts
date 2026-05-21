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
  includeAdjacent: z
    .boolean()
    .default(true)
    .describe("是否允许检索器优先返回可继续向前后扩展阅读的上下文片段。默认 true。"),
  intent: z
    .enum(["auto", "fact", "character", "plot", "chapter", "path", "status", "conflict"])
    .default("auto")
    .describe("检索意图。找人物设定用 character/fact，找当前状态用 status，找章节正文用 chapter，找路径用 path；不确定时 auto。"),
  limit: z
    .number()
    .int()
    .positive()
    .max(30)
    .optional()
    .describe("最多返回多少段上下文，默认 8。Agent 检索通常 5-12 足够。"),
  path: z
    .string()
    .optional()
    .describe("兼容单路径 scope；限定在某个相对目录或文件下检索。新调用优先使用 scope。"),
  query: z
    .string()
    .describe("检索关键词或短问题。优先传角色名、地点、伏笔、章节名、字段名或 2-6 个关键词；不要传整段正文。"),
  scope: z
    .array(z.string())
    .optional()
    .describe("可选的相对路径范围列表，如 ['.project/status', '设定', '大纲']。找事实源时优先限定 ['.project/status','设定','大纲','正文']；不要传绝对路径。"),
  tokenBudget: z
    .number()
    .int()
    .positive()
    .max(12000)
    .optional()
    .describe("本次检索结果可用的上下文预算，默认 4000。复杂问题可传 6000-10000。"),
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
  workspace_browse: {
    description:
      "浏览工作区结构。未知路径或需要了解目录时使用；已知关键词用 search，已知准确文件用 read。",
    inputSchema: browseInputSchema,
  },
  workspace_search: {
    description:
      "检索工作区事实源和正文证据，返回可直接用于推理的上下文片段。未知路径、缺人物/设定/伏笔/章节/状态证据、需要定位 JSON 字段或编辑锚点时优先使用；编辑前继续用 read 精读最高置信路径。",
    inputSchema: searchInputSchema,
  },
} satisfies Record<string, AgentToolPromptSpec>;

export function createInteractionToolBuilders(runTool: ToolRunner): Record<string, ToolBuilder> {
  return {
    ask_user: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.ask_user, ({ toolCallId }) => ({ toolCallId })),
    update_plan: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.update_plan),
    yolo_control: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.yolo_control, ({ toolCallId }) => ({ toolCallId })),
    workspace_browse: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.workspace_browse),
    workspace_search: createAiSdkToolBuilder(runTool, INTERACTION_TOOL_SPECS.workspace_search),
  };
}
