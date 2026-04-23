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

const WORKFLOW_DECISION_TOOL_ID = "workflow_decision";

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

function buildAgentTaskRules(chapterWriteMode?: ChapterWriteMode) {
  return [
    "- 开始前先用 browse / search / read 等工具定位并读取当前节点真正需要的工作区文件。",
    "- 工作区文件是最终事实源；交接摘要和节点消息只提供线索，不替代文件核对。",
    "- 只完成当前代理节点负责的产出，不要代替判断节点做通过 / 失败分支决定。",
    chapterWriteMode === "new_chapter"
      ? "- 当前处于正常推进模式，可以继续完成本轮目标内容。"
      : null,
    chapterWriteMode === "rework_current_chapter"
      ? "- 当前处于返工模式，先对照最近一次审查问题修订当前对象；不要推进下一章或新的项目。"
      : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDecisionRules(step: WorkflowDecisionStepDefinition) {
  return [
    "- 这是判断节点。你的职责是基于当前产物完成审查与分支判断。",
    "- 开始前先读取被审对象、相关事实文件和必要上下文，再给结论。",
    "- 不要代替上游代理重写正文；聚焦判断是否通过，以及指出高价值问题。",
    `- 最终必须调用 ${WORKFLOW_DECISION_TOOL_ID} 提交结构化结果。`,
    "- pass=true 表示通过并进入成功分支。",
    "- pass=false 表示存在问题并进入失败分支。",
    "- reason 说明这次程序分支判断的原因。",
    "- issues 提交结构化问题列表，可为空数组。",
    "- revision_brief 提交给返工节点直接执行的修订摘要，可为空字符串。",
    `- 正文保持简短结论，程序分支只读取 ${WORKFLOW_DECISION_TOOL_ID} 的结果。`,
    step.falseNextStepId ? `- 当前失败分支会跳转到步骤 ID：${step.falseNextStepId}。` : null,
    step.trueNextStepId ? `- 当前通过分支会跳转到步骤 ID：${step.trueNextStepId}。` : null,
  ]
    .filter(Boolean)
    .join("\n");
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
    "交接上下文",
    [
      "以下信息由程序按预算整理，用于帮助你快速承接当前节点；涉及事实仍以工作区文件为准。",
      deltaMemory.text,
    ].join("\n\n"),
  );
}

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
    renderSection("执行边界", buildAgentTaskRules(chapterWriteMode)),
    ...buildRoleAndTaskSections(step, teamMember),
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
    renderSection("判断契约", buildDecisionRules(step as WorkflowDecisionStepDefinition)),
    ...buildRoleAndTaskSections(step, teamMember),
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
