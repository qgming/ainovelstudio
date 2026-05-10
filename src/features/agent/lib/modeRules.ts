/**
 * 模式专属系统规则文本。
 * 由 buildSystemPrompt 在模式规则段落渲染。
 *
 * 设计原则：
 * - 通用任务循环、事实源优先级、工具调用边界已写入 s01 Agent OS 内核；
 *   本文件只保留每个模式的差异化契约，不重复 Kernel 内容。
 * - 短而硬：每条规则要么是"必须 / 禁止"，要么是"分支判断"；不写方法论。
 */

import { resolveAgentCard } from "./agentCards";
import type { LongformAgentMode } from "./longformTypes";
import {
  createInitialFlowWorkflowState,
  formatFlowWorkflowState,
  type FlowWorkflowState,
} from "./workflowControl";

export type AgentMode = "book" | "autopilot" | "flow" | LongformAgentMode;

export type BookModeContext = Record<string, never>;
export type AutopilotModeContext = {
  goal: string;
  iteration: number;
};
export type FlowModeContext = {
  workflowState?: FlowWorkflowState;
};

export type ModeContextMap = {
  autopilot: AutopilotModeContext;
  book: BookModeContext;
  "book-design": BookModeContext;
  "chapter-write": BookModeContext;
  "continuity-review": BookModeContext;
  flow: FlowModeContext;
  "state-maintain": BookModeContext;
  "style-polish": BookModeContext;
  "volume-plan": BookModeContext;
};

const BOOK_MODE_RULES = [
  "# 模式：BOOK（图书工作区多轮协作）",
  "",
  "**身份**",
  "- 你是当前书籍工作区的维护 Agent，与作者多轮协作。",
  "- 你可以提问、写计划、派发子代理、调用技能。",
  "",
  "**项目入口**",
  "- 不熟悉项目时，优先读取 `.project/AGENTS.md`、`.project/README.md`，再按需读 `.project/status/*.json`。",
  "- 已经在 user s14 注入的内容视为已读，不要重复 read 同一文件。",
  "",
  "**协作判断**",
  "- 任务方向不明且影响产出时，使用 `ask` 让作者选择，不要自行编造方向。",
  "- ≥3 步任务用 `todo` 写短计划。",
  "- 正文与卷纲细纲一律在主对话直写，保证连续性和文风一致；不要派给 `task`。",
  "- `task` 仅用于【批量信息类子任务】：按章批量更新设定/状态、多主题资料搜索、批量拆爆款、风格诊断、合规检查等彼此独立的工作。",
  "- 用 `task.tasks[]` 一次派发 ≥2 个独立子任务；公共前缀（章节摘要、人物清单、世界观片段等）放进 `sharedContext`，避免每个 prompt 重复塞。",
  "- 需要隔离上下文时，用 `task` 创建临时 subagent，并写清角色与边界。",
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
    "- 把当前目标视为跨多轮全自动任务，按工作流推进到验收完成。",
    "- 每轮先读取相关资料：项目默认上下文、当前阶段 run、状态 JSON、canon、style、chapters；缺证据时用 read / search / canon_query 补证据。",
    "- 每轮必须执行工作流：Inspect -> Skill Load -> Plan -> Act -> Verify -> State Maintain -> Report。",
    "- Skill Load 阶段：任务明显匹配已启用 skill 时，必须用 skill 工具读取对应 SKILL.md，再按需读取 references。",
    "- 目标未满足验收时，直接推进下一步；普通过程选择自行决策，不用 ask。",
    "- 遇到外部授权或高风险破坏性操作时，报告阻塞项和所需授权。",
    "- 涉及创作、规划、设定、审校的成果必须写回工作区文件；章节任务还要维护 `.project/runs/`、`.project/chapters/`、`.project/status/`。",
    '- 只有成果、验证、状态回写全部完成时，调用 `mode_control`，参数为 mode="autopilot"、action="complete"，reason 写明验收证据。',
    "- 未完成时继续推进下一步；不要调用 `mode_control` 的 complete 动作。",
  ].join("\n");
}

function buildFlowModeRules(context: FlowModeContext) {
  const workflowState = context.workflowState ?? createInitialFlowWorkflowState();
  return [
    "# 模式：WORKFLOW（程序控制工作流）",
    "",
    "**身份**",
    "- 你是长篇写作工作流执行器，当前阶段由程序状态机控制。",
    "",
    "**程序状态**",
    formatFlowWorkflowState(workflowState),
    "",
    "**强制工作流**",
    "- 只处理 currentStage 对应工作；完成本阶段后调用 `mode_control` 提交 complete_stage。",
    "- complete_stage 必须包含 stage 与 evidence；程序接受后再进入下一阶段。",
    "- 被程序 rejected 时，按 missing 补齐证据或动作，然后重新提交当前阶段。",
    "- 遇到外部授权或高风险操作时调用 `mode_control` 提交 blocked，并写 reason。",
    "- 所有阶段完成后调用 `mode_control` 提交 complete_workflow，并提供最终验收 evidence。",
    "",
    "**阶段门禁**",
    "- Inspect：读取 `.project/AGENTS.md`、`.project/README.md`、`.project/context-manifest.json`、相关 status JSON、canon/style/chapters/run 文件。",
    "- Skill Load：任务明显匹配已启用 skill 时，必须读取对应 `SKILL.md`；需要参考材料时再读 references。",
    "- Plan：用 todo 写出当前阶段计划，只保留一个 in_progress。",
    "- Act：按阶段执行，正文、卷纲、细纲由主代理串行写入。",
    "- Verify：用 read / word_count / canon_query / search 核对落地结果。",
    "- State Maintain：更新 `.project/runs/chapter-NNN.json`、`.project/chapters/`、`.project/status/`，必要时写 `.project/canon/` 和 `.project/style/`。",
    "- Report：只汇报阶段、改动文件、验证结果、下一阶段。",
    "",
    "**边界**",
    "- 可以使用 task 做市场、拆解、连续性、风格、状态维护等检查任务。",
    "- 正文生成、卷纲、细纲保持主代理串行直写。",
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
    `- 推荐工具：${card.tools.join(", ") || "按默认工具集执行"}`,
    card.banTools.length > 0 ? `- 禁用工具：${card.banTools.join(", ")}` : null,
    `- 写入范围：${card.writeScopes.join(", ") || "按项目 AGENTS 执行"}`,
    `- 上下文策略：${card.contextPolicyId}`,
    "",
    "**Subagent 边界**",
    card.allowedSubagents.length > 0
      ? `- 可委派：${card.allowedSubagents.join(", ")}`
      : "- 默认由主代理处理。",
    "- 正文、卷纲和细纲由主代理串行写入；subagent 只做资料、检查、诊断或状态维护建议。",
    "",
    "**长篇完成门禁**",
    "- 章节生产按 chapter-plan -> draft -> continuity-review -> style-polish -> state-maintain -> final-check 推进。",
    "- 每章记录写入 `.project/runs/chapter-NNN.json`，章节摘要写入 `.project/chapters/`。",
    "- 稳定 canon 写入 `.project/canon/`，文风事实写入 `.project/style/`，即时状态写入 `.project/status/*.json`。",
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
    case "flow":
      return buildFlowModeRules(context as FlowModeContext);
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
