import { getEnabledAgents, getResolvedAgents, useSubAgentStore } from "../../stores/subAgentStore";
import { getEnabledSkills, useSkillsStore } from "../../stores/skillsStore";
import { useAgentSettingsStore } from "../../stores/agentSettingsStore";
import { useBookWorkspaceStore } from "../../stores/bookWorkspaceStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { mergePart } from "../chat/sessionRuntime";
import { normalizeRecoveredMessageParts } from "../chat/sessionRuntime";
import { derivePlanningState } from "../agent/planning";
import { runAgentTurn } from "../agent/session";
import type { AgentPart } from "../agent/types";
import {
  createGlobalToolset,
  createLocalResourceToolset,
  createWorkspaceToolset,
} from "../agent/tools";
import { parseWorkflowMessagePayload } from "./api";
import type {
  WorkflowDecisionStepDefinition,
  WorkflowDetail,
  WorkflowEndStepDefinition,
  WorkflowMessagePayload,
  WorkflowReviewIssue,
  WorkflowReviewResult,
  WorkflowRun,
  WorkflowRunStopReason,
  WorkflowStartStepDefinition,
  WorkflowStepDefinition,
  WorkflowStepRun,
  WorkflowTeamMember,
} from "./types";

function createId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getNow() {
  return Date.now();
}

const WORKFLOW_DECISION_TOOL_ID = "workflow_decision";
type StepMessage = {
  messageType: string;
  messageJson: WorkflowMessagePayload;
};

type WorkflowRuntimeState = {
  loopIndex: number;
  attemptIndex: number;
  latestStepRunsByStepId: Map<string, WorkflowStepRun>;
  latestMessageByType: Map<string, WorkflowMessagePayload>;
  lastReviewResult: WorkflowReviewResult | null;
  lastDecision: WorkflowStepRun["decision"];
};

type WorkflowRunMode = "resume" | "start";

type WorkflowCursor = {
  currentStep: WorkflowStepDefinition | null;
  previousAgentStepRun: WorkflowStepRun | null;
};

type ChapterWriteMode = "new_chapter" | "rework_current_chapter";

function buildStepPrompt(params: {
  basePrompt?: string | null;
  workflowName: string;
  teamMember: WorkflowTeamMember;
  step: WorkflowStepDefinition;
  loopIndex: number;
  attemptIndex: number;
  previousResult?: string | null;
  reviewResult?: WorkflowReviewResult | null;
  incomingMessages?: Array<{ type: string; payload: WorkflowMessagePayload }>;
  chapterWriteMode?: ChapterWriteMode;
}) {
  const {
    basePrompt,
    workflowName,
    teamMember,
    step,
    loopIndex,
    attemptIndex,
    previousResult,
    reviewResult,
    incomingMessages = [],
    chapterWriteMode,
  } = params;
  const incomingMessageSummary =
    incomingMessages.length > 0
      ? incomingMessages
          .map((message) => `- ${message.type}: ${JSON.stringify(message.payload, null, 2)}`)
          .join("\n")
      : null;

  const sections = [
    `你正在执行工作流《${workflowName}》中的步骤。`,
    basePrompt ? `工作流基础消息：\n${basePrompt}` : null,
    [
      "执行规则：",
      "- 当前步骤处理的数据事实以已绑定书籍工作区中的文件为准。",
      "- 开始前先使用 browse / search / read 等工具定位并读取相关文件，再继续处理。",
      "- 如需产出或修订内容，使用工作区工具直接写回对应文件。",
      "- 节点消息只用于传递当前轮次的结构化协作上下文，不能替代你对工作区文件的核对。",
      "- 步骤之间的流转、修订和循环由程序控制，你只负责完成当前步骤，不要自行决定跳过、改序或结束流程。",
    ].join("\n"),
    `当前团队成员：${teamMember.name}`,
    `成员职责：${teamMember.roleLabel}`,
    teamMember.responsibilityPrompt ? `职责补充：${teamMember.responsibilityPrompt}` : null,
    `循环次数：${loopIndex}`,
    `当前章节尝试次数：${attemptIndex}`,
    chapterWriteMode
      ? chapterWriteMode === "new_chapter"
        ? "当前写作模式：new_chapter（生成下一章，允许创建新的章节文件）。"
        : "当前写作模式：rework_current_chapter（只修订本轮当前章节，禁止创建下一章或新的章节文件）。"
      : null,
    `步骤名称：${step.name}`,
    chapterWriteMode === "rework_current_chapter"
      ? "返工要求：必须基于最近一次审查结论和 revision_brief 修订当前章节；不要继续写下一章。"
      : null,
    chapterWriteMode === "new_chapter"
      ? "写作要求：本轮目标是推进到下一章；完成当前章节正文并写回工作区。"
      : null,
    reviewResult?.revision_brief?.trim()
      ? `当前章节修订摘要：${reviewResult.revision_brief}`
      : null,
    chapterWriteMode === "rework_current_chapter"
      ? "硬性约束：不得新建下一章，不得把当前返工误处理成继续连载。"
      : null,
    step.type === "agent_task" ? `步骤提示词：${step.promptTemplate}` : null,
    step.type === "decision"
      ? [
          `判断提示词：${step.promptTemplate}`,
          "判断节点执行规则：",
          `- 审查完成后，调用 ${WORKFLOW_DECISION_TOOL_ID} 工具提交最终结构化判定。`,
          "- pass=true 表示通过并进入成功分支。",
          "- pass=false 表示存在问题并进入失败分支。",
          "- issues 提交结构化问题列表。",
          "- revision_brief 提交给章节写作节点直接执行的修订摘要。",
          "- 正文不需要再输出严格 JSON。",
          `- 正文保持简短结论，程序分支读取 ${WORKFLOW_DECISION_TOOL_ID} 工具结果。`,
        ].join("\n")
      : null,
    previousResult
      ? `上一步结果摘要（仅供参考，涉及事实请回到工作区文件核对）：\n${previousResult}`
      : null,
    reviewResult
      ? `最近一次审查结果（仅供参考，涉及事实请回到工作区文件核对）：\n${JSON.stringify(reviewResult, null, 2)}`
      : null,
    incomingMessageSummary
      ? `当前可用的结构化消息（仅供协作参考，涉及事实请回到工作区文件核对）：\n${incomingMessageSummary}`
      : null,
  ].filter(Boolean);

  return sections.join("\n\n");
}

function getStepById(detail: WorkflowDetail, stepId: string | null) {
  if (!stepId) {
    return null;
  }
  return detail.steps.find((item) => item.id === stepId) ?? null;
}

function getTeamMemberById(detail: WorkflowDetail, memberId: string | null) {
  if (!memberId) {
    return null;
  }
  return detail.teamMembers.find((item) => item.id === memberId) ?? null;
}

function resolveWorkflowAgent(agentId: string) {
  return getResolvedAgents(useSubAgentStore.getState()).find(
    (item) => item.id === agentId && item.validation.isValid,
  ) ?? null;
}

function buildInitialRun(detail: WorkflowDetail): WorkflowRun {
  const workflow = detail.workflow;
  if (!workflow.workspaceBinding) {
    throw new Error("工作流尚未绑定书籍工作区。");
  }

  return {
    id: createId("workflow-run"),
    workflowId: workflow.id,
    status: "running",
    startedAt: getNow(),
    finishedAt: null,
    workspaceBinding: workflow.workspaceBinding,
    loopConfigSnapshot: workflow.loopConfig,
    currentLoopIndex: 1,
    maxLoops: workflow.loopConfig.maxLoops,
    currentStepRunId: null,
    stopReason: null,
    summary: null,
    errorMessage: null,
  };
}

function getEnabledToolIds(member: WorkflowTeamMember, forcedToolIds: string[] = []) {
  const enabledToolsMap = useAgentSettingsStore.getState().enabledTools;
  const globallyEnabledToolIds = Object.entries(enabledToolsMap)
    .filter(([, enabled]) => enabled)
    .map(([toolId]) => toolId);

  const baseToolIds =
    !member.allowedToolIds || member.allowedToolIds.length === 0
      ? globallyEnabledToolIds
      : globallyEnabledToolIds.filter((toolId) => member.allowedToolIds?.includes(toolId));

  return Array.from(new Set([...baseToolIds, ...forcedToolIds]));
}

function normalizeWorkflowReviewIssue(value: unknown): WorkflowReviewIssue | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  const type = typeof payload.type === "string" ? payload.type.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!type || !message) {
    return null;
  }

  const severityValue =
    typeof payload.severity === "string" ? payload.severity.trim() : "";
  const severity: WorkflowReviewIssue["severity"] =
    severityValue === "low" || severityValue === "medium" || severityValue === "high"
      ? severityValue
      : "medium";

  return {
    type,
    severity,
    message,
  };
}

function normalizeWorkflowReviewResult(value: unknown): WorkflowReviewResult | null {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return null;
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.pass !== "boolean") {
    return null;
  }

  const issues = Array.isArray(payload.issues)
    ? payload.issues
        .map((issue) => normalizeWorkflowReviewIssue(issue))
        .filter((issue): issue is WorkflowReviewIssue => Boolean(issue))
    : [];

  return {
    pass: payload.pass,
    issues,
    revision_brief:
      typeof payload.revision_brief === "string"
        ? payload.revision_brief.trim()
        : "",
  };
}

function extractWorkflowDecisionResult(parts: AgentPart[]): WorkflowReviewResult | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (
      (part.type === "tool-call" || part.type === "tool-result")
      && part.toolName === WORKFLOW_DECISION_TOOL_ID
      && part.status === "completed"
    ) {
      const result = normalizeWorkflowReviewResult(part.output);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

function requireWorkflowDecisionResult(
  step: Extract<WorkflowStepDefinition, { type: "decision" }>,
  directResult: WorkflowReviewResult | null,
  parts: AgentPart[],
) {
  const decisionResult = directResult ?? extractWorkflowDecisionResult(parts);
  if (!decisionResult) {
    throw new Error(
      `判断节点《${step.name}》缺少结构化判定结果，请补充通过结论、问题列表和修订摘要后重试。`,
    );
  }
  return decisionResult;
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function parseMessageEnvelope(text: string): StepMessage | null {
  const payload = parseWorkflowMessagePayload(text);
  if (!payload) {
    return null;
  }

  const candidateType =
    typeof payload.messageType === "string"
      ? payload.messageType.trim()
      : typeof payload.type === "string"
        ? payload.type.trim()
        : "";

  if (!candidateType) {
    return null;
  }

  const innerPayload = payload.payload;
  if (innerPayload && typeof innerPayload === "object" && !Array.isArray(innerPayload)) {
    return {
      messageType: candidateType,
      messageJson: innerPayload as WorkflowMessagePayload,
    };
  }

  const { messageType: _ignoredMessageType, type: _ignoredType, ...rest } = payload;
  return {
    messageType: candidateType,
    messageJson: Object.keys(rest).length > 0 ? rest : payload,
  };
}

function extractStepMessage(params: {
  outputMode: "text" | "review_json";
  resultText: string;
  reviewResultValue: WorkflowReviewResult | null;
}): StepMessage | null {
  const { outputMode, resultText, reviewResultValue } = params;
  if (outputMode === "review_json" && reviewResultValue) {
    return {
      messageType: "review_result",
      messageJson: reviewResultValue as unknown as WorkflowMessagePayload,
    };
  }
  return parseMessageEnvelope(resultText);
}

function getIncomingMessages(runtime: WorkflowRuntimeState) {
  return Array.from(runtime.latestMessageByType.entries()).map(([type, payload]) => ({ type, payload }));
}

function hasRemainingLoops(maxLoops: number | null, nextLoopIndex: number) {
  return maxLoops === null || nextLoopIndex <= maxLoops;
}

function updateRuntimeFromStepRun(runtime: WorkflowRuntimeState, stepRun: WorkflowStepRun) {
  runtime.latestStepRunsByStepId.set(stepRun.stepId, stepRun);
  runtime.lastDecision = stepRun.decision;

  if (stepRun.resultJson) {
    runtime.lastReviewResult = stepRun.resultJson;
    runtime.latestMessageByType.set("review_result", stepRun.resultJson as unknown as WorkflowMessagePayload);
    if (stepRun.resultJson.revision_brief.trim()) {
      runtime.latestMessageByType.set("revision_brief", {
        revision_brief: stepRun.resultJson.revision_brief,
        issues: stepRun.resultJson.issues,
      });
    }
  }

  if (stepRun.messageType && stepRun.messageJson) {
    runtime.latestMessageByType.set(stepRun.messageType, stepRun.messageJson);
  }
}

function isCompletedStepRun(stepRun: WorkflowStepRun) {
  return stepRun.status === "completed";
}

function sortStepRunsForReplay(stepRuns: WorkflowStepRun[]) {
  return [...stepRuns].sort((left, right) =>
    left.loopIndex - right.loopIndex
    || left.attemptIndex - right.attemptIndex
    || (left.startedAt ?? 0) - (right.startedAt ?? 0)
    || left.id.localeCompare(right.id),
  );
}

function normalizeInterruptedStepRun(stepRun: WorkflowStepRun): WorkflowStepRun {
  if (stepRun.status !== "running") {
    return stepRun;
  }

  return {
    ...stepRun,
    errorMessage: stepRun.errorMessage ?? "执行被中断，继续时会重新执行该步骤。",
    finishedAt: stepRun.finishedAt ?? getNow(),
    parts: normalizeRecoveredMessageParts(stepRun.parts),
    status: "failed",
  };
}

function inferNextStepFromCompletedRun(
  detail: WorkflowDetail,
  run: WorkflowRun,
  runtime: WorkflowRuntimeState,
) {
  let currentStep: WorkflowStepDefinition | null = resolveInitialStep(detail);
  let previousAgentStepRun: WorkflowStepRun | null = null;
  const completedStepRuns = sortStepRunsForReplay(
    detail.stepRuns.filter((stepRun) => stepRun.runId === run.id && isCompletedStepRun(stepRun)),
  );

  for (const stepRun of completedStepRuns) {
    const step = getStepById(detail, stepRun.stepId);
    if (!step || !currentStep || step.id !== currentStep.id) {
      continue;
    }

    runtime.loopIndex = stepRun.loopIndex;
    runtime.attemptIndex = stepRun.attemptIndex;
    updateRuntimeFromStepRun(runtime, stepRun);
    if (step.type === "agent_task" || step.type === "decision") {
      previousAgentStepRun = stepRun;
    }

    if (step.type === "start") {
      currentStep = getStepById(detail, step.nextStepId);
    } else if (step.type === "agent_task") {
      currentStep = getStepById(detail, step.nextStepId);
    } else if (step.type === "decision") {
      const evaluation = evaluateDecisionNode({
        attemptIndex: stepRun.attemptIndex,
        decisionStepRun: stepRun,
        step,
      });
      runtime.attemptIndex = evaluation.nextAttemptIndex;
      currentStep = getStepById(detail, evaluation.nextStepId);
    } else if (step.type === "end") {
      const nextLoopIndex = stepRun.loopIndex + 1;
      const shouldContinue =
        step.loopBehavior === "continue_if_possible"
        && step.loopTargetStepId
        && hasRemainingLoops(run.maxLoops, nextLoopIndex)
        && stepRun.decision?.outcome === "retry";
      if (!shouldContinue) {
        currentStep = null;
        break;
      }
      runtime.loopIndex = nextLoopIndex;
      runtime.attemptIndex = 1;
      runtime.lastReviewResult = null;
      currentStep = getStepById(detail, step.loopTargetStepId);
    }
  }

  return { currentStep, previousAgentStepRun } satisfies WorkflowCursor;
}

function createSystemStepRun(params: {
  detail: WorkflowDetail;
  run: WorkflowRun;
  step: WorkflowStartStepDefinition | WorkflowEndStepDefinition;
  loopIndex: number;
  attemptIndex: number;
  resultText: string;
  decision: NonNullable<WorkflowStepRun["decision"]>;
}) {
  const { detail, run, step, loopIndex, attemptIndex, resultText, decision } = params;
  const now = getNow();
  return {
    id: createId("workflow-step-run"),
    runId: run.id,
    workflowId: detail.workflow.id,
    stepId: step.id,
    loopIndex,
    attemptIndex,
    memberId: null,
    status: "completed",
    startedAt: now,
    finishedAt: now,
    inputPrompt: "程序节点自动执行。",
    resultText,
    resultJson: null,
    messageType: null,
    messageJson: null,
    decision,
    parts: [],
    usage: null,
    errorMessage: null,
  } satisfies WorkflowStepRun;
}

async function executeConfiguredStep(params: {
  detail: WorkflowDetail;
  run: WorkflowRun;
  outputMode: "text" | "review_json";
  step: Extract<WorkflowStepDefinition, { type: "agent_task" | "decision" }>;
  runtime: WorkflowRuntimeState;
  previousResult?: string | null;
  reviewResult?: WorkflowReviewResult | null;
  chapterWriteMode?: ChapterWriteMode;
  abortSignal: AbortSignal;
}) {
  const {
    detail,
    run,
    step,
    outputMode,
    runtime,
    previousResult,
    reviewResult,
    chapterWriteMode,
    abortSignal,
  } = params;
  const member = getTeamMemberById(detail, step.memberId);
  if (!member) {
    throw new Error(`未找到步骤 ${step.name} 对应的团队成员。`);
  }

  const agent = resolveWorkflowAgent(member.agentId);
  if (!agent) {
    throw new Error(`未找到可用代理：${member.agentId}。请检查代理中心配置。`);
  }

  const prompt = buildStepPrompt({
    basePrompt: detail.workflow.basePrompt,
    workflowName: detail.workflow.name,
    teamMember: member,
    step,
    loopIndex: runtime.loopIndex,
    attemptIndex: runtime.attemptIndex,
    previousResult,
    reviewResult,
    incomingMessages: getIncomingMessages(runtime),
    chapterWriteMode,
  });

  const stepRunBase: WorkflowStepRun = {
    id: createId("workflow-step-run"),
    runId: run.id,
    workflowId: detail.workflow.id,
    stepId: step.id,
    loopIndex: runtime.loopIndex,
    attemptIndex: runtime.attemptIndex,
    memberId: member.id,
    status: "running",
    startedAt: getNow(),
    finishedAt: null,
    inputPrompt: prompt,
    resultText: "",
    resultJson: null,
    messageType: null,
    messageJson: null,
    decision: null,
    parts: [],
    usage: null,
    errorMessage: null,
  };

  await useWorkflowStore.getState().saveStepRun(stepRunBase);
  await useWorkflowStore.getState().saveRun({
    ...run,
    currentLoopIndex: runtime.loopIndex,
    currentStepRunId: stepRunBase.id,
    status: "running",
  });

  const agentSettingsStore = useAgentSettingsStore.getState();
  if (agentSettingsStore.status !== "ready") {
    await agentSettingsStore.initialize();
  }
  const subAgentStore = useSubAgentStore.getState();
  if (subAgentStore.status === "idle") {
    await subAgentStore.initialize();
  }
  const skillsStore = useSkillsStore.getState();
  if (skillsStore.status === "idle") {
    await skillsStore.initialize();
  }

  const enabledSkills = getEnabledSkills(useSkillsStore.getState());
  const providerConfig = useAgentSettingsStore.getState().config;
  const enabledToolIds = getEnabledToolIds(
    member,
    step.type === "decision" ? [WORKFLOW_DECISION_TOOL_ID] : [],
  );
  const enabledAgents = getEnabledAgents(useSubAgentStore.getState()).filter((item) => item.id !== agent.id);
  const globalTools = createGlobalToolset();
  const workspaceTools = createWorkspaceToolset({
    rootPath: run.workspaceBinding.rootPath,
    onWorkspaceMutated: async () => {
      const workspaceState = useBookWorkspaceStore.getState();
      if (workspaceState.rootPath === run.workspaceBinding.rootPath) {
        await workspaceState.refreshWorkspaceAfterExternalChange();
      }
    },
  });
  let workflowDecisionResult: WorkflowReviewResult | null = null;
  const localResourceTools = createLocalResourceToolset({
    refreshAgents: async () => {
      await useSubAgentStore.getState().refresh();
    },
    refreshSkills: async () => {
      await useSkillsStore.getState().refresh();
    },
    onWorkflowDecision:
      step.type === "decision"
        ? (decision) => {
            workflowDecisionResult = decision;
          }
        : undefined,
  });

  let parts = stepRunBase.parts;
  let usage = stepRunBase.usage;
  const stream = runAgentTurn({
    abortSignal,
    activeFilePath: null,
    workspaceRootPath: run.workspaceBinding.rootPath,
    conversationHistory: [],
    defaultAgentMarkdown: agent.body,
    enabledAgents,
    enabledSkills,
    enabledToolIds,
    includeAgentCatalog: false,
    manualContext: null,
    onUsage: (nextUsage) => {
      usage = nextUsage;
    },
    planningState: derivePlanningState([]),
    prompt,
    providerConfig,
    workspaceTools: { ...globalTools, ...workspaceTools, ...localResourceTools },
    onToolRequestStateChange: ({ requestId, status }) => {
      useWorkflowStore.getState().trackInflightToolRequest(
        requestId,
        status === "start" ? "start" : "finish",
      );
    },
  });

  try {
    for await (const part of stream) {
      parts = mergePart(parts, part);
      await useWorkflowStore.getState().saveStepRun({
        ...stepRunBase,
        parts,
      });
    }
  } catch (error) {
    await useWorkflowStore.getState().saveStepRun({
      ...stepRunBase,
      errorMessage: error instanceof Error ? error.message : "步骤执行失败。",
      finishedAt: getNow(),
      parts: normalizeRecoveredMessageParts(parts),
      status: "failed",
      usage,
    });
    throw error;
  }

  const recoveredParts = normalizeRecoveredMessageParts(parts);
  if (recoveredParts !== parts) {
    parts = recoveredParts;
    await useWorkflowStore.getState().saveStepRun({
      ...stepRunBase,
      parts,
    });
  }

  const resultText = parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  const reviewResultValue = step.type === "decision"
    ? requireWorkflowDecisionResult(step, workflowDecisionResult, parts)
    : outputMode === "review_json"
      ? useWorkflowStore.getState().parseReviewResult(resultText)
      : null;
  const stepMessage = extractStepMessage({
    outputMode,
    resultText,
    reviewResultValue,
  });

  const finalStepRun: WorkflowStepRun = {
    ...stepRunBase,
    status: "completed",
    finishedAt: getNow(),
    resultText,
    resultJson: reviewResultValue,
    messageType: stepMessage?.messageType ?? null,
    messageJson: stepMessage?.messageJson ?? null,
    parts,
    usage,
  };

  await useWorkflowStore.getState().saveStepRun(finalStepRun);
  return finalStepRun;
}

function evaluateDecisionNode(params: {
  step: WorkflowDecisionStepDefinition;
  decisionStepRun: WorkflowStepRun;
  attemptIndex: number;
}): { stepRun: WorkflowStepRun; nextStepId: string | null; nextAttemptIndex: number; endReason: WorkflowRunStopReason | null } {
  const { step, decisionStepRun, attemptIndex } = params;
  const passed = decisionStepRun.resultJson?.pass === true;
  const nextStepId = passed ? step.trueNextStepId : step.falseNextStepId;

  const stepRun: WorkflowStepRun = {
    ...decisionStepRun,
    decision: {
      outcome: passed ? "pass" : "fail",
      reason: passed
        ? "判断节点提交的结构化结果 pass=true。"
        : "判断节点提交的结构化结果 pass=false，进入失败分支并回传修订意见。",
      branchKey: passed ? "true" : "false",
    },
    resultText: decisionStepRun.resultText || (passed ? "判断通过。" : "判断未通过。"),
  };

  return {
    stepRun,
    nextStepId,
    nextAttemptIndex: passed ? 1 : attemptIndex + 1,
    endReason: nextStepId ? null : "review_failed",
  };
}

function applyRunCompletion(run: WorkflowRun, stopReason: Exclude<WorkflowRunStopReason, null>, summary: string) {
  return {
    ...run,
    status: stopReason === "manual_stop" ? "stopped" : "completed",
    finishedAt: getNow(),
    stopReason,
    summary,
  } satisfies WorkflowRun;
}

function buildCompletionSummary(stopReason: Exclude<WorkflowRunStopReason, null>, runtime: WorkflowRuntimeState, endStep?: WorkflowEndStepDefinition) {
  switch (stopReason) {
    case "completed":
      return `工作流已顺利完成，共执行 ${runtime.loopIndex} 轮。`;
    case "manual_stop":
      return "用户手动停止了工作流运行。";
    case "paused":
      return "工作流已暂停，可稍后从当前进度继续。";
    case "review_failed":
      return "审查失败，且当前工作流未提供失败分支，运行结束。";
    case "end_node_reached":
      return endStep?.summaryTemplate?.trim() || `工作流在结束节点《${endStep?.name ?? "未命名结束节点"}》处结束。`;
    case "error":
      return "工作流运行异常结束。";
    default:
      return "工作流已结束。";
  }
}

function resolveInitialStep(detail: WorkflowDetail) {
  return detail.steps.find((step): step is WorkflowStartStepDefinition => step.type === "start") ?? detail.steps[0] ?? null;
}

function findResumableRun(detail: WorkflowDetail, runId?: string | null) {
  if (runId) {
    const run = detail.runs.find((item) => item.id === runId);
    if (run?.status === "paused" || run?.status === "failed") {
      return run;
    }
  }

  return detail.runs.find((run) => run.status === "paused" || run.status === "failed") ?? null;
}

async function loadWorkflowDetailForRun(workflowId: string) {
  const store = useWorkflowStore.getState();
  return store.currentDetail?.workflow.id === workflowId
    ? store.currentDetail
    : await (async () => {
        await store.loadWorkflowDetail(workflowId);
        const nextDetail = useWorkflowStore.getState().currentDetail;
        if (!nextDetail) {
          throw new Error("未找到工作流详情。");
        }
        return nextDetail;
      })();
}

async function runWorkflowFromCursor(params: {
  detail: WorkflowDetail;
  initialCursor: WorkflowCursor;
  mode: WorkflowRunMode;
  run: WorkflowRun;
  runtime: WorkflowRuntimeState;
}) {
  const { detail, initialCursor, mode, runtime } = params;
  const store = useWorkflowStore.getState();
  const abortController = new AbortController();
  let run: WorkflowRun = {
    ...params.run,
    errorMessage: null,
    finishedAt: null,
    status: "running" as const,
    stopReason: null,
    summary: mode === "resume" ? "继续执行中。" : null,
  };
  await store.saveRun(run);
  store.setRunningState({
    activeRunId: run.id,
    isRunning: true,
    stopRequested: false,
    abortController,
    inflightToolRequestIds: [],
  });

  try {
    let currentStep = initialCursor.currentStep;
    let previousAgentStepRun = initialCursor.previousAgentStepRun;

    while (currentStep) {
      if (useWorkflowStore.getState().stopRequested) {
        abortController.abort();
        return;
      }

      if (currentStep.type === "start") {
        const stepRun = createSystemStepRun({
          detail,
          run,
          step: currentStep,
          loopIndex: runtime.loopIndex,
          attemptIndex: runtime.attemptIndex,
          resultText: "开始节点已完成，进入首个执行节点。",
          decision: {
            outcome: "pass",
            reason: "开始节点仅负责初始化运行状态。",
            branchKey: "next",
          },
        });
        await store.saveStepRun(stepRun);
        updateRuntimeFromStepRun(runtime, stepRun);
        run = {
          ...run,
          currentLoopIndex: runtime.loopIndex,
          currentStepRunId: stepRun.id,
        };
        await store.saveRun(run);
        currentStep = getStepById(detail, currentStep.nextStepId);
        continue;
      }

      if (currentStep.type === "agent_task") {
        const chapterWriteMode: ChapterWriteMode | undefined =
          currentStep.name.includes("章节写作")
            ? runtime.attemptIndex > 1
              ? "rework_current_chapter"
              : "new_chapter"
            : undefined;
        previousAgentStepRun = await executeConfiguredStep({
          abortSignal: abortController.signal,
          chapterWriteMode,
          detail,
          outputMode: currentStep.outputMode,
          previousResult: previousAgentStepRun?.resultText ?? null,
          reviewResult: runtime.lastReviewResult,
          run,
          runtime,
          step: currentStep,
        });
        updateRuntimeFromStepRun(runtime, previousAgentStepRun);
        run = {
          ...run,
          currentLoopIndex: runtime.loopIndex,
          currentStepRunId: previousAgentStepRun.id,
        };
        await store.saveRun(run);
        currentStep = getStepById(detail, currentStep.nextStepId);
        continue;
      }

      if (currentStep.type === "decision") {
        const sourceStepRun = runtime.latestStepRunsByStepId.get(currentStep.sourceStepId) ?? previousAgentStepRun;
        if (!sourceStepRun) {
          throw new Error(`判断步骤 ${currentStep.name} 缺少来源步骤结果。`);
        }
        const decisionStepRun = await executeConfiguredStep({
          abortSignal: abortController.signal,
          detail,
          outputMode: "review_json",
          previousResult: sourceStepRun.resultText ?? null,
          reviewResult: runtime.lastReviewResult,
          run,
          runtime,
          step: currentStep,
        });
        const evaluation = evaluateDecisionNode({
          attemptIndex: runtime.attemptIndex,
          decisionStepRun,
          step: currentStep,
        });
        await store.saveStepRun(evaluation.stepRun);
        updateRuntimeFromStepRun(runtime, evaluation.stepRun);
        run = {
          ...run,
          currentLoopIndex: runtime.loopIndex,
          currentStepRunId: evaluation.stepRun.id,
        };
        await store.saveRun(run);

        runtime.attemptIndex = evaluation.nextAttemptIndex;
        run = { ...run, currentLoopIndex: runtime.loopIndex };
        if (evaluation.endReason) {
          run = applyRunCompletion(
            run,
            evaluation.endReason,
            buildCompletionSummary(evaluation.endReason, runtime),
          );
          await store.saveRun(run);
          break;
        }
        currentStep = getStepById(detail, evaluation.nextStepId);
        continue;
      }

      if (currentStep.type === "end") {
        const shouldContinue =
          currentStep.loopBehavior === "continue_if_possible"
          && currentStep.loopTargetStepId
          && hasRemainingLoops(run.maxLoops, runtime.loopIndex + 1);
        const stepRun = createSystemStepRun({
          detail,
          run,
          step: currentStep,
          loopIndex: runtime.loopIndex,
          attemptIndex: runtime.attemptIndex,
          resultText: shouldContinue
            ? `结束节点允许继续下一轮，准备进入第 ${runtime.loopIndex + 1} 轮。`
            : currentStep.summaryTemplate.trim() || `到达结束节点《${currentStep.name}》。`,
          decision: {
            outcome: shouldContinue ? "retry" : "end",
            reason: shouldContinue
              ? `结束节点要求在轮次允许时继续执行，下一轮从 ${currentStep.loopTargetStepId} 开始。`
              : `结束节点要求以 ${currentStep.stopReason} 结束工作流。`,
            branchKey: shouldContinue ? "continue" : currentStep.stopReason,
          },
        });
        await store.saveStepRun(stepRun);
        updateRuntimeFromStepRun(runtime, stepRun);
        run = {
          ...run,
          currentLoopIndex: runtime.loopIndex,
          currentStepRunId: stepRun.id,
        };
        await store.saveRun(run);

        if (shouldContinue) {
          runtime.loopIndex += 1;
          runtime.attemptIndex = 1;
          runtime.lastReviewResult = null;
          currentStep = getStepById(detail, currentStep.loopTargetStepId);
          continue;
        }

        const stopReason =
          currentStep.stopReason === "completed" ? "end_node_reached" : currentStep.stopReason;
        run = applyRunCompletion(
          run,
          stopReason,
          buildCompletionSummary(stopReason, runtime, currentStep),
        );
        await store.saveRun(run);
        break;
      }
    }

    if (run.status === "running") {
      run = applyRunCompletion(run, "completed", buildCompletionSummary("completed", runtime));
      await store.saveRun(run);
    }
  } catch (error) {
    if (useWorkflowStore.getState().stopRequested || isAbortError(error)) {
      run = {
        ...run,
        finishedAt: getNow(),
        status: "paused",
        stopReason: "paused",
        summary: buildCompletionSummary("paused", runtime),
      };
      await store.saveRun(run);
      return;
    }

    const message = error instanceof Error ? error.message : "工作流运行失败。";
    run = {
      ...run,
      errorMessage: message,
      finishedAt: getNow(),
      status: "failed",
      stopReason: "error",
      summary: buildCompletionSummary("error", runtime),
    };
    await store.saveRun(run);
    throw error;
  } finally {
    store.setRunningState({
      activeRunId: null,
      abortController: null,
      inflightToolRequestIds: [],
      isRunning: false,
      stopRequested: false,
    });
  }
}

export async function startWorkflowRun(workflowId: string) {
  const detail = await loadWorkflowDetailForRun(workflowId);
  if (!detail.workflow.workspaceBinding) {
    throw new Error("请先为工作流绑定一本书。");
  }

  const run = buildInitialRun(detail);
  const runtime: WorkflowRuntimeState = {
    loopIndex: 1,
    attemptIndex: 1,
    latestStepRunsByStepId: new Map(),
    latestMessageByType: new Map(),
    lastReviewResult: null,
    lastDecision: null,
  };
  await runWorkflowFromCursor({
    detail,
    initialCursor: {
      currentStep: resolveInitialStep(detail),
      previousAgentStepRun: null,
    },
    mode: "start",
    run,
    runtime,
  });
}

export async function resumeWorkflowRun(workflowId: string, runId?: string | null) {
  const detail = await loadWorkflowDetailForRun(workflowId);
  const run = findResumableRun(detail, runId);
  if (!run) {
    throw new Error("没有可继续的工作流运行。");
  }

  const normalizedStepRuns = detail.stepRuns
    .filter((stepRun) => stepRun.runId === run.id)
    .map(normalizeInterruptedStepRun);
  for (const stepRun of normalizedStepRuns) {
    if (stepRun.status === "failed") {
      await useWorkflowStore.getState().saveStepRun(stepRun);
    }
  }

  const refreshedDetail = await loadWorkflowDetailForRun(workflowId);
  const runtime: WorkflowRuntimeState = {
    loopIndex: run.currentLoopIndex || 1,
    attemptIndex: 1,
    latestStepRunsByStepId: new Map(),
    latestMessageByType: new Map(),
    lastReviewResult: null,
    lastDecision: null,
  };
  const cursor = inferNextStepFromCompletedRun(refreshedDetail, run, runtime);
  await runWorkflowFromCursor({
    detail: refreshedDetail,
    initialCursor: cursor,
    mode: "resume",
    run,
    runtime,
  });
}
