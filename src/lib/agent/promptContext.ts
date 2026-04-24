import type { ResolvedSkill } from "../../stores/skillsStore";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import type { ManualTurnContextPayload } from "./manualTurnContext";
import type { ProjectContextPayload } from "./projectContext";
import {
  renderPlanItems,
  type PlanningIntervention,
  type PlanningState,
} from "./planning";
import { ALL_TOOL_DEFS, normalizeSuggestedToolIds } from "./toolDefs";

// 最小后备文本，正常流程会从 AGENTS.md 文件加载完整人设
export const DEFAULT_MAIN_AGENT_MARKDOWN = [
  "# 主代理",
  "",
  "你是神笔写作客户端的写作总控Agent。优先自己完成任务，在信息充足时直接交付可用内容。",
  "默认使用简体中文，优先给成稿或结构化结论，不输出空泛方法论。",
  "修改已有文件时优先使用 edit 做局部修改，只有确实需要整体替换时才使用 write。",
  "先理解文件树结构；任务明显匹配技能时，主动调用 skill 获取专项规则和材料。",
].join("\n");

type BuildSystemPromptInput = {
  defaultAgentMarkdown?: string;
  enabledAgents: ResolvedAgent[];
  enabledSkills: ResolvedSkill[];
  enabledToolIds: string[];
  includeAgentCatalog?: boolean;
};

type BuildUserTurnContentInput = {
  activeFilePath: string | null;
  manualContext?: ManualTurnContextPayload | null;
  planningIntervention?: PlanningIntervention | null;
  planningState?: PlanningState | null;
  projectContext?: ProjectContextPayload | null;
  workspaceRootPath?: string | null;
  prompt: string;
  subagentAnalysis?: {
    agentName: string;
    text: string;
  } | null;
};

type PromptSection = {
  body: string | null | undefined;
  key: string;
  title: string;
};

type TaskProfile = {
  caution: string;
  label: string;
  outputHint: string;
};

const SKILL_LOADING_NOTE = [
  "system 里只保留技能目录。匹配到某个 skill 后，使用 skill 工具按 id 读取完整规则：",
  '  skill({ action: "read", skillId: "<id>", relativePath: "SKILL.md" })',
  "再按需读取 references/ 下的文件。不要把目录块当成完整规则使用。",
].join("\n");
const MANUAL_CONTEXT_FILE_CHAR_LIMIT = 6_000;
const MANUAL_CONTEXT_TOTAL_CHAR_LIMIT = 12_000;

function formatCurrentSystemDate(now = new Date()) {
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
}

function joinSections(sections: Array<string | null | undefined>) {
  return sections
    .filter((section): section is string => Boolean(section?.trim()))
    .join("\n\n");
}

function renderPromptSections(sections: PromptSection[]) {
  return sections
    .filter((section) => Boolean(section.body?.trim()))
    .map((section) =>
      [`## ${section.key} ${section.title}`, section.body?.trim()]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

function createMiddleExcerpt(value: string, maxChars: number) {
  const normalized = value.trim();
  if (normalized.length <= maxChars) {
    return {
      omittedChars: 0,
      text: normalized,
      truncated: false,
    };
  }

  if (maxChars < 600) {
    return {
      omittedChars: normalized.length - maxChars,
      text: `${normalized.slice(0, maxChars).trimEnd()}…`,
      truncated: true,
    };
  }

  const headChars = Math.max(Math.floor(maxChars * 0.72), maxChars - 900);
  const tailChars = Math.max(maxChars - headChars, 320);
  return {
    omittedChars: normalized.length - maxChars,
    text: [
      normalized.slice(0, headChars).trimEnd(),
      "…（中间省略）…",
      normalized.slice(-tailChars).trimStart(),
    ].join("\n"),
    truncated: true,
  };
}

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

function buildAgentCatalogBlock(agent: ResolvedAgent) {
  return [
    `### 子代理：${agent.name}`,
    `- id：${agent.id}`,
    `- 来源：${agent.sourceLabel}`,
    agent.role ? `- 角色：${agent.role}` : null,
    `- 说明：${agent.description}`,
    agent.dispatchHint ? `- 适用时机：${agent.dispatchHint}` : null,
    agent.tags.length > 0 ? `- 匹配标签：${agent.tags.join(", ")}` : null,
    `- 派发方式：task({ agentId: "${agent.id}", prompt: "..." })`,
    "- 工具权限：继承当前主会话已启用的全部工具。",
  ]
    .filter(Boolean)
    .join("\n");
}

const TOOL_USAGE_HINT: Record<string, string> = {
  todo: "多步任务（≥3 步）开场写短计划；同一时间只保留一个 in_progress，允许整份重写。",
  task: "批量独立任务 ≥3 项或需隔离上下文时派发；prompt 写清输入范围与期望输出，可传 agentId 指定目标。",
  browse: "不知道路径时首选；mode：list（默认）看子项、stat 看路径概况、tree 拿裁剪后的目录树；list 可配 kind、extensions、sortBy、limit。",
  search: "找关键词/章节/角色/字段；scope：all / content / names；matchMode：phrase / all_terms / any_term；可用 extensions、caseSensitive、wholeWord、maxPerFile、beforeLines / afterLines、sortBy 精细控制。",
  web_search: "查平台规则、榜单、外部资料；可配 domains 限制站点范围；返回标题+摘要+链接，再用 web_fetch 展开正文。",
  web_fetch: "拿到外部链接后读正文；支持 full / anchor_range / heading_range；需要结构化信息时加 includeLinks / includeTables；maxChars 默认 8000，最大 20000。",
  read: "已知准确路径时使用；大文件优先 mode=head/tail/range；按锚点读局部用 anchor_range；按 Markdown 标题块读取用 heading_range。",
  word_count: "校对字符数、中文字符数、英文词数、段落数、行数。",
  edit: "小范围改（≤30%）；先 read 再 edit；action：replace/insert_before/insert_after/prepend/append/replace_lines/replace_anchor_range/replace_heading_range；replaceAll=true 前确认命中范围；改连续行段优先用 replace_lines；改锚点附近或 Markdown 标题块优先用对应 range 动作。",
  write: "整份覆盖写入；只有已准备好完整新内容时再用，缺失目录会自动创建。",
  json: "按 JSON Pointer 局部读写字段/对象/数组；action：get/set/merge/append/delete/batch/ensure_template/history_append/patch；初始化补结构优先 ensure_template，写日志优先 history_append，多步变更优先 batch 或 patch，一次写回。",
  path: "只动结构：create_file / create_folder / rename / move / delete；不写入正文。",
  skill: '读/管理本地 skill。先 action="list" 匹配 skillId，再 action="read" relativePath="SKILL.md" 拉规则；writes 改 skill 内文件。',
  agent: 'action：list/read/write/create/delete；读写 agent 内文件（manifest.json / AGENTS.md）；执行子任务请用 task，不是 agent。',
  expansion_chapter_batch_outline:
    "扩写模式批量建章工具；可用 volumeId 指定目标分卷，输入 chapters 数组可直接批量写 chapters/<volumeId>/*.json，章节字段只使用 id、name、outline、content、notes、linkedSettingIds；缺省时会尝试从项目大纲推断章节标题。",
  expansion_chapter_write_content:
    "扩写模式正文写回工具；按 chapterId 或 chapterPath 定位章节，写入 content，并可同步补充 outline、notes、linkedSettingIds。",
  expansion_setting_batch_generate:
    "扩写模式批量建设定工具；传 settings 数组批量生成 settings/*.json，设定字段只使用 id、name、content、notes、linkedChapterIds。",
  expansion_setting_update_from_chapter:
    "扩写模式设定更新工具；根据章节推进结果批量更新设定 content、notes、linkedChapterIds，并支持顺手创建新设定。",
  expansion_continuity_scan:
    "扩写模式连续性检查工具；扫描章节 id、章节引用和设定引用，输出结构化 issues 列表，适合写作前后做一致性校验。",
  workflow_decision:
    "工作流判断节点专用；提交 approve / reject / retry 等结构化结果和理由，让工作流程序据此流转到下一分支。",
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

function buildPlanningStateBlock(planningState?: PlanningState | null) {
  if (!planningState || planningState.items.length === 0) {
    return null;
  }

  return [
    `- 连续未更新轮数：${planningState.roundsSinceUpdate}`,
    "当前计划：",
    renderPlanItems(planningState.items),
  ].join("\n");
}

function buildPlanningInterventionBlock(
  planningIntervention?: PlanningIntervention | null,
) {
  if (!planningIntervention) {
    return null;
  }

  if (planningIntervention.reason === "stale_plan") {
    return "提醒：当前计划已经连续几轮没有更新，可能与当前执行不再一致。继续前请先用 todo 刷新当前短计划。";
  }

  return "提醒：本轮请求看起来包含多个步骤。继续执行前，请先用 todo 写出当前短计划，并在完成关键步骤后及时更新。";
}

function inferTaskProfile(prompt: string): TaskProfile {
  if (/(续写|扩写|补写|写一段|写一章|正文|场景|scene|chapter)/i.test(prompt)) {
    return {
      label: "创作/续写",
      outputHint: "优先给可直接使用的正文内容，再补极简说明。",
      caution:
        "开始前必先读上一章正文、对应场景规划与人物资料；不要凭空改动既有设定；连续性敏感处优先核对人物、时态与剧情事实。",
    };
  }

  if (/(润色|改写|重写|精修|压缩|降重|优化表达|优化文风)/i.test(prompt)) {
    return {
      label: "改写/润色",
      outputHint: "优先给修改后文本，必要时再附简短修改说明。",
      caution: "改前必先 read 目标文件当前原文，不要凭印象改；默认保留原意、信息量与文风，不要无故重置结构或删掉有效细节。",
    };
  }

  if (
    /(大纲|设定|世界观|人物卡|角色卡|策划|规划|拆纲|outline|plot|节拍)/i.test(
      prompt,
    )
  ) {
    return {
      label: "设定/规划",
      outputHint: "优先给结构化方案，如大纲、设定条目、角色卡或步骤清单。",
      caution: "开始前必先 browse 工作区并 read 已有大纲、人物、设定；保持内部逻辑闭环，避免设定互相冲突或只有概念没有落地细节。",
    };
  }

  if (/(审稿|点评|评审|review|打分|找问题|挑错)/i.test(prompt)) {
    return {
      label: "审稿/评估",
      outputHint: "优先给问题与结论，再给修改建议或风险排序。",
      caution: "开始前必先 read 被审对象的正文与相关设定；聚焦真实问题，不要用空泛表扬稀释判断。",
    };
  }

  if (/(分析|总结|梳理|解释|诊断|节奏|冲突|主题|动机)/i.test(prompt)) {
    return {
      label: "分析/诊断",
      outputHint: "优先给结论、结构化观察和依据，避免先讲泛泛方法。",
      caution: "开始前必先 read 被分析对象的正文或资料；基于已读内容推断，未读取的情节与设定不要当成事实引用。",
    };
  }

  if (/(翻译|translate|本地化)/i.test(prompt)) {
    return {
      label: "翻译/转写",
      outputHint: "优先给译文或转换结果，必要时补充少量术语说明。",
      caution: "翻译前必先 read 源文件全文；注意语气、叙述视角和专有名词的一致性。",
    };
  }

  return {
    label: "通用协作",
    outputHint: "优先给最接近用户目标的可执行结果或下一步动作。",
    caution: "如涉及工作区内容，先用 browse/search/read 读相关文件再继续，不要假设未见内容。",
  };
}

function inferFileKind(activeFilePath: string | null) {
  if (!activeFilePath) {
    return "未指定";
  }

  if (/(章|chapter|scene|正文|draft)/i.test(activeFilePath)) {
    return "章节/正文稿件";
  }

  if (/(大纲|outline|plot|beats|storyline)/i.test(activeFilePath)) {
    return "大纲/剧情规划";
  }

  if (/(设定|人物|角色|世界观|资料|wiki|notes)/i.test(activeFilePath)) {
    return "设定/资料文档";
  }

  return "通用工作区文件";
}

function buildManualContextBlock(
  manualContext?: ManualTurnContextPayload | null,
) {
  if (!manualContext) {
    return null;
  }

  const blocks: string[] = [];

  if (manualContext.skills.length > 0) {
    blocks.push(
      [
        "### 手动指定技能",
        ...manualContext.skills.map(
          (skill) => `- ${skill.name}：${skill.description}`,
        ),
        "- 这些 skill 当前仅以目录信息注入；需要完整步骤时，请再读取对应 SKILL.md。",
      ].join("\n"),
    );
  }

  if (manualContext.agents.length > 0) {
    blocks.push(
      [
        "### 手动指定子代理",
        ...manualContext.agents.map(
          (agent) =>
            `- ${agent.name}${agent.role ? `（${agent.role}）` : ""}：${agent.description}`,
        ),
      ].join("\n"),
    );
  }

  if (manualContext.files.length > 0) {
    let remainingChars = MANUAL_CONTEXT_TOTAL_CHAR_LIMIT;
    const renderedFiles: string[] = [];

    for (const file of manualContext.files) {
      if (remainingChars <= 0) {
        break;
      }

      const allocatedChars = Math.min(
        MANUAL_CONTEXT_FILE_CHAR_LIMIT,
        remainingChars,
      );
      const excerpt = createMiddleExcerpt(file.content, allocatedChars);
      remainingChars -= Math.min(file.content.trim().length, allocatedChars);

      renderedFiles.push(
        [
          `#### ${file.name}`,
          `- 路径：${file.path}`,
          excerpt.truncated
            ? `- 注入方式：已裁剪摘录，约省略 ${excerpt.omittedChars} 个字符；如需全文请再用 read 读取。`
            : "- 注入方式：已直接注入当前文件内容。",
          "```text",
          excerpt.text,
          "```",
        ].join("\n"),
      );
    }

    const omittedFileCount = manualContext.files.length - renderedFiles.length;
    blocks.push(
      [
        "### 手动指定文件",
        ...renderedFiles,
        omittedFileCount > 0
          ? `- 另外还有 ${omittedFileCount} 个手动文件未直接注入，以控制上下文体积；需要时请按路径调用 read。`
          : null,
      ].join("\n\n"),
    );
  }

  if (blocks.length === 0) {
    return null;
  }

  return [
    "以下资源由用户在本轮手动指定，应优先纳入分析与执行上下文。",
    ...blocks,
  ].join("\n\n");
}

function buildProjectContextBlock(
  projectContext?: ProjectContextPayload | null,
) {
  if (!projectContext || projectContext.files.length === 0) {
    return null;
  }

  return [
    "以下资源属于工作区默认项目上下文。进入对话或工作流时系统会优先注入，用于帮助你快速了解项目。",
    ...projectContext.files.map((file) => {
      const excerpt = createMiddleExcerpt(file.content, MANUAL_CONTEXT_FILE_CHAR_LIMIT);
      return [
        `### ${file.name}`,
        `- 路径：${file.path}`,
        excerpt.truncated
          ? `- 注入方式：已裁剪摘录，约省略 ${excerpt.omittedChars} 个字符；如需全文请再用 read 读取。`
          : "- 注入方式：已直接注入当前文件内容。",
        "```text",
        excerpt.text,
        "```",
      ].join("\n");
    }),
  ].join("\n\n");
}

function buildSubAgentManifestSummary(agent: ResolvedAgent) {
  const suggestedTools = normalizeSuggestedToolIds(agent.suggestedTools);

  return [
    `- role：${agent.role || "未填写"}`,
    agent.dispatchHint ? `- dispatchHint：${agent.dispatchHint}` : null,
    suggestedTools.length > 0
      ? `- suggestedTools：${suggestedTools.join(", ")}`
      : "- suggestedTools：无",
    agent.tags.length > 0 ? `- tags：${agent.tags.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSystemPrompt({
  defaultAgentMarkdown,
  enabledAgents,
  enabledSkills,
  enabledToolIds,
  includeAgentCatalog = true,
}: BuildSystemPromptInput) {
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

  const agentBlock =
    enabledAgents.length > 0
      ? enabledAgents.map((agent) => buildAgentCatalogBlock(agent)).join("\n\n")
      : "- 当前没有可委派的子代理。";

  return joinSections([
    "# 主代理系统上下文",
    renderPromptSections([
      {
        key: "s01",
        title: "运行环境",
        body: "你正在神笔写作应用中运行。以下是当前可用的工具、技能和子代理资源。",
      },
      {
        key: "s02",
        title: "已启用工具",
        body: buildToolPromptBlock(enabledToolIds),
      },
      {
        key: "s03",
        title: "已启用技能",
        body: skillBlock,
      },
      {
        key: "s04",
        title: "主代理人设",
        body: normalizedDefaultAgent,
      },
      includeAgentCatalog
        ? {
            key: "s05",
            title: "可委派子代理目录",
            body: agentBlock,
          }
        : {
            key: "s05",
            title: "可委派子代理目录",
            body: null,
          },
    ]),
  ]);
}

export function buildSubAgentSystem(
  agent: ResolvedAgent,
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
          agent.dispatchHint ? `- 适用时机：${agent.dispatchHint}` : null,
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
          "- 继承父代理当前已启用的全部工具；agent manifest 里的 suggestedTools 只描述常用工作方式。",
          "- 如果信息不足，基于现有工具做最小读取与最小验证。",
        ].join("\n"),
      },
      {
        key: "s03",
        title: "任务资料",
        body: [
          "AGENTS.md：",
          agent.body,
          "manifest 摘要：",
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

export function buildUserTurnContent({
  activeFilePath,
  manualContext,
  planningIntervention,
  planningState,
  projectContext,
  workspaceRootPath,
  prompt,
  subagentAnalysis,
}: BuildUserTurnContentInput) {
  const taskProfile = inferTaskProfile(prompt);
  const fileKind = inferFileKind(activeFilePath);
  const currentSystemDate = formatCurrentSystemDate();

  return joinSections([
    "# 当前轮上下文",
    renderPromptSections([
      {
        key: "s10",
        title: "当前轮动态上下文",
        body: [
          workspaceRootPath
            ? `- 当前工作区：${workspaceRootPath}`
            : "- 当前没有打开工作区。",
          activeFilePath
            ? `- 当前激活文件：${activeFilePath}`
            : "- 当前没有激活文件。",
          `- 当前系统日期：${currentSystemDate}`,
          `- 当前文件类型：${fileKind}`,
          `- 本轮任务类型：${taskProfile.label}`,
          `- 优先输出：${taskProfile.outputHint}`,
          `- 处理提醒：${taskProfile.caution}`,
          "- 工具调用硬性要求：除纯方法论/闲聊外，本轮必先调用 browse/search/read 读取相关工作区文件；禁止凭对话历史或模型记忆作答。",
          subagentAnalysis?.text
            ? `- 本轮已收到子任务摘要：${subagentAnalysis.agentName}`
            : "- 本轮默认由主代理直接处理。",
        ].join("\n"),
      },
      subagentAnalysis?.text
        ? {
            key: "s11",
            title: `子任务摘要（${subagentAnalysis.agentName}）`,
            body: subagentAnalysis.text.trim(),
          }
        : {
            key: "s11",
            title: "子任务摘要",
            body: null,
          },
      {
        key: "s12",
        title: "计划执行提醒",
        body: buildPlanningInterventionBlock(planningIntervention),
      },
      {
        key: "s13",
        title: "当前计划状态",
        body: buildPlanningStateBlock(planningState),
      },
      {
        key: "s14",
        title: "项目默认上下文",
        body: buildProjectContextBlock(projectContext),
      },
      {
        key: "s15",
        title: "手动指定上下文",
        body: buildManualContextBlock(manualContext),
      },
      {
        key: "s15",
        title: "用户请求",
        body: prompt.trim(),
      },
    ]),
  ]);
}
