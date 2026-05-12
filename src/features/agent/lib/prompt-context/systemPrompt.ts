import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import { buildModeRules, type AgentMode, type ModeContextMap } from "../modeRules";
import type { RuntimeSubAgentProfile } from "../subagentProfile";
import { normalizeSuggestedToolIds } from "../toolDefs";
import { buildDynamicResourceDirectory } from "./dynamicResources";
import { joinSections, renderPromptSections } from "./shared";

// 最小后备文本，正常流程会从 AGENTS.md 文件加载完整人设
export const DEFAULT_MAIN_AGENT_MARKDOWN = [
  "# 主代理",
  "",
  "你是神笔写作客户端的写作总控Agent。优先自己完成任务，在信息充足时直接交付可用内容。",
  "默认使用简体中文，优先给成稿或结构化结论，不输出空泛方法论。",
  "用户要求创建、修改、保存或更新文件/技能时，信息足够就主动调用写入类工具完成落盘，不要只给口头草稿。",
  "修改已有文件时优先使用 edit 做局部修改，整稿或新文件再使用 write。",
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

// Agent OS 内核：常驻 system 的硬契约。短而硬，不放方法论。
const AGENT_OS_KERNEL = [
  "工作区文件、工具结果是事实源；历史工具执行记录是可复用的执行轨迹。",
  "",
  "**任务循环（每轮严格按序）**",
  "1. Inspect：先检查当前轮已注入上下文、历史工具执行记录和项目默认上下文；资料不足或需要最新文件事实时再调用工具。不知道路径用 browse；知道关键词用 search；知道路径用 read。",
  "2. Plan：≥3 步任务用 todo 写短计划；简单任务直接做。",
  "3. Act：用已启用工具执行最小必要动作；当用户要求改写、创建、保存、同步、更新设定/状态/技能且信息已足够时，本轮必须调用对应写入工具（edit/write/json/path/skill.write）完成，而不是只展示将要写入的内容。",
  "4. Verify：写回或关键判断后，用最小读取、字数统计或工具结果核对。",
  "5. Report：汇报结果、改动文件、风险或下一步。",
  "",
  "**避免重复工具调用**",
  "- 当前上下文已有同一路径的成功 read/search/browse 记录，且用户没有要求刷新或核对最新文件时，优先复用已注入内容和工具摘要。",
  "- 同一轮连续工具调用前，先判断新增读取会补足哪一项缺失信息；只为确认已知事实的重复读取应合并或跳过。",
  "- 工具摘要显示成功但内容不足时，直接读取缺失的最小范围，例如 range、heading_range 或关键词 search。",
  "- 写入工具成功后，后续轮次优先复用写入结果；只有用户要求刷新或存在冲突风险时再重复读取。",
].join("\n");

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

function readSkillHeaderString(skill: ResolvedSkill, key: string) {
  const value = skill.frontmatter?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
        title: "主代理人设",
        body: normalizedDefaultAgent,
      },
      {
        key: "s01",
        title: "Agent OS 内核",
        body: AGENT_OS_KERNEL,
      },
      {
        key: "s02",
        title: "运行环境",
        body: envBody,
      },
      {
        key: "s03",
        title: "动态资源目录",
        body: buildDynamicResourceDirectory({
          enabledSkills,
          enabledToolIds,
          includeSkillCatalog: showSkillCatalog,
        }),
      },
      {
        key: "s04",
        title: "模式规则",
        body: modeRulesBody,
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
              `### 技能：${readSkillHeaderString(skill, "name") ?? skill.name}`,
              `- 说明：${readSkillHeaderString(skill, "description") ?? skill.description}`,
              suggestedTools.length > 0
                ? `- 推荐工具：${suggestedTools.join(", ")}`
                : "- 推荐工具：无",
              '- 需要完整规则时，使用 skill 工具读取 relativePath="SKILL.md"。',
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
