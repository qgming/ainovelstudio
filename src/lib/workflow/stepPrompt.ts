import { buildWorkflowDeltaMemory, type WorkflowMemoryMessage } from "./contextMemory";
import type {
  WorkflowDecisionStepDefinition,
  WorkflowReviewResult,
  WorkflowStepDefinition,
  WorkflowStepRun,
  WorkflowTeamMember,
} from "./types";

type ChapterWriteMode = "new_chapter" | "rework_current_chapter";

type PromptStep = Extract<WorkflowStepDefinition, { type: "agent_task" | "decision" }>;
type PreviousStepRunSnapshot = Pick<
  WorkflowStepRun,
  "messageJson" | "messageType" | "resultText"
>;

type BuildStepPromptInput = {
  basePrompt?: string | null;
  workflowName: string;
  teamMember: WorkflowTeamMember;
  step: PromptStep;
  attemptIndex: number;
  previousStepRun?: PreviousStepRunSnapshot | null;
  reviewResult?: WorkflowReviewResult | null;
  incomingMessages?: WorkflowMemoryMessage[];
  chapterWriteMode?: ChapterWriteMode;
};

function joinSections(sections: Array<string | null | undefined>) {
  return sections.filter((section): section is string => Boolean(section?.trim())).join("\n\n");
}

function renderSection(title: string, body?: string | null) {
  if (!body?.trim()) {
    return null;
  }

  return `## ${title}\n${body.trim()}`;
}

function normalizePromptForSimilarity(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "")
    .replace(/[，。！？；：、,.!?;:()[\]{}"'“”‘’`~<>《》【】\-_*#]/g, "");
}

function buildBigrams(value: string) {
  if (value.length < 2) {
    return new Set(value ? [value] : []);
  }

  const grams = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.add(value.slice(index, index + 2));
  }
  return grams;
}

function calculateDiceCoefficient(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }

  const leftBigrams = buildBigrams(left);
  const rightBigrams = buildBigrams(right);
  let overlap = 0;
  for (const gram of leftBigrams) {
    if (rightBigrams.has(gram)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

function arePromptsSimilar(left?: string | null, right?: string | null) {
  if (!left?.trim() || !right?.trim()) {
    return false;
  }

  const normalizedLeft = normalizePromptForSimilarity(left);
  const normalizedRight = normalizePromptForSimilarity(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return true;
  }

  return calculateDiceCoefficient(normalizedLeft, normalizedRight) >= 0.82;
}

function buildIdentitySection(params: {
  attemptIndex: number;
  chapterWriteMode?: ChapterWriteMode;
  step: PromptStep;
  teamMember: WorkflowTeamMember;
}) {
  const { attemptIndex, chapterWriteMode, step, teamMember } = params;

  return [
    `- 节点类型：${step.type === "decision" ? "判断节点（decision）" : "代理节点（agent_task）"}`,
    `- 步骤名称：${step.name}`,
    `- 当前团队成员：${teamMember.name}`,
    `- 成员职责：${teamMember.roleLabel}`,
    `- 当前步骤尝试次数：${attemptIndex}`,
    chapterWriteMode ? `- 当前写作模式：${chapterWriteMode}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// 节点契约规则已上提到 system prompt 的 modeRules（见 src/lib/agent/modeRules.ts），
// user 侧只保留事实信息：身份、当前任务、交接上下文。
function buildDecisionDispatchHint(step: WorkflowDecisionStepDefinition) {
  const lines = [
    step.falseNextStepId
      ? `- 当前失败分支会跳转到步骤 ID：${step.falseNextStepId}。`
      : null,
    step.trueNextStepId
      ? `- 当前通过分支会跳转到步骤 ID：${step.trueNextStepId}。`
      : null,
  ].filter(Boolean);
  return lines.length > 0 ? lines.join("\n") : null;
}

function buildRoleAndTaskSections(step: PromptStep, teamMember: WorkflowTeamMember) {
  const roleGuidance = teamMember.responsibilityPrompt?.trim() || "";
  const stepTask = step.promptTemplate?.trim() || "";

  if (roleGuidance && stepTask && arePromptsSimilar(roleGuidance, stepTask)) {
    return [renderSection("当前任务", stepTask)];
  }

  return [
    renderSection("角色职责", roleGuidance),
    renderSection("当前任务", stepTask),
  ];
}

function buildDeltaSection(params: {
  incomingMessages: WorkflowMemoryMessage[];
  previousStepRun?: PreviousStepRunSnapshot | null;
  reviewResult?: WorkflowReviewResult | null;
}) {
  const { incomingMessages, previousStepRun, reviewResult } = params;
  const previousMessage =
    previousStepRun?.messageType && previousStepRun.messageJson
      ? {
          payload: previousStepRun.messageJson,
          type: previousStepRun.messageType,
        }
      : null;
  const deltaMemory = buildWorkflowDeltaMemory({
    incomingMessages,
    previousMessage,
    previousResult: previousMessage ? null : previousStepRun?.resultText ?? null,
    reviewResult,
  });

  if (!deltaMemory.text) {
    return null;
  }

  return renderSection(
    "线索摘要",
    [
      "以下信息由程序按预算整理，仅作线索；事实仍以工作区文件为准，必要时用 read 重新核对。",
      deltaMemory.text,
    ].join("\n\n"),
  );
}

function buildAgentTaskExecutionRules(params: {
  chapterWriteMode?: ChapterWriteMode;
}) {
  const { chapterWriteMode } = params;
  const lines = [
    "- 严格执行 system s00 Agent OS 内核：Inspect → Plan → Act → Verify → Report；除纯方法论外不得跳过 Inspect。",
    "- 工作区文件是事实源；交接上下文只是线索，不替代 read。",
    "- 只完成本节点产出，不替判断节点决定通过/失败，不替下游节点提前推进。",
    "- 实际产出必须用工具写回工作区文件，不要把正文堆在对话里。",
    "- 改已有文件优先 edit / json，新建用 path + write，不无故整文件覆盖。",
  ];
  if (chapterWriteMode === "rework_current_chapter") {
    lines.push(
      "- 当前处于【返工模式】：只针对最近一次审查问题修订当前对象，不推进到下一章或新对象。",
    );
  } else if (chapterWriteMode === "new_chapter") {
    lines.push("- 当前处于【正常推进】：完成本轮目标对象。");
  }
  lines.push(
    "- 完成后用一段简短中文摘要说明：改了哪些文件、关键决策、风险与下一节点交接要点。",
  );
  return lines.join("\n");
}

const DECISION_CONTRACT = [
  "- 唯一职责：审查上一步产物，给出通过 / 失败判断；不重写正文，不派发子任务。",
  "- 必须在节点结束前调用一次 `workflow_decision`，工作流引擎只读取该 tool 结果，不解析正文。",
  "- 字段要求：",
  "  - pass: boolean，true 进入成功分支，false 进入失败分支。",
  "  - reason: 一句话判断原因。",
  "  - issues: 结构化数组，元素 {type, severity: low|medium|high, message}；无问题填空数组。",
  "  - revision_brief: 给返工节点的可执行修订单；pass=true 可填空字符串。",
  "- 正文回复保持简短结论一段话即可，仅供作者阅读。",
].join("\n");

function buildAgentTaskPrompt(input: BuildStepPromptInput) {
  const {
    attemptIndex,
    basePrompt,
    chapterWriteMode,
    incomingMessages = [],
    previousStepRun,
    reviewResult,
    step,
    teamMember,
    workflowName,
  } = input;

  return joinSections([
    `你正在执行工作流《${workflowName}》中的代理节点。`,
    renderSection("工作流目标", basePrompt),
    renderSection(
      "节点身份",
      buildIdentitySection({ attemptIndex, chapterWriteMode, step, teamMember }),
    ),
    ...buildRoleAndTaskSections(step, teamMember),
    renderSection("执行边界", buildAgentTaskExecutionRules({ chapterWriteMode })),
    buildDeltaSection({
      incomingMessages,
      previousStepRun,
      reviewResult,
    }),
  ]);
}

function buildDecisionPrompt(input: BuildStepPromptInput) {
  const {
    attemptIndex,
    basePrompt,
    incomingMessages = [],
    previousStepRun,
    reviewResult,
    step,
    teamMember,
    workflowName,
  } = input;

  return joinSections([
    `你正在执行工作流《${workflowName}》中的判断节点。`,
    renderSection("工作流目标", basePrompt),
    renderSection(
      "节点身份",
      buildIdentitySection({ attemptIndex, step, teamMember }),
    ),
    renderSection(
      "分支跳转表",
      buildDecisionDispatchHint(step as WorkflowDecisionStepDefinition),
    ),
    ...buildRoleAndTaskSections(step, teamMember),
    renderSection("判断契约", DECISION_CONTRACT),
    buildDeltaSection({
      incomingMessages,
      previousStepRun,
      reviewResult,
    }),
  ]);
}

export function buildStepPrompt(input: BuildStepPromptInput) {
  return input.step.type === "decision"
    ? buildDecisionPrompt(input)
    : buildAgentTaskPrompt(input);
}
