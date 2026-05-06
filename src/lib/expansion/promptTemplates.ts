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
  "",
  "## Objective",
  "为本卷补齐缺失或大纲已变化的章节细纲，不整卷重刷。",
  "",
  "## Must Read",
  "- `project/AGENTS.md`、`project/README.md`、`project/outline.md`：规则、题材、主线。",
  "- 当前分卷已有的章节 JSON（仅在判断是否要更新 / 重建时读取）。",
  "",
  "## Must Use Tools",
  "- 补建缺失章节：`expansion_chapter_batch_outline`，必须传上方头部声明的目标分卷 volumeId，每批最多 20 章。",
  "- 局部更新已有章节 outline：`expansion_chapter_write_content`，按 chapterId / chapterPath 定位，只更新 outline 字段。",
  "- 禁止用通用 write / edit 改章节 JSON。",
  "",
  "## Write Contract",
  "- 章节字段只允许 id / name / outline / content；outline 写成 Markdown 字符串，不要外包 ``` 代码块。",
  "- outline 约 300 字，必须含本章主爽点（升级 / 打脸 / 收编 / 扮猪吃虎等）、核心冲突、关键转折、章末钩子（悬念 / 战斗 / 反转 / 情绪）。",
  "- 章节 ID 不得与现有冲突；不确定时先用 `expansion_continuity_scan` 校验。",
  "",
  "## Evidence Rules",
  "- 默认走增量同步：",
  "  1. 现有章节仍有效且大纲无明显变化：不要重写。",
  "  2. 现有章节对应大纲已变化：用 `expansion_chapter_write_content` 只更新该章的 outline。",
  "  3. 大纲应有但当前分卷缺失的章节：用 `expansion_chapter_batch_outline` 补建。",
  "- 不要为统一风格把整卷所有章节重新生成一遍。",
  "",
  "## Done Criteria",
  "- 缺失或变化章节均已通过专用工具写回。",
  "- 一句话说明本动作改了哪些章节、是否还有缺口。",
].join("\n");

const BATCH_SETTINGS_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "",
  "## Objective",
  "一次性产出后续写作会直接依赖的硬设定，不堆砌泛设定。",
  "",
  "## Must Read",
  "- `project/AGENTS.md`、`project/README.md`、`project/outline.md`：题材、主线、平台偏好、风格基线。",
  "",
  "## Must Use Tools",
  "- 批量写回：`expansion_setting_batch_generate`，传 settings[] 写 `settings/<分类>/*.json`。",
  "- 禁止用通用 write / edit 改设定 JSON。",
  "",
  "## Write Contract",
  "- 设定字段只允许 id / name / content；content 写成 Markdown 字符串，不要外包 ``` 代码块。",
  "- 覆盖类别按需选择：人物 / 地点 / 势力 / 世界观 / 道具；主角与重要配角必须包含。",
  "- 主角设定必含：金手指、性格主标签、行事原则、社交模式。",
  "- 反派 / 对手设定必含：威胁层级、与主角差距、击败条件。",
  "- 世界观设定必含：力量体系等阶、升级路径、顶端是什么。",
  "- 阵营 / 势力设定必含：与主角关系、资源池、立场。",
  "",
  "## Evidence Rules",
  "- 区分已确认事实与待确认项：推测必须在 content 中显式标注「待确认」，不要写成 canon。",
  "- 优先固化会直接影响后续写作的硬设定，不要为铺人物表而铺人物表。",
  "",
  "## Done Criteria",
  "- 关键设定已通过专用工具写回。",
  "- 一句话说明本动作建了哪些设定、是否还有缺口。",
].join("\n");

const SETTING_UPDATE_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "",
  "## Objective",
  "依据正文与大纲证据更新当前设定的长期 canon，不动正文。",
  "",
  "## Must Read",
  "- 当前设定 JSON：拿到现有 content 与待确认项。",
  "- 最新章节正文、章节 outline、`project/README.md`、`project/outline.md`：核对剧情进展。",
  "",
  "## Must Use Tools",
  "- 更新本设定：`expansion_setting_update_from_chapter`，按 settingId 定位，append / replace 当前设定的 content。",
  "- 如剧情产生新设定：`expansion_setting_batch_generate` 创建。",
  "- 禁止用通用 write / edit 改设定 JSON。",
  "",
  "## Write Contract",
  "- 设定字段只允许 id / name / content；content 写成 Markdown 字符串。",
  "- 仅更新与最新剧情冲突或新增的部分，未变动内容保持原文。",
  "- 人物状态变化必标：等级 / 实力数值 / 资源 / 关系网；用「第X章：xxx」格式追加到 content 末尾，保留历史轨迹。",
  "- 区分「读者已知」与「读者未知」（POV 信息差），未揭示信息标注隐藏度。",
  "",
  "## Evidence Rules",
  "- 只更新有正文、大纲或现有设定证据支持的变化；未确认信息标为待确认，不要伪造定论。",
  "- 优先维护会影响后续剧情的长期 canon：身份、关系、地点状态、规则暴露、关键场景后果。",
  "",
  "## Done Criteria",
  "- 已通过专用工具写回长期 canon 与必要新设定。",
  "- 一句话说明改了哪些字段、新增了哪些设定。",
].join("\n");

const CHAPTER_WRITE_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "",
  "## Objective",
  "完成当前章节正文，符合本章 outline 与项目风格。",
  "",
  "## Must Read",
  "- `project/AGENTS.md`、`project/README.md`：风格、字数、禁写约束。",
  "- 当前章节 JSON 的 outline：拿到本章作用与节拍。",
  "- 上一章 / 相关前文章节：拿到承接点。",
  "- 相关人物 / 势力 / 世界观设定：核对人设、力量体系、规则。",
  "",
  "## Must Use Tools",
  "- 正文写回：`expansion_chapter_write_content`，默认只更新 content；可对 content / outline 分别 replace 或 append。",
  "- 禁止用通用 write / edit 改章节 JSON。",
  "",
  "## Write Contract",
  "- 字段只允许 id / name / outline / content；content 写成 Markdown 字符串，不要外包 ``` 代码块。",
  "- 字数目标 汉字 2500-3500（如 README 或 AGENTS 另有约定以其为准）。",
  "- 开篇 200 字内必须有具体场景或冲突，不要环境描写堆砌。",
  "- 对话占比 ≥ 30%，避免大段心理描写或旁白；严格保持人称视角，不中途漂移。",
  "- 每 500 字至少一个推进点（信息释放 / 情绪转折 / 冲突升级 / 实力变化）。",
  "- 章末必须留钩子（悬念 / 战斗 / 反转 / 情绪），禁止平淡收束。",
  "",
  "## Evidence Rules",
  "- 写前先确认上一章停点、当前人物知道什么、还不知道什么、正在推进哪条冲突线，再动笔。",
  "- 严格按本章 outline 推进，不擅自加超纲剧情；本章必须落地一个主爽点。",
  "- 正文优先用动作、对白、细节推进情绪，少概述、少解释、少贴标签。",
  "",
  "## Done Criteria",
  "- 写完后自检：前文承接、设定一致、时间线 / 空间连续、章末钩子成立。",
  "- 已通过专用工具写回 content；可按需同步补充 outline。",
  "- 一句话说明：写了哪个文件、字数是否达标、风险点。",
].join("\n");

const CHAPTER_SETTING_UPDATE_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "",
  "## Objective",
  "从当前章节正文与 outline 抽取人物 / 地点 / 物品 / 势力 / 概念变化，回写到对应设定。",
  "",
  "## Must Read",
  "- 当前章节 JSON 的 outline 与 content。",
  "- 受本章影响的设定 JSON：拿到现状以判断 append / replace。",
  "",
  "## Must Use Tools",
  "- 已有设定更新：`expansion_setting_update_from_chapter`。",
  "- 新出场实体（NPC / 物品 / 势力）：`expansion_setting_batch_generate` 创建独立 settings JSON。",
  "- 禁止用通用 write / edit 改设定 JSON。",
  "",
  "## Write Contract",
  "- 设定字段只允许 id / name / content；content 写成 Markdown 字符串。",
  "- 主角的等级 / 实力数值 / 资源 / 关系网变化必更新；用「第X章：xxx」格式追加到对应设定 content 末尾。",
  "- 区分「显性事件」与「暗线伏笔」，伏笔标注隐藏度（已揭示 / 部分揭示 / 未揭示）。",
  "",
  "## Evidence Rules",
  "- 只记录有正文证据支撑的动态变化，长期 canon 与即时状态都要能追溯到本章内容。",
  "- 与既有设定冲突时以正文为准，反向修订设定。",
  "- 同一变化影响多份设定时逐个同步，不要把人物 / 地点 / 势力混写在一个文件里。",
  "",
  "## Done Criteria",
  "- 已通过专用工具写回受影响设定与必要新设定。",
  "- 一句话说明：动了哪些设定、新增了哪些。",
].join("\n");

const FREE_INPUT_BODY = [
  INLINE_SKILL_RULE_NOTE,
  "",
  "## Objective",
  "按用户输入分流到合适动作并完成本轮产出。",
  "",
  "## Must Read",
  "- `project/AGENTS.md`、`project/README.md`、`project/outline.md`（任务涉及创作或改动时必读）。",
  "- 与用户输入相关的章节 / 设定 JSON。",
  "",
  "## Must Use Tools",
  "- 写章节正文 / outline → `expansion_chapter_write_content` 或 `expansion_chapter_batch_outline`。",
  "- 写设定 → `expansion_setting_batch_generate` 或 `expansion_setting_update_from_chapter`。",
  "- 禁止用通用 write / edit 改章节 / 设定 JSON。",
  "",
  "## Evidence Rules",
  "- 先判断目标是：写回文件 / 更新设定 / 生成正文 / 大纲规划 / 仅分析建议。",
  "- 如果是正文任务，守住人物已知信息、时间顺序、地点限制、世界规则与章末钩子。",
  "- 如果是设定任务，优先固化硬事实，区分已确认与待确认。",
  "- 如果是大纲或细纲任务，明确本章作用、核心冲突、推进点和钩子。",
  "- 如用户未限定输出形态，先判断是写回文件还是仅给建议，再动手。",
  "",
  "## Done Criteria",
  "- 涉及写回的任务已用专用工具落地；仅分析的任务给出明确结论。",
  "- 一句话说明：本轮做了什么、是否还有未完成项。",
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
