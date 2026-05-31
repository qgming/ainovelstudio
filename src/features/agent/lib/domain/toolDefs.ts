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
      "向用户提出单选或多选问题并等待选择；工具会自动附带“用户输入”选项，收到答案后继续当前轮。仅在需求模糊且不同选择会显著影响结果时使用。",
  },
  {
    id: "update_plan",
    name: "更新计划",
    description:
      "更新当前会话的多步计划清单；参数用 items 数组，同一时间最多保留一个进行中步骤，可选 phase 字段标记长链路阶段。≥3 步任务使用。",
  },
  {
    id: "yolo_control",
    name: "YOLO 检查",
    description:
      "YOLO 模式每轮结束时上报 complete、continue 或 blocked，明确控制自动循环是否结束；不能用纯文本代替。",
  },
  {
    id: "workspace_browse",
    name: "浏览工作区",
    description:
      "浏览目录结构、列出文件夹内容或查看路径状态，不读正文；适合先了解结构再决定读哪个文件。已知关键词用搜索工作区，已知准确文件用读取。",
  },
  {
    id: "workspace_search",
    name: "搜索工作区",
    description:
      "语义检索工作区事实源和正文证据，按相关度返回适合 AI 推理的上下文片段；适合了解角色、设定、章节、伏笔、当前状态或数据字段。要精确匹配某个名字/术语用精确匹配。",
  },
  {
    id: "workspace_grep",
    name: "精确匹配",
    description:
      "按字面量或正则精确匹配文件内容，返回命中文件、行号和该行文本（可带上下文）；适合找某角色名/术语的全部出现、查错别字、定位改写锚点。语义找相关证据用搜索工作区。",
  },
  {
    id: "web_search",
    name: "网络搜索",
    description:
      "搜索公开网络并返回标题、摘要和链接；适合补充外部资料、平台规则和最新公开网页内容。拿到链接后用网页读取精读。",
  },
  {
    id: "web_read",
    name: "网页读取",
    description:
      "读取一个已知网址的网页正文并提取标题和主要文本；适合在搜索后继续展开阅读具体内容。",
  },
  {
    id: "leaderboard",
    name: "小说排行榜",
    description:
      "读取番茄小说四大主榜的书单、单本简介或题材统计；书单默认不含简介，简介需按作品单独读取。",
  },
  {
    id: "workspace_read",
    name: "读取工作区文件",
    description:
      "读取已知路径的文本文件正文或局部行段；未知路径先浏览或搜索。full 整文件返回，超约 6000 字符会被截断，大文件用 head/tail/range 分段读。",
  },
  {
    id: "text_stats",
    name: "文本统计",
    description:
      "统计文本文件的字数、中文字符、英文单词、段落等指标。支持单文件 path、多文件 paths、目录递归 dir 三种模式；批量返回每文件统计、总和与中位字符数。",
  },
  {
    id: "workspace_edit",
    name: "局部编辑",
    description:
      "对已有文本文件做局部替换、插入或追加；适合改 md/txt 的少量内容，不需要整份重写。创建全新文件用写入文本。",
  },
  {
    id: "workspace_write",
    name: "写入文本",
    description:
      "创建空白文本文件，或对已有文件整体追加、覆盖写入；改局部内容用局部编辑，写 JSON 用 JSON 数据。",
  },
  {
    id: "workspace_json",
    name: "JSON 数据",
    description:
      "读写 JSON 文件的首选工具，按 JSON Pointer 概览、搜索、读取、创建或局部更新；优先 set、merge、append、patch，不随意整文件覆盖。适合维护状态文件、改字段、补模板、追加历史。",
  },
  {
    id: "workspace_path",
    name: "路径操作",
    description:
      "只创建文件夹、重命名、移动或删除路径结构，不写文件内容；删除走 action=delete，属高风险操作，通常只在用户明确要求时使用。",
  },
  {
    id: "workspace_relation",
    name: "文件关联",
    description:
      "管理工作区文件之间的无向多对多关联；list 列出某文件全部关联，create 建关联（带关系标签如“出场人物”和可选备注），update 改标签/备注，delete 删关联边。改 relationId 前先 list 取 id。",
  },
  {
    id: "skill_read",
    name: "读取技能",
    description:
      "列出本地技能或读取技能的 SKILL 与参考文件；优先先列出再读具体文件。",
  },
  {
    id: "skill_manage",
    name: "管理技能",
    description:
      "创建、写回或删除本地技能文件；用于维护技能资源，不用于常规写作内容。",
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
