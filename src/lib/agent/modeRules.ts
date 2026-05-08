/**
 * 模式专属系统规则文本。
 * 由 buildSystemPrompt 在 s04a 段落渲染。
 *
 * 设计原则：
 * - 通用任务循环、事实源优先级、工具调用边界已写入 s00 Agent OS 内核；
 *   本文件只保留每个模式的差异化契约，不重复 Kernel 内容。
 * - 短而硬：每条规则要么是"必须 / 禁止"，要么是"分支判断"；不写方法论。
 */

export type AgentMode = "book" | "autopilot";

export type BookModeContext = Record<string, never>;
export type AutopilotModeContext = {
  goal: string;
  iteration: number;
};

export type ModeContextMap = {
  autopilot: AutopilotModeContext;
  book: BookModeContext;
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
    "# 模式：AUTOPILOT（目标）",
    "",
    "**当前目标**",
    `- 目标：${goal}`,
    `- 当前自动执行轮次：第 ${iteration} 轮`,
    "",
    "**执行契约**",
    "- 把当前目标视为跨多轮任务，不要在单轮结束后被动等待。",
    "- 每轮先检查目标完成度；目标未完成时，直接推进最有价值的下一步。",
    "- 只有缺少用户专属判断、外部授权或高风险破坏性操作时，才使用 `ask` 暂停等待用户。",
    "- 涉及创作、规划、设定、审校的成果必须写回工作区文件，写回后再核对是否满足目标。",
    "- 目标完成时，在最终回复中明确写出「目标已完成」。",
    "- 目标未完成时，不要写「目标已完成」，并给出下一步已经推进到哪里。",
  ].join("\n");
}

export function buildModeRules<M extends AgentMode>(
  mode: M,
  context: ModeContextMap[M],
): string {
  switch (mode) {
    case "autopilot":
      return buildAutopilotModeRules(context as AutopilotModeContext);
    case "book":
      return BOOK_MODE_RULES;
    default:
      return BOOK_MODE_RULES;
  }
}
