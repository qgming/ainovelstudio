import type { ResolvedSkill } from "../../stores/skillsStore";
import type { ResolvedAgent } from "../../stores/subAgentStore";
import type { ManualTurnContextPayload } from "./manualTurnContext";
import {
  renderPlanItems,
  type PlanningIntervention,
  type PlanningState,
} from "./planning";
import { BUILTIN_TOOLS, normalizeSuggestedToolIds } from "./toolDefs";

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
};

type BuildUserTurnContentInput = {
  activeFilePath: string | null;
  manualContext?: ManualTurnContextPayload | null;
  planningIntervention?: PlanningIntervention | null;
  planningState?: PlanningState | null;
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

const SKILL_LOADING_NOTE =
  "system 里只保留技能目录；需要某个 skill 的完整规则时，再用 skill 工具按需读取 SKILL.md 或 references。";
const MANUAL_CONTEXT_FILE_CHAR_LIMIT = 6_000;
const MANUAL_CONTEXT_TOTAL_CHAR_LIMIT = 12_000;

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
    `- 说明：${skill.description}`,
    suggestedTools.length > 0
      ? `- 常用工具：${suggestedTools.join(", ")}`
      : null,
    skill.references.length > 0
      ? `- 可读参考：${skill.references.length} 份`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildAgentCatalogBlock(agent: ResolvedAgent) {
  return [
    `### 子代理：${agent.name}`,
    `- 来源：${agent.sourceLabel}`,
    agent.role ? `- 角色：${agent.role}` : null,
    `- 说明：${agent.description}`,
    agent.dispatchHint ? `- 适用时机：${agent.dispatchHint}` : null,
    agent.tags.length > 0 ? `- 匹配标签：${agent.tags.join(", ")}` : null,
    "- 工具权限：继承当前主会话已启用的全部工具。",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildToolPromptBlock(enabledToolIds: string[]) {
  const enabledTools = BUILTIN_TOOLS.filter((tool) =>
    enabledToolIds.includes(tool.id),
  );

  if (enabledTools.length === 0) {
    return "- 当前未启用任何工作区工具。";
  }

  return [
    "工具使用策略：",
    "- 多步任务先调用 todo 写出当前计划，并在每完成一步后及时更新。",
    "- todo 只维护当前会话里的短计划，不要把它当长期任务系统。",
    "- 当任务需要子代理隔离上下文执行时，主动调用 task 工具，而不是在主上下文里展开长链路。",
    "- 未知路径、未知入口或需要先看目录结构时，优先使用 browse 或 search 缩小范围。",
    "- 涉及工作区路径时，默认优先传相对工作区根目录的路径，不要传绝对路径；例如用 `05-完整大纲.md`，不要用 `C:/.../05-完整大纲.md`。",
    "- 已知准确路径且需要正文内容时，再使用 read。",
    "- 小范围文本修改优先使用 edit；只有整份内容都准备好了才使用 write。",
    "- JSON 数据优先使用 json 做局部读取和局部更新，不要为了改一个字段整份重写。",
    "- 结构变更统一使用 path；skill 和 agent 内文件统一分别走 skill / agent 工具。",
    "当前已启用工具目录：",
    ...enabledTools.map((tool) => `- ${tool.name}（${tool.id}）`),
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
        "不要凭空改动既有设定；连续性敏感处优先核对人物、时态与剧情事实。",
    };
  }

  if (/(润色|改写|重写|精修|压缩|降重|优化表达|优化文风)/i.test(prompt)) {
    return {
      label: "改写/润色",
      outputHint: "优先给修改后文本，必要时再附简短修改说明。",
      caution: "默认保留原意、信息量与文风，不要无故重置结构或删掉有效细节。",
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
      caution: "保持内部逻辑闭环，避免设定互相冲突或只有概念没有落地细节。",
    };
  }

  if (/(审稿|点评|评审|review|打分|找问题|挑错)/i.test(prompt)) {
    return {
      label: "审稿/评估",
      outputHint: "优先给问题与结论，再给修改建议或风险排序。",
      caution: "聚焦真实问题，不要用空泛表扬稀释判断。",
    };
  }

  if (/(分析|总结|梳理|解释|诊断|节奏|冲突|主题|动机)/i.test(prompt)) {
    return {
      label: "分析/诊断",
      outputHint: "优先给结论、结构化观察和依据，避免先讲泛泛方法。",
      caution: "基于已知内容推断；未读取的情节与设定不要当成事实引用。",
    };
  }

  if (/(翻译|translate|本地化)/i.test(prompt)) {
    return {
      label: "翻译/转写",
      outputHint: "优先给译文或转换结果，必要时补充少量术语说明。",
      caution: "注意语气、叙述视角和专有名词的一致性。",
    };
  }

  return {
    label: "通用协作",
    outputHint: "优先给最接近用户目标的可执行结果或下一步动作。",
    caution: "如需依赖工作区事实，先最小读取再继续，不要假设未见内容。",
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

export function buildSystemPrompt({
  defaultAgentMarkdown,
  enabledAgents,
  enabledSkills,
  enabledToolIds,
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
        body: "你正在 AI Novel Studio 写作软件中运行。以下是当前可用的工具、技能和子代理资源。",
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
      {
        key: "s05",
        title: "可委派子代理目录",
        body: agentBlock,
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
          "- 继承父代理当前已启用的全部工具；agent 文件里的 suggestedTools 或 TOOLS.md 只描述常用工作方式。",
          "- 如果信息不足，基于现有工具做最小读取与最小验证。",
        ].join("\n"),
      },
      {
        key: "s03",
        title: "任务资料",
        body: [
          "AGENTS.md：",
          agent.body,
          agent.toolsPreview
            ? `TOOLS.md 摘要：\n${agent.toolsPreview}`
            : "TOOLS.md 摘要：\n- 当前没有额外 TOOLS 摘要。",
          agent.memoryPreview
            ? `MEMORY.md 摘要：\n${agent.memoryPreview}`
            : "MEMORY.md 摘要：\n- 当前没有额外 MEMORY 摘要。",
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
  workspaceRootPath,
  prompt,
  subagentAnalysis,
}: BuildUserTurnContentInput) {
  const taskProfile = inferTaskProfile(prompt);
  const fileKind = inferFileKind(activeFilePath);

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
          `- 当前文件类型：${fileKind}`,
          `- 本轮任务类型：${taskProfile.label}`,
          `- 优先输出：${taskProfile.outputHint}`,
          `- 处理提醒：${taskProfile.caution}`,
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
