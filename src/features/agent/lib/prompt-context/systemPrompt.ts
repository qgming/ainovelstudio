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

  const envBody = "你正在神笔写作的图书项目编辑模式运行。你可以多轮协作，按当前启用资源调用工具、读取技能并直接完成任务。";

  // 主代理人设(AGENTS.md)已包含完整的工作循环、文件读取边界、工具与写入规则,
  // 因此不再单独注入 Agent OS 内核以避免重复。
  return joinSections([
    "# 主代理系统上下文",
    renderPromptSections([
      {
        title: "主代理人设",
        body: normalizedDefaultAgent,
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
