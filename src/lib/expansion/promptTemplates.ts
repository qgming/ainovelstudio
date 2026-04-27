/**
 * 扩写模式 6 个 action 的提示词模板。
 *
 * 每个 prompt 由两部分组成：
 *   1. HEADER：硬编码、含动态变量的头部（如"当前目标"、"当前文件"），由代码用上下文构建，用户不可编辑。
 *   2. BODY：用户可编辑的指令主体，纯文本不含变量；保存到 expansion_prompt_templates 表。
 *
 * composePrompt(actionId, body, vars) = buildPromptHeader(actionId, vars) + "\n" + body
 */

import type { ExpansionWorkspaceActionId } from "../../components/expansion/detail/ExpansionWorkspacePanel";

export type PromptHeaderVars = {
  currentFilePath?: string | null;
  currentOutline?: string;
  targetLabel: string;
  targetVolumeId?: string;
  targetVolumeLabel?: string;
  targetVolumeSnapshot?: string;
  userPrompt?: string;
};

const INLINE_SKILL_RULE_NOTE =
  "本提示词已内联常用 skill 规则，优先直接执行；只有现有规则明显不足时，再补读额外技能或参考资料。";

const BATCH_OUTLINE_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "先读取 project/AGENTS.md、project/README.md 和 project/outline.md，确认规则、题材方向和剧情走向。",
  "优先直接开始处理；需要先说明时，用一句简短说明后继续执行。",
  "已有分卷时默认走增量同步：保留现有细纲，只处理大纲中发生变化的章节，以及当前分卷里缺失的细纲文件。",
  "细纲服务后续正文执行：先看本章承接状态，再明确本章作用、核心冲突、1-2 个推进点和章末钩子。",
  "先对照当前分卷已有细纲文件和 project/outline.md：",
  "1. 现有章节仍然有效且大纲无明显变化：不要重写。",
  "2. 现有章节对应的大纲有变化：优先用 expansion_chapter_write_content 只更新该章节的 outline。",
  "3. 大纲里应存在但当前分卷缺失的章节：调用 expansion_chapter_batch_outline 补建，并传上方头部声明的目标分卷 volumeId。",
  "4. 不要为了统一风格把整卷所有章节重新生成一遍。",
  "如果本卷缺失章节较多，允许分批多次调用 expansion_chapter_batch_outline，每批最多 20 章，直到当前分卷补齐。",
  "新章节 ID 不得与现有冲突，不确定时先用 expansion_continuity_scan 校验。",
  "outline 约 300 字，必须包含：本章主爽点（升级/打脸/收编/扮猪吃虎等）、核心冲突、关键转折、章末钩子（悬念/战斗/反转/情绪）。",
  "卷内节奏：起始章定调，中段递进，卷末高潮。单章 1 个核心冲突 + 1-2 个推进点，避免灌水。",
  "所有增量修改和补建完成后，只输出一句简短完成说明。",
].join("\n");

const BATCH_SETTINGS_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "先读取 project/AGENTS.md、project/README.md 和 project/outline.md，再决定要建哪些设定。",
  "先提取题材、主线冲突、主角定位、世界规则、势力关系和平台偏好，优先固化会直接影响后续写作的硬设定。",
  "区分已确认事实与待确认项，不要把推测写成已确认 canon。",
  "覆盖类别按需选择：人物 / 地点 / 势力 / 世界观 / 道具；主角与重要配角必须包含。",
  "主角设定必含：金手指、性格主标签、行事原则、社交模式。",
  "反派/对手设定必含：威胁层级、与主角差距、击败条件。",
  "世界观设定必含：力量体系等阶、升级路径、顶端是什么。",
  "阵营/势力设定必含：与主角关系、资源池、立场。",
  "尽量把人物、地点、势力、世界规则拆成稳定的独立 settings JSON，方便后续持续维护。",
  "用 expansion_setting_batch_generate 批量写回，不要走通用 write。",
].join("\n");

const SETTING_UPDATE_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "先读取当前设定 JSON，再读取最新章节正文、章节细纲、project/README.md 与 project/outline.md。",
  "只更新有正文、大纲或现有设定证据支持的变化；未确认信息标为待确认，不要伪造定论。",
  "优先维护会影响后续剧情的长期 canon：身份变化、关系变化、地点状态、规则暴露和关键场景后果。",
  "仅更新与最新剧情冲突或新增的部分，未变动内容保持原文。",
  "人物状态变化必标：等级 / 实力数值 / 资源 / 关系网；用「第X章：xxx」格式追加到 content 末尾，保留历史轨迹。",
  "区分「读者已知」与「读者未知」（POV 信息差），未揭示信息标注隐藏度。",
  "如剧情产生新设定，用 expansion_setting_batch_generate 创建。",
].join("\n");

const CHAPTER_WRITE_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "先读取 project/AGENTS.md、project/README.md、相关设定文件、前后章节的细纲与正文。",
  "写前先确认上一章停点、当前人物知道什么、还不知道什么、正在推进哪条冲突线，再动笔。",
  "再核对人设、时间线、地点限制、世界规则和关键场景状态，保证承接和连续性。",
  "字数目标 汉字 2500-3500（如 project/README.md 或 project/AGENTS.md 另有约定以其为准）。",
  "开篇 200 字内必须有具体场景或冲突，不要环境描写堆砌。",
  "对话占比 ≥ 30%，避免大段心理描写或旁白；严格保持人称视角，不中途漂移。",
  "每 500 字至少一个推进点（信息释放 / 情绪转折 / 冲突升级 / 实力变化）。",
  "严格按本章 outline 推进，不擅自加超纲剧情；本章必须落地一个主爽点。",
  "正文优先用动作、对白、细节推进情绪，少概述、少解释、少贴标签。",
  "章末必须留钩子（悬念/战斗/反转/情绪任选），禁止平淡收束。",
  "写完后自检：前文承接、设定一致、时间线/空间连续、章末钩子成立，再写回 content；可按需同步补充 outline。",
].join("\n");

const CHAPTER_SETTING_UPDATE_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "先读取当前章节 JSON 的 outline 与 content，分析涉及的人物、地点、物品、势力、概念和关系变化。",
  "只记录有正文证据支撑的动态变化，长期 canon 与即时状态都要能追溯到本章内容。",
  "必须更新主角的等级 / 实力数值 / 资源 / 关系网变化；用「第X章：xxx」格式追加到对应设定 content 末尾。",
  "区分「显性事件」与「暗线伏笔」，伏笔标注隐藏度（已揭示 / 部分揭示 / 未揭示）。",
  "如果同一变化会影响多份设定，逐个同步，不要把人物、地点、势力混写在一个文件里。",
  "新出场实体（NPC / 物品 / 势力）必须用 expansion_setting_batch_generate 创建独立 settings JSON。",
  "与既有设定冲突时以正文为准，反向修订设定。",
].join("\n");

const FREE_INPUT_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "先判断目标是：写回文件 / 更新设定 / 生成正文 / 大纲规划 / 仅分析建议。",
  "如果是创作或修订，优先读取当前文件、相关章节、相关设定、project/README.md 与 project/outline.md。",
  "如果是正文任务，守住人物已知信息、时间顺序、地点限制、世界规则和章末钩子。",
  "如果是设定任务，优先固化硬事实，区分已确认与待确认。",
  "如果是大纲或细纲任务，优先明确本章作用、核心冲突、推进点和钩子。",
  "如用户未限定输出形态，先判断是写回文件还是仅给建议。",
].join("\n");

export const DEFAULT_PROMPT_BODIES: Record<ExpansionWorkspaceActionId, string> = {
  "project-batch-outline": BATCH_OUTLINE_BODY,
  "project-batch-settings": BATCH_SETTINGS_BODY,
  "setting-update": SETTING_UPDATE_BODY,
  "chapter-write": CHAPTER_WRITE_BODY,
  "chapter-setting-update": CHAPTER_SETTING_UPDATE_BODY,
  "free-input": FREE_INPUT_BODY,
};

/**
 * 构建包含动态变量的硬编码头部。每个 action 的头部内容由产品决定，用户不可编辑。
 */
export function buildPromptHeader(
  actionId: ExpansionWorkspaceActionId,
  vars: PromptHeaderVars,
): string {
  switch (actionId) {
    case "project-batch-outline":
      return [
        `当前目标：${vars.targetLabel}`,
        `当前文件：${vars.currentFilePath ?? "project/outline.md"}`,
        `目标分卷：${vars.targetVolumeId ?? ""}（${vars.targetVolumeLabel ?? ""}）`,
        "当前分卷已有细纲文件：",
        vars.targetVolumeSnapshot ?? "（当前分卷还没有现有细纲文件）",
      ].join("\n");
    case "project-batch-settings":
      return [
        `当前目标：${vars.targetLabel}`,
        `当前文件：${vars.currentFilePath ?? "project/README.md"}`,
      ].join("\n");
    case "setting-update":
      return [
        `当前目标：${vars.targetLabel}`,
        `当前文件：${vars.currentFilePath ?? ""}`,
      ].join("\n");
    case "chapter-write":
      return [
        `当前目标：${vars.targetLabel}`,
        `当前文件：${vars.currentFilePath ?? ""}`,
        "当前章节细纲：",
        vars.currentOutline ?? "（当前章节细纲为空）",
      ].join("\n");
    case "chapter-setting-update":
      return [
        `当前目标：${vars.targetLabel}`,
        `当前文件：${vars.currentFilePath ?? ""}`,
      ].join("\n");
    case "free-input":
      return [
        `当前目标：${vars.targetLabel}`,
        `当前文件：${vars.currentFilePath ?? "未限定，按当前工作区处理"}`,
        "用户输入提示词：",
        vars.userPrompt ?? "",
      ].join("\n");
  }
}

/**
 * 拼接完整 prompt：硬编码头部 + 用户可编辑主体。
 */
export function composePrompt(
  actionId: ExpansionWorkspaceActionId,
  body: string,
  vars: PromptHeaderVars,
): string {
  return `${buildPromptHeader(actionId, vars)}\n${body}`;
}
