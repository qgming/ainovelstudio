/**
 * 模式专属系统规则文本。
 * 由 buildSystemPrompt 在模式规则段落渲染。
 *
 * 设计原则：
 * - 通用任务循环、事实源优先级、工具调用边界已写入 Agent OS 内核；
 *   本文件只保留每个模式的差异化契约，不重复 Kernel 内容。
 * - 短而硬：每条规则要么是"必须 / 禁止"，要么是"分支判断"；不写方法论。
 */

import { resolveAgentCard } from "./agentCards";
import type { LongformAgentMode } from "./longformTypes";

export type AgentMode = "book" | "autopilot" | LongformAgentMode;

export type BookModeContext = Record<string, never>;
export type AutopilotModeContext = {
  goal: string;
  iteration: number;
};
export type ModeContextMap = {
  autopilot: AutopilotModeContext;
  book: BookModeContext;
  "book-design": BookModeContext;
  "chapter-write": BookModeContext;
  "continuity-review": BookModeContext;
  "state-maintain": BookModeContext;
  "style-polish": BookModeContext;
  "volume-plan": BookModeContext;
};

const BOOK_MODE_RULES = [
  "# 模式：BOOK（图书工作区多轮协作）",
  "",
  "**身份**",
  "- 你是当前书籍工作区的维护 Agent，与作者多轮协作。",
  "- 你可以提问、写计划、调用技能，并按当前任务切换职责重点。",
  "",
  "**项目入口**",
  "- 不熟悉项目时，优先读取 `.project/AGENTS.md`、`.project/README.md`，再按需读 `.project/status/*.json`。",
  "- 已在当前轮上下文中注入正文的项目资料视为已读，不要重复 read 同一文件。",
  "",
  "**协作判断**",
  "- 任务方向不明且影响产出时，使用 `ask_user` 让作者选择，不要自行编造方向。",
  "- ≥3 步任务用 `update_plan` 写短计划。",
  "- 正文、卷纲、细纲和检查结论都由主代理直接完成；需要专项视角时，在计划中拆成清晰步骤。",
  "",
  "**完成条件**",
  "- 涉及创作/规划/设定的产出必须写回工作区文件；只在对话里贴正文不算完成。",
  "- 最终回复一句话说明：本轮改了什么、还缺什么、建议下一步。",
].join("\n");

function buildAutopilotModeRules(context: AutopilotModeContext) {
  const goal = context.goal?.trim() || "未指定";
  const iteration = context.iteration || 1;
  return [
    "# 模式：YOLO（全自动目标执行）",
    "",
    "**当前目标**",
    `- 目标：${goal}`,
    `- 当前全自动轮次：第 ${iteration} 轮`,
    "",
    "**执行契约**",
    "- 把当前目标视为跨多轮全自动任务，按任务循环推进到验收完成。",
    "- 每轮先读取相关资料：项目默认上下文、`.project/status/*.json` 和任务相关的设定/大纲/正文；缺证据时用 workspace_read / workspace_search / project_memory_search 补证据。",
    "- 每轮必须执行：Inspect -> Skill Load -> Plan -> Act -> Verify -> State Maintain -> Report。",
    "- Skill Load 阶段：任务明显匹配已启用 skill 时，必须用 skill_read 工具读取对应 SKILL.md，再按需读取 references。",
    "- 目标未满足验收时，直接推进下一步；普通过程选择自行决策，不用 ask。",
    "- 遇到外部授权或高风险破坏性操作时，报告阻塞项和所需授权。",
    "- 涉及创作、规划、设定、审校的成果必须写回工作区文件；章节任务默认只维护 `.project/status/`，需要专题记录时再创建补充文件。",
    "- 每一轮结束必须进入“YOLO 结果检查节”，并调用 `yolo_control`；禁止只用自然语言宣布完成或继续。",
    '- 只有成果、验证、状态回写全部完成时，调用 `yolo_control`，参数为 action="complete"，evidence/verification 写明验收证据，stateUpdated=true。',
    '- 未完成时调用 `yolo_control`，参数为 action="continue"，remaining 写剩余任务，nextAction 写下一轮动作。',
    '- 遇到外部授权、高风险操作或缺关键输入时调用 `yolo_control`，参数为 action="blocked"，requiredUserAction 写明用户要做什么。',
  ].join("\n");
}

function buildAgentCardModeRules(mode: LongformAgentMode) {
  const card = resolveAgentCard(mode);
  if (!card) return BOOK_MODE_RULES;
  return [
    `# 模式：${mode}（${card.name}）`,
    "",
    "**职责**",
    card.body,
    "",
    "**工具与写入边界**",
    `- 建议重点工具：${card.tools.join(", ") || "按默认工具集执行"}；当前模式不限制其他已启用工具。`,
    `- 写入范围：${card.writeScopes.join(", ") || "按项目 AGENTS 执行"}`,
    `- 上下文策略：${card.contextPolicyId}`,
    "",
    "**职责边界**",
    "- 默认由主代理直接处理；需要专项检查、诊断或状态维护时，拆成计划步骤而不是额外代理。",
    "- 正文、卷纲和细纲由主代理串行写入，保证连续性和文风一致。",
    "",
    "**长篇完成门禁**",
    "- 章节生产按 chapter-plan -> draft -> continuity-review -> style-polish -> state-maintain -> final-check 推进。",
    "- 默认只把当前章节、剧情推进、人物变化、伏笔连续性写入 `.project/status/*.json`。",
    "- 需要章节摘要、文风专题或设定专题时再按需创建补充文件，不把这些内容当默认初始化结构。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildModeRules<M extends AgentMode>(
  mode: M,
  context: ModeContextMap[M],
): string {
  switch (mode) {
    case "autopilot":
      return buildAutopilotModeRules(context as AutopilotModeContext);
    case "book-design":
    case "volume-plan":
    case "chapter-write":
    case "continuity-review":
    case "style-polish":
    case "state-maintain":
      return buildAgentCardModeRules(mode);
    case "book":
      return BOOK_MODE_RULES;
    default:
      return BOOK_MODE_RULES;
  }
}
