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
    id: "todo",
    name: "待办计划",
    description:
      "更新当前会话的显式计划状态；同一时间最多保留一个进行中的步骤。",
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
      "读取指定文本文件并返回字符数、非空白字符数、汉字数、英文单词数、数字数、段落数和行数。",
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
      "按 JSON Pointer 读取或局部更新 JSON 内容；适合改字段、合并对象、删除键和追加数组项。",
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
