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
    id: "ask",
    name: "询问用户",
    description:
      "在运行过程中向用户发起单选或多选问题；工具会自动附带“用户输入”选项，并在用户确认后继续当前轮。",
  },
  {
    id: "todo",
    name: "待办计划",
    description:
      "更新当前会话的显式计划状态；参数使用 items 数组；同一时间最多保留一个进行中的步骤；可选 phase 字段标记长链路阶段。",
  },
  {
    id: "mode_control",
    name: "模式控制",
    description:
      "向应用提交当前模式的结构化流程控制信号；YOLO 目标完成时用 action=complete，后续可扩展阻塞、继续等模式控制语义。",
  },
  {
    id: "task",
    name: "临时子任务",
    description:
      "按需创建一次性 subagent，在独立上下文中执行局部任务；可直接传入角色、职责和补充指令，无需预装代理。",
  },
  {
    id: "browse",
    name: "浏览工作区",
    description:
      "浏览目录树、列出文件夹内容或查看路径概况；适合先了解结构，再决定读哪个文件。",
  },
  {
    id: "search",
    name: "搜索内容",
    description:
      "搜索文件夹名、文件名和正文内容；适合定位关键词、章节、设定或数据字段。",
  },
  {
    id: "web_search",
    name: "网络搜索",
    description:
      "搜索公开网络信息并返回标题、摘要和链接；适合补充外部资料、平台规则和最新公开网页内容。",
  },
  {
    id: "web_fetch",
    name: "网页读取",
    description:
      "读取指定网页正文并提取标题和主要文本；适合在搜索后继续展开阅读具体内容。",
  },
  {
    id: "fanqie_leaderboard",
    name: "番茄排行榜",
    description:
      "读取番茄小说排行榜；支持男频/女频、阅读榜/新书榜、分类/总榜、具体排名或排名范围，返回书名、简介、在读数、排行变化等结构化信息。",
  },
  {
    id: "read",
    name: "读取文件",
    description:
      "读取文本文件全文或局部行段；已知准确路径时使用，未知路径先 browse 或 search。",
  },
  {
    id: "word_count",
    name: "字数统计",
    description:
      "统计文本文件字符/中文/英文/段落等指标。支持单文件 path、多文件 paths、目录递归 dir 三种模式；批量返回每文件统计 + 总和 + 中位字符数。",
  },
  {
    id: "canon_query",
    name: "Canon 查询",
    description:
      "按人物、地点、伏笔、能力边界或章节线索查询 .project/canon、status、style、chapters 等长篇事实源。",
  },
  {
    id: "edit",
    name: "局部编辑",
    description:
      "对文本做局部替换、插入、追加或前置；适合改 md/txt，不需要整份重写。",
  },
  {
    id: "create",
    name: "创建空文件",
    description:
      "创建一个空白文本文件；只负责建文件，不写内容。新章节或新资料文件先 create，再用 write append 分段写入。",
  },
  {
    id: "write",
    name: "写入文本",
    description:
      "向已有文本文件追加或覆盖内容；默认 append 追加，适合长正文分段落盘。新文件必须先用 create 创建空文件。",
  },
	  {
	    id: "json",
	    name: "JSON 数据",
	    description:
	      "按 JSON Pointer 概览、搜索、读取、创建或局部更新 JSON；适合维护状态文件、改字段、补模板、追加历史和批量 patch。",
	  },
  {
    id: "path",
    name: "路径操作",
    description:
      "创建文件或文件夹、重命名、迁移或删除路径；只处理结构，不负责正文内容。",
  },
  {
    id: "skill",
    name: "技能资源",
    description:
      "列出、读取、创建、更新或删除本地 skill 文件；优先先列出再读写具体文件。",
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
