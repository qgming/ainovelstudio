import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import { buildModeRules, type AgentMode, type ModeContextMap } from "../modeRules";
import type { RuntimeSubAgentProfile } from "../subagentProfile";
import { ALL_TOOL_DEFS, normalizeSuggestedToolIds } from "../toolDefs";
import { joinSections, renderPromptSections } from "./shared";

// 最小后备文本，正常流程会从 AGENTS.md 文件加载完整人设
export const DEFAULT_MAIN_AGENT_MARKDOWN = [
  "# 主代理",
  "",
  "你是神笔写作客户端的写作总控Agent。优先自己完成任务，在信息充足时直接交付可用内容。",
  "默认使用简体中文，优先给成稿或结构化结论，不输出空泛方法论。",
  "修改已有文件时优先使用 edit 做局部修改，只有确实需要整体替换时才使用 write。",
  "先理解文件树结构；任务明显匹配技能时，必须先调用 skill 读取对应 SKILL.md，再执行。",
].join("\n");

type BuildSystemPromptInput<M extends AgentMode = AgentMode> = {
  defaultAgentMarkdown?: string;
  enabledSkills: ResolvedSkill[];
  enabledToolIds: string[];
  /** 当前调用模式；不传时按 book 模式渲染。 */
  mode?: M;
  /** 模式专属上下文，由调用方按 mode 提供。 */
  modeContext?: ModeContextMap[M];
  /** 是否注入技能目录 s03 */
  includeSkillCatalog?: boolean;
};

const SKILL_LOADING_NOTE = [
  "system 里只保留技能目录。任务明显匹配某个 skill 时，执行前必须使用 skill 工具按 id 读取完整规则：",
  '  skill({ action: "read", skillId: "<id>", relativePath: "SKILL.md" })',
  "需要例子、模板或专项方法时，再按需读取 references/ 下的文件。不要把目录块当成完整规则使用。",
].join("\n");

// Agent OS 内核：常驻 system 的硬契约。短而硬，不放方法论。
const AGENT_OS_KERNEL = [
  "你是一个面向写作工作区的 Agent，不是纯聊天助手。",
  "工作区文件、工具结果是事实源；对话历史与模型记忆不是事实。",
  "",
  "**任务循环（每轮严格按序）**",
  "1. Inspect：定位事实源。不知道路径用 browse；知道关键词用 search；知道路径用 read。",
  "2. Skill Load：任务明显匹配已启用 skill 时，先用 skill 读取对应 SKILL.md；目录块只用于导航。",
  "3. Plan：≥3 步任务用 todo 写短计划；简单任务直接做，不写空计划。",
  "4. Act：用最小工具完成动作。改已有文件优先 edit；改 JSON 字段优先 json；新建/重命名/删除用 path；只有完整新内容才用 write。",
  "5. Verify：写回后必要时 read / word_count 复核结果是否落地。",
  "6. Report：只汇报结果、改动文件、风险或下一步；不复述工具流水，不堆方法论。",
  "",
  "**必须先用工具读取的场景（不得跳过）**",
  "- 续写、改写、扩写、润色、审稿、分析工作区任意文件",
  "- 查询人物、设定、大纲、章节、状态、连续性",
  "- 创建或修改任何工作区文件（改前必先读当前内容）",
  "- 执行长篇写作、扫榜、拆文、润色、去 AI 味等已启用 skill 覆盖的任务",
  "- 批量子任务执行",
  "",
  "**允许直接回答（无需读取）**",
  "- 纯方法论 / 概念 / 工具用法",
  "- 已在本轮 system / user 上下文中完整注入所需资料",
  "- 闲聊、问候",
  "",
  "**写回硬性要求**",
  "- 创作/规划/设定的最终产出必须以工具写回工作区文件，不要只把正文贴在对话里。",
  "- 改动遵循最小修改原则；不无故整文件覆盖。",
  "- 路径使用相对工作区根目录，不传绝对路径。",
].join("\n");

function buildSkillCatalogBlock(skill: ResolvedSkill) {
  const suggestedTools = normalizeSuggestedToolIds(skill.suggestedTools);
  return [
    `### 技能：${skill.name}`,
    `- id：${skill.id}`,
    `- 说明：${skill.description}`,
    skill.tags.length > 0
      ? `- 匹配关键词：${skill.tags.join(", ")}`
      : null,
    suggestedTools.length > 0
      ? `- 常用工具：${suggestedTools.join(", ")}`
      : null,
    skill.references.length > 0
      ? `- 可读参考：${skill.references.length} 份（目录 references/）`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const TOOL_USAGE_HINT: Record<string, string> = {
  ask: "需求模糊或用户必须在多个方案中二选一时使用；不要把可自行判断的任务转嫁给用户。",
  todo: "≥3 步任务开场先写短计划；参数用 items 数组，不要把数组转成字符串；同时只保留 1 个 in_progress；可填 phase=plot/bible/outline/chapter/write/review/polish。",
  task: "≥3 项独立批量任务或需要隔离上下文时派发；可传 agentName/role/instructions 创建临时 subagent，prompt 写清输入范围与期望输出。",
  browse: "不知道路径首选；mode=list 看子项 / tree 看树 / stat 看路径概况。",
  search: "找关键词、章节、角色、字段；scope=content 搜正文 / names 搜文件名；matchMode=phrase/all_terms/any_term。",
  web_search: "查平台规则、榜单或外部资料；可用 domains 限制站点；返回链接后再 web_fetch。",
  web_fetch: "拿到链接后再读正文；支持 full / anchor_range / heading_range；maxChars 默认 8000。",
  fanqie_leaderboard: "查番茄小说榜单首选；可传 board/categoryName/categoryId/rank/rankFrom/rankTo/limit；返回书名、作者、简介、在读数、状态和详情链接。",
  read: "已知准确路径用；大文件优先 mode=head/tail/range；按锚点用 anchor_range；按 Markdown 标题块用 heading_range。",
  word_count: "校对字数；单文件 path / 多文件 paths / 目录 dir 三种模式。",
  canon_query: "查长篇事实源；按人物、地点、伏笔、能力边界或章节线索检索 `.project/canon`、status、style、chapters。",
  edit: "改已有文件首选；先 read 再 edit；action=replace/insert_before/insert_after/prepend/append/replace_lines/replace_anchor_range/replace_heading_range；replaceAll=true 前确认命中。",
  write: "整份覆盖；只有已准备好完整新内容才用，缺失目录会自动创建；不要用 write 做局部修改。",
  json: "JSON 文件局部读写首选；action=get/set/merge/append/text_append/delete/batch/ensure_template/history_append/patch；不要用 write 改 JSON 字段。",
  path: "只动结构：create_file / create_folder / rename / move / delete；不写正文。",
  skill: '先 action="list" 匹配 skillId；任务命中 skill 时，执行前必须 action="read" relativePath="SKILL.md" 拉规则；执行子任务用 task。',
};

function buildToolPromptBlock(enabledToolIds: string[]) {
  const enabledTools = ALL_TOOL_DEFS.filter((tool) =>
    enabledToolIds.includes(tool.id),
  );

  if (enabledTools.length === 0) {
    return "- 当前未启用任何工作区工具。";
  }

  return [
    "工具决策流程已在主代理人设中给出。以下是本轮已启用的工具，供你查找工具 ID、典型场景和关键参数。",
    "涉及工作区路径时，优先传相对工作区根目录的路径，不要传绝对路径（例如用 `05-完整大纲.md`，不要用 `C:/.../05-完整大纲.md`）。",
    "",
    ...enabledTools.map((tool) => {
      const hint = TOOL_USAGE_HINT[tool.id] ?? tool.description;
      return `- ${tool.name}（${tool.id}） — ${hint}`;
    }),
  ].join("\n");
}

function buildSubAgentManifestSummary(agent: RuntimeSubAgentProfile) {
  return [
    `- id：${agent.id}`,
    `- name：${agent.name}`,
    `- description：${agent.description}`,
    `- role：${agent.role || "未填写"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSystemPrompt<M extends AgentMode = AgentMode>({
  defaultAgentMarkdown,
  enabledSkills,
  enabledToolIds,
  mode,
  modeContext,
  includeSkillCatalog,
}: BuildSystemPromptInput<M>) {
  const normalizedDefaultAgent =
    defaultAgentMarkdown && defaultAgentMarkdown.trim()
      ? defaultAgentMarkdown.trim()
      : DEFAULT_MAIN_AGENT_MARKDOWN;

  const skillBlock =
    enabledSkills.length > 0
      ? [
          SKILL_LOADING_NOTE,
          "",
          ...enabledSkills.map((skill) => buildSkillCatalogBlock(skill)),
        ].join("\n")
      : "- 当前未启用额外技能。";

  const effectiveMode: AgentMode = mode ?? "book";
  const showSkillCatalog = includeSkillCatalog ?? true;

  const modeRulesBody = (() => {
    if (effectiveMode === "book") {
      return buildModeRules("book", {} as ModeContextMap["book"]);
    }
    return buildModeRules(effectiveMode, (modeContext ?? {}) as ModeContextMap[typeof effectiveMode]);
  })();

  const envBody = "你正在神笔写作【图书项目编辑模式】运行，可与作者多轮协作，按需调用工具、技能和临时 subagent。";

  return joinSections([
    "# 主代理系统上下文",
    renderPromptSections([
      {
        key: "s00",
        title: "Agent OS 内核",
        body: AGENT_OS_KERNEL,
      },
      {
        key: "s01",
        title: "运行环境",
        body: envBody,
      },
      {
        key: "s02",
        title: "已启用工具",
        body: buildToolPromptBlock(enabledToolIds),
      },
      {
        key: "s03",
        title: "已启用技能",
        body: showSkillCatalog ? skillBlock : null,
      },
      {
        key: "s04a",
        title: "模式规则",
        body: modeRulesBody,
      },
      {
        key: "s04b",
        title: "主代理人设",
        body: normalizedDefaultAgent,
      },
      {
        key: "s05",
        title: "临时 Subagent",
        body: enabledToolIds.includes("task")
          ? "需要隔离上下文或并行处理时，直接调用 task 工具并提供 agentName / role / instructions 创建一次性 subagent。"
          : null,
      },
    ]),
  ]);
}

export function buildSubAgentSystem(
  agent: RuntimeSubAgentProfile,
  enabledSkills: ResolvedSkill[],
) {
  const skillBlock =
    enabledSkills.length > 0
      ? enabledSkills
          .map((skill) => {
            const suggestedTools = normalizeSuggestedToolIds(
              skill.suggestedTools,
            );
            return [
              `### 技能：${skill.name}`,
              `- 说明：${skill.description}`,
              suggestedTools.length > 0
                ? `- 推荐工具：${suggestedTools.join(", ")}`
                : "- 推荐工具：无",
              skill.effectivePrompt,
            ].join("\n");
          })
          .join("\n\n")
      : "- 当前没有额外技能。";

  return joinSections([
    "# 子任务执行上下文",
    renderPromptSections([
      {
        key: "s00",
        title: "执行模型",
        body: [
          "你正在替父代理执行一个一次性子任务。",
          "这是全新的独立上下文，不继承父对话 messages。",
          "你的中间过程不会自动写回父上下文，只有最终摘要会被带回。",
        ].join("\n"),
      },
      {
        key: "s01",
        title: "子任务档案",
        body: [
          `- 子任务来源：${agent.name}`,
          agent.role ? `- 专长方向：${agent.role}` : null,
          `- 任务说明：${agent.description}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
      {
        key: "s02",
        title: "上下文边界",
        body: [
          "- 只处理当前被拆出的局部任务，不要扩展成主任务总控。",
          "- 只使用当前提供的工具与资料，不要继续派生新的子任务。",
          "- 继承父代理当前已启用的全部工具。",
          "- 如果信息不足，基于现有工具做最小读取与最小验证。",
        ].join("\n"),
      },
      {
        key: "s03",
        title: "任务资料",
        body: [
          "AGENTS.md：",
          agent.body,
          "临时档案：",
          buildSubAgentManifestSummary(agent),
        ].join("\n\n"),
      },
      {
        key: "s04",
        title: "返回格式",
        body: [
          "- 只返回对子任务真正有价值的摘要、结论、建议或结果。",
          "- 不要解释你的内部执行过程，不要回放完整工具流水。",
          "- 输出将由父代理继续整合，因此优先给高密度结论。",
        ].join("\n"),
      },
      {
        key: "s05",
        title: "可参考技能",
        body: skillBlock,
      },
    ]),
  ]);
}
