/** 内置工具元数据定义，设置页和 session 共用 */
export type ToolDef = {
  /** 工具唯一标识，与 tools.ts 中的 key 一致 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 设置页和 prompt 使用的简短描述 */
  description: string;
  /** 归属场景 */
  scope?: "global" | "expansion" | "workflow";
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
      "更新当前会话的显式计划状态；同一时间最多保留一个进行中的步骤；可选 phase 字段标记长链路阶段。",
  },
  {
    id: "task",
    name: "子任务派发",
    description: "将局部任务派发给子代理在独立上下文中执行，并返回摘要结果。",
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
    id: "edit",
    name: "局部编辑",
    description:
      "对文本做局部替换、插入、追加或前置；适合改 md/txt，不需要整份重写。",
  },
  {
    id: "write",
    name: "整文件写入",
    description:
      "整文件覆盖写入；适合你已经准备好完整内容时使用，缺失目录会自动创建。",
  },
  {
    id: "json",
    name: "JSON 数据",
    description:
      "按 JSON Pointer 读取或局部更新 JSON 内容；适合改字段、补齐模板、向字符串或数组追加内容、执行 patch 和维护状态数组。",
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
  {
    id: "agent",
    name: "代理资源",
    description:
      "列出、读取、创建、更新或删除本地 agent 文件；优先先列出再读写具体文件。",
  },
];

export const EXPANSION_MODE_TOOLS: ToolDef[] = [
  {
    id: "expansion_chapter_batch_outline",
    name: "批量生成章节结构",
    description:
      "根据项目大纲批量创建章节 JSON，并写入摘要、细纲、场景节拍、开篇状态和结尾状态。",
    scope: "expansion",
  },
  {
    id: "expansion_chapter_write_content",
    name: "章节正文写入",
    description:
      "按章节 ID 或路径按字段替换或追加正文/细纲，未传入的字段保持原值。",
    scope: "expansion",
  },
  {
    id: "expansion_setting_batch_generate",
    name: "批量生成设定",
    description:
      "批量创建设定 JSON，并维护核心档案、当前状态、公开信息、秘密和约束规则。",
    scope: "expansion",
  },
  {
    id: "expansion_setting_update_from_chapter",
    name: "按章节更新设定",
    description:
      "根据章节推进结果更新设定的当前状态、关系、公开信息、秘密和来源章节。",
    scope: "expansion",
  },
    {
      id: "expansion_continuity_scan",
      name: "连续性扫描",
      description:
        "扫描章节编号冲突，输出结构化问题列表。",
      scope: "expansion",
    },
];

export const WORKFLOW_MODE_TOOLS: ToolDef[] = [
  {
    id: "workflow_decision",
    name: "工作流判断提交",
    description:
      "向工作流判断节点提交结构化判定结果，程序会依据该结果选择通过或返工分支。",
    scope: "workflow",
  },
];

export const ALL_TOOL_DEFS: ToolDef[] = [
  ...BUILTIN_TOOLS,
  ...EXPANSION_MODE_TOOLS,
  ...WORKFLOW_MODE_TOOLS,
];

const LEGACY_TOOL_ID_MAP: Record<string, string> = {
  create_file: "path",
  create_folder: "path",
  delete_path: "path",
  line_edit: "edit",
  list_agents: "agent",
  list_skills: "skill",
  move_path: "path",
  read_agent_file: "agent",
  read_file: "read",
  read_skill_file: "skill",
  read_workspace_tree: "browse",
  rename: "path",
  search_workspace_content: "search",
  write_file: "write",
};

function mergeLegacyToolPreferences(
  enabledTools: Record<string, boolean>,
  toolId: string,
) {
  const directValue = enabledTools[toolId];
  if (typeof directValue === "boolean") {
    return directValue;
  }

  const legacyValues = Object.entries(LEGACY_TOOL_ID_MAP)
    .filter(([, nextToolId]) => nextToolId === toolId)
    .map(([legacyToolId]) => enabledTools[legacyToolId])
    .filter((value): value is boolean => typeof value === "boolean");

  if (legacyValues.length === 0) {
    return true;
  }

  if (legacyValues.every((value) => value === false)) {
    return false;
  }

  return true;
}

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
      mergeLegacyToolPreferences(enabledTools, tool.id),
    ]),
  );
}

export function normalizeSuggestedToolId(toolId: string) {
  return LEGACY_TOOL_ID_MAP[toolId] ?? toolId;
}

export function normalizeSuggestedToolIds(toolIds: string[]) {
  return Array.from(
    new Set(toolIds.map((toolId) => normalizeSuggestedToolId(toolId))),
  );
}
