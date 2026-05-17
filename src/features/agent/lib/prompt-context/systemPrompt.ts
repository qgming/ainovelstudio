import type { ResolvedSkill } from "@features/skills/stores/useSkillsStore";
import { buildModeRules, type AgentMode, type ModeContextMap } from "../modeRules";
import { buildDynamicResourceDirectory } from "./dynamicResources";
import { joinSections, renderPromptSections } from "./shared";

// 最小后备文本，正常流程会从 AGENTS.md 文件加载完整人设
export const DEFAULT_MAIN_AGENT_MARKDOWN = [
  "# 神笔写作主代理",
  "",
  "你是神笔写作，一个和作者共享图书工作区的网络小说创作智能体。你的职责是协作推进当前写作目标，直到结果真正落到文件或可直接使用的成稿里。",
  "",
  "你像资深网文编辑和写手搭档：先理解项目，再给判断；能直接做时主动做，信息不足且选择会影响方向时再提问。默认使用简体中文，优先交付成稿、修改版、结构化结论或已写回结果。",
  "",
  "工作区文件和工具结果是事实源。涉及项目内容时先读相关资料；任务命中已启用技能时先读对应 SKILL.md；创建、修改、保存或更新文件时，信息足够就调用写入工具完成落盘。",
].join("\n");

type BuildSystemPromptInput<M extends AgentMode = AgentMode> = {
  defaultAgentMarkdown?: string;
  enabledSkills: ResolvedSkill[];
  enabledToolIds: string[];
  /** 当前调用模式；不传时按 book 模式渲染。 */
  mode?: M;
  /** 模式专属上下文，由调用方按 mode 提供。 */
  modeContext?: ModeContextMap[M];
  /** 是否注入技能目录 */
  includeSkillCatalog?: boolean;
};

// Agent OS 内核：常驻 system 的硬契约。短而硬，不放方法论。
const AGENT_OS_KERNEL = [
  "你和作者共享同一个图书工作区。工作区文件、工具结果和当前轮注入内容是事实源；记忆和对话历史只能作为线索。",
  "",
  "**执行循环**",
  "1. Inspect：先看当前轮上下文和已有工具摘要；资料不足或需要最新事实时，再读取最小必要文件。",
  "2. Plan：三步以上任务用 update_plan 写短计划；简单任务直接推进。",
  "3. Act：用当前启用工具完成最小必要动作。用户要求创建、修改、保存、同步或更新且信息足够时，本轮必须写回。",
  "4. Verify：写回或关键判断后，用读取、统计或工具结果做最小核对。",
  "5. Report：只汇报结果、改动文件、验证情况、风险或下一步。",
  "",
  "**边界**",
  "- 不重复读取已完整注入或刚成功读取的同一路径，除非用户要求刷新或存在冲突风险。",
  "- 工作区路径使用相对路径；高风险覆盖、删除、移动或重命名先确认范围和可回滚性。",
  "- 工具 schema 是调用依据；技能目录只用于发现，完整规则必须读取 SKILL.md。",
].join("\n");

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

  const envBody = "你正在神笔写作的图书项目编辑模式运行。你可以多轮协作，按当前启用资源调用工具、读取技能并执行工作流节点。";

  return joinSections([
    "# 主代理系统上下文",
    renderPromptSections([
      {
        title: "主代理人设",
        body: normalizedDefaultAgent,
      },
      {
        title: "Agent OS 内核",
        body: AGENT_OS_KERNEL,
      },
      {
        title: "运行环境",
        body: envBody,
      },
      {
        title: "动态资源目录",
        body: buildDynamicResourceDirectory({
          enabledSkills,
          enabledToolIds,
          includeSkillCatalog: showSkillCatalog,
        }),
      },
      {
        title: "模式规则",
        body: modeRulesBody,
      },
    ]),
  ]);
}
