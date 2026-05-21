/** 内置工具元数据定义，设置页和 session 共用 */
export type ToolDef = {
  /** 工具唯一标识，与 tools.ts 中的 key 一致 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 设置页和 prompt 使用的简短描述 */
  description: string;
};

export const BUILTIN_TOOLS: ToolDef[] = [
  {
    id: "ask_user",
    name: "询问用户",
    description:
      "在运行过程中向用户发起单选或多选问题；工具会自动附带“用户输入”选项，并在用户确认后继续当前轮。",
  },
  {
    id: "update_plan",
    name: "更新计划",
    description:
      "更新当前会话的显式计划状态；参数使用 items 数组；同一时间最多保留一个进行中的步骤；可选 phase 字段标记长链路阶段。",
  },
  {
    id: "yolo_control",
    name: "YOLO 检查",
    description:
      "YOLO 模式每轮结果检查专用工具；用 complete、continue 或 blocked 明确控制自动循环是否结束。",
  },
  {
    id: "workspace_browse",
    name: "浏览工作区",
    description:
      "浏览目录树、列出文件夹内容或查看路径概况；适合先了解结构，再决定读哪个文件。",
  },
  {
    id: "workspace_search",
    name: "搜索工作区",
    description:
      "检索工作区事实源和正文证据，返回适合 AI 推理的上下文片段；适合了解角色、设定、章节、伏笔、当前状态或数据字段。",
  },
  {
    id: "web_search",
    name: "网络搜索",
    description:
      "搜索公开网络信息并返回标题、摘要和链接；适合补充外部资料、平台规则和最新公开网页内容。",
  },
  {
    id: "web_read",
    name: "网页读取",
    description:
      "读取指定网页正文并提取标题和主要文本；适合在搜索后继续展开阅读具体内容。",
  },
  {
    id: "leaderboard",
    name: "小说排行榜",
    description:
      "读取小说排行榜；支持四个主榜、题材榜单、作品简介单独读取和数据统计。书单默认不含简介，简介需按作品单独读取。",
  },
  {
    id: "workspace_read",
    name: "读取工作区文件",
    description:
      "读取文本文件全文或局部行段；已知准确路径时使用，未知路径先 browse 或 search。",
  },
  {
    id: "text_stats",
    name: "文本统计",
    description:
      "统计文本文件字符/中文/英文/段落等指标。支持单文件 path、多文件 paths、目录递归 dir 三种模式；批量返回每文件统计 + 总和 + 中位字符数。",
  },
  {
    id: "workspace_edit",
    name: "局部编辑",
    description:
      "对文本做局部替换、插入、追加或前置；适合改 md/txt，不需要整份重写。",
  },
  {
    id: "workspace_write",
    name: "写入文本",
    description:
      "向已有文本文件追加或覆盖内容；可先创建空文件，再用 append 或 replace 写入正文。",
  },
  {
    id: "workspace_json",
    name: "JSON 数据",
    description:
      "按 JSON Pointer 概览、搜索、读取、创建或局部更新 JSON；适合维护状态文件、改字段、补模板、追加历史和批量 patch。",
  },
  {
    id: "workspace_path",
    name: "路径操作",
    description:
      "创建文件或文件夹、重命名、迁移路径；只处理结构，不负责正文内容。",
  },
  {
    id: "workspace_delete",
    name: "删除路径",
    description:
      "删除工作区中的文件或文件夹；高风险操作，通常只在用户明确要求时使用。",
  },
  {
    id: "skill_read",
    name: "读取技能",
    description:
      "列出、读取本地 skill 文件和参考文件；优先先列出再读写具体文件。",
  },
  {
    id: "skill_manage",
    name: "管理技能",
    description:
      "创建、更新、删除本地 skill 文件；用于维护技能资源，不用于常规写作内容。",
  },
];

export const ALL_TOOL_DEFS: ToolDef[] = [...BUILTIN_TOOLS];

const TOOL_IDS = new Set(BUILTIN_TOOLS.map((tool) => tool.id));

/** 返回默认全部启用的工具映射 */
export function getDefaultEnabledTools(): Record<string, boolean> {
  return Object.fromEntries(BUILTIN_TOOLS.map((t) => [t.id, true]));
}

export function migrateEnabledTools(
  enabledTools?: Record<string, boolean> | null,
) {
  const defaults = getDefaultEnabledTools();
  if (!enabledTools) {
    return defaults;
  }

  return Object.fromEntries(
    BUILTIN_TOOLS.map((tool) => [
      tool.id,
      typeof enabledTools[tool.id] === "boolean" ? enabledTools[tool.id] : true,
    ]),
  );
}

export function normalizeSuggestedToolIds(toolIds: string[]) {
  return Array.from(new Set(toolIds.filter((toolId) => TOOL_IDS.has(toolId))));
}
