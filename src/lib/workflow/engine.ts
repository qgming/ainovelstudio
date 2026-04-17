import { getEnabledAgents, getResolvedAgents, useSubAgentStore } from "../../stores/subAgentStore";
import { getEnabledSkills, useSkillsStore } from "../../stores/skillsStore";
import { useAgentSettingsStore } from "../../stores/agentSettingsStore";
import { useBookWorkspaceStore } from "../../stores/bookWorkspaceStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { mergePart } from "../chat/sessionRuntime";
import { derivePlanningState } from "../agent/planning";
import { runAgentTurn } from "../agent/session";
import { createLocalResourceToolset, createWorkspaceToolset } from "../agent/tools";
import { parseWorkflowMessagePayload } from "./api";
import type {
  WorkflowDecisionStepDefinition,
  WorkflowDetail,
  WorkflowEndStepDefinition,
  WorkflowLoopControlStepDefinition,
  WorkflowMessagePayload,
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
      "- 步骤之间的流转、返工和循环由程序控制，你只负责完成当前步骤，不要自行决定跳过、改序或结束流程。",
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
    step.type === "review_gate" ? `审查提示词：${step.promptTemplate}` : null,
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

function getEnabledToolIds(member: WorkflowTeamMember) {
  const enabledToolsMap = useAgentSettingsStore.getState().enabledTools;
  const globallyEnabledToolIds = Object.entries(enabledToolsMap)
    .filter(([, enabled]) => enabled)
    .map(([toolId]) => toolId);

  if (!member.allowedToolIds || member.allowedToolIds.length === 0) {
    return globallyEnabledToolIds;
  }

  return globallyEnabledToolIds.filter((toolId) => member.allowedToolIds?.includes(toolId));
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

function createSystemStepRun(params: {
  detail: WorkflowDetail;
  run: WorkflowRun;
  step: WorkflowStartStepDefinition | WorkflowDecisionStepDefinition | WorkflowLoopControlStepDefinition | WorkflowEndStepDefinition;
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
  step: Extract<WorkflowStepDefinition, { type: "agent_task" | "review_gate" }>;
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
  const enabledToolIds = getEnabledToolIds(member);
  const enabledAgents = getEnabledAgents(useSubAgentStore.getState()).filter((item) => item.id !== agent.id);
  const workspaceTools = createWorkspaceToolset({
    rootPath: run.workspaceBinding.rootPath,
    onWorkspaceMutated: async () => {
      const workspaceState = useBookWorkspaceStore.getState();
      if (workspaceState.rootPath === run.workspaceBinding.rootPath) {
        await workspaceState.refreshWorkspaceAfterExternalChange();
      }
    },
  });
  const localResourceTools = createLocalResourceToolset({
    refreshAgents: async () => {
      await useSubAgentStore.getState().refresh();
    },
    refreshSkills: async () => {
      await useSkillsStore.getState().refresh();
    },
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
    manualContext: null,
    onUsage: (nextUsage) => {
      usage = nextUsage;
    },
    planningState: derivePlanningState([]),
    prompt,
    providerConfig,
    workspaceTools: { ...workspaceTools, ...localResourceTools },
    onToolRequestStateChange: () => {},
  });
  for await (const part of stream) {
    parts = mergePart(parts, part);
    await useWorkflowStore.getState().saveStepRun({
      ...stepRunBase,
      parts,
    });
  }

  const resultText = parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  const reviewResultValue =
    outputMode === "review_json" ? useWorkflowStore.getState().parseReviewResult(resultText) : null;
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

function evaluateReviewGate(params: {
  run: WorkflowRun;
  step: Extract<WorkflowStepDefinition, { type: "review_gate" }>;
  reviewStepRun: WorkflowStepRun;
  attemptIndex: number;
}): { stepRun: WorkflowStepRun; nextStepId: string | null; nextAttemptIndex: number; endReason: WorkflowRunStopReason | null } {
  const { step, reviewStepRun, attemptIndex } = params;
  const passed = reviewStepRun.resultJson?.pass === true;

  const stepRun: WorkflowStepRun = {
    ...reviewStepRun,
    decision: {
      outcome: passed ? "pass" : "fail",
      reason: passed
        ? "review_json.pass == true"
        : "review_json.pass == false，反馈当前审查问题并返回失败分支。",
      branchKey: passed ? "pass" : "fail_feedback_current_chapter",
    },
    resultText: reviewStepRun.resultText || (passed ? "审查通过。" : "审查未通过。"),
  };

  if (passed) {
    return {
      stepRun,
      nextStepId: step.passNextStepId,
      nextAttemptIndex: 1,
      endReason: null,
    };
  }

  return {
    stepRun,
    nextStepId: step.failNextStepId,
    nextAttemptIndex: attemptIndex + 1,
    endReason: step.failNextStepId ? null : "review_failed",
  };
}

function evaluateLoopControl(params: {
  detail: WorkflowDetail;
  step: WorkflowLoopControlStepDefinition;
  run: WorkflowRun;
  nextLoopIndex: number;
  attemptIndex: number;
}) {
  const { detail, step, run, nextLoopIndex, attemptIndex } = params;
  const shouldContinue = hasRemainingLoops(run.maxLoops, nextLoopIndex);
  const stepRun = createSystemStepRun({
    detail,
    run,
    step,
    loopIndex: nextLoopIndex - 1,
    attemptIndex,
    resultText: shouldContinue ? `继续进入第 ${nextLoopIndex} 轮循环。` : "已达到最大循环次数。",
    decision: {
      outcome: shouldContinue ? "retry" : "end",
      reason: shouldContinue ? "remainingLoops > 0" : "remainingLoops <= 0",
      branchKey: shouldContinue ? "continue" : "finish",
    },
  });

  return {
    stepRun,
    shouldContinue,
  };
}

function evaluateDecision(params: {
  detail: WorkflowDetail;
  run: WorkflowRun;
  step: WorkflowDecisionStepDefinition;
  runtime: WorkflowRuntimeState;
}) {
  const { detail, run, step, runtime } = params;
  const { loopIndex, attemptIndex, lastReviewResult } = runtime;
  let passed = false;
  let reason = "";

  const configMaxLoopsRaw = step.conditionConfig.maxLoops;
  const maxLoops = typeof configMaxLoopsRaw === "number" && configMaxLoopsRaw > 0
    ? configMaxLoopsRaw
    : configMaxLoopsRaw === null
      ? null
      : run.loopConfigSnapshot.maxLoops;
  const stopOnReviewFailure =
    typeof step.conditionConfig.stopOnReviewFailure === "boolean"
      ? step.conditionConfig.stopOnReviewFailure
      : run.loopConfigSnapshot.stopOnReviewFailure;

  switch (step.conditionKind) {
    case "review_pass":
      passed = lastReviewResult?.pass === true;
      reason = passed ? "最近一次审查通过。" : "最近一次审查未通过。";
      break;
    case "rework_available":
      passed = true;
      reason = `兼容旧版返工判断节点：当前第 ${attemptIndex} 次尝试，继续回到修订分支。`;
      break;
    case "remaining_loops_available":
      passed = hasRemainingLoops(maxLoops, loopIndex + 1);
      reason = passed
        ? `仍可进入下一章，当前第 ${loopIndex} 轮，主循环上限 ${maxLoops ?? "无限"}。`
        : `已达到主循环上限 ${maxLoops ?? "无限"}。`;
      break;
    case "stop_on_review_failure":
      passed = stopOnReviewFailure;
      reason = passed ? "配置要求审查失败时停止工作流。" : "配置允许审查失败后继续沿失败分支执行。";
      break;
    default: {
      const exhaustiveKind: never = step.conditionKind;
      throw new Error(`不支持的判断条件类型：${exhaustiveKind}`);
    }
  }

  const stepRun = createSystemStepRun({
    detail,
    run,
    step,
    loopIndex,
    attemptIndex,
    resultText: reason,
    decision: {
      outcome: passed ? "pass" : "fail",
      reason,
      branchKey: passed ? "true" : "false",
    },
  });

  return {
    stepRun,
    passed,
    nextStepId: passed ? step.trueNextStepId : step.falseNextStepId,
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
    case "max_loops_reached":
      return `已达到最大循环次数 ${runtime.loopIndex}，工作流结束。`;
    case "review_failed":
      return "审查失败，且当前工作流未提供失败分支，运行结束。";
    case "max_rework_reached":
      return `当前轮返工次数已达上限 ${runtime.attemptIndex}，工作流结束。`;
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

export async function startWorkflowRun(workflowId: string) {
  const store = useWorkflowStore.getState();
  const detail = store.currentDetail?.workflow.id === workflowId
    ? store.currentDetail
    : await (async () => {
        await store.loadWorkflowDetail(workflowId);
        const nextDetail = useWorkflowStore.getState().currentDetail;
        if (!nextDetail) {
          throw new Error("未找到工作流详情。");
        }
        return nextDetail;
      })();

  if (!detail.workflow.workspaceBinding) {
    throw new Error("请先为工作流绑定一本书。");
  }

  const abortController = new AbortController();
  let run = buildInitialRun(detail);
  const runtime: WorkflowRuntimeState = {
    loopIndex: 1,
    attemptIndex: 1,
    latestStepRunsByStepId: new Map(),
    latestMessageByType: new Map(),
    lastReviewResult: null,
    lastDecision: null,
  };
  await store.saveRun(run);
  store.setRunningState({ activeRunId: run.id, isRunning: true, stopRequested: false });

  try {
    let currentStep: WorkflowStepDefinition | null = resolveInitialStep(detail);
    let previousAgentStepRun: WorkflowStepRun | null = null;

    while (currentStep) {
      if (useWorkflowStore.getState().stopRequested) {
        abortController.abort();
        run = applyRunCompletion(run, "manual_stop", buildCompletionSummary("manual_stop", runtime));
        await store.saveRun(run);
        break;
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
          currentStepRunId: stepRun.id,
          currentLoopIndex: runtime.loopIndex,
        };
        await store.saveRun(run);
        currentStep = getStepById(detail, currentStep.nextStepId);
        continue;
      }

      if (currentStep.type === "agent_task") {
        const chapterWriteMode: ChapterWriteMode | undefined =
          currentStep.type === "agent_task" && currentStep.name.includes("章节写作")
            ? runtime.attemptIndex > 1
              ? "rework_current_chapter"
              : "new_chapter"
            : undefined;
        previousAgentStepRun = await executeConfiguredStep({
          detail,
          outputMode: currentStep.outputMode,
          run,
          step: currentStep,
          runtime,
          previousResult: previousAgentStepRun?.resultText ?? null,
          reviewResult: runtime.lastReviewResult,
          chapterWriteMode,
          abortSignal: abortController.signal,
        });
        updateRuntimeFromStepRun(runtime, previousAgentStepRun);
        run = {
          ...run,
          currentStepRunId: previousAgentStepRun.id,
          currentLoopIndex: runtime.loopIndex,
        };
        await store.saveRun(run);
        currentStep = getStepById(detail, currentStep.nextStepId);
        continue;
      }

      if (currentStep.type === "review_gate") {
        const sourceStepRun = runtime.latestStepRunsByStepId.get(currentStep.sourceStepId) ?? previousAgentStepRun;
        if (!sourceStepRun) {
          throw new Error(`审查判断步骤 ${currentStep.name} 缺少来源步骤结果。`);
        }
        const reviewStepRun = await executeConfiguredStep({
          abortSignal: abortController.signal,
          step: currentStep,
          detail,
          outputMode: "review_json",
          previousResult: sourceStepRun.resultText ?? null,
          reviewResult: runtime.lastReviewResult,
          run,
          runtime,
        });
        const evaluation = evaluateReviewGate({
          run,
          step: currentStep,
          reviewStepRun,
          attemptIndex: runtime.attemptIndex,
        });
        await store.saveStepRun(evaluation.stepRun);
        updateRuntimeFromStepRun(runtime, evaluation.stepRun);
        run = {
          ...run,
          currentStepRunId: evaluation.stepRun.id,
          currentLoopIndex: runtime.loopIndex,
        };
        await store.saveRun(run);

        runtime.attemptIndex = evaluation.nextAttemptIndex;
        run = {
          ...run,
          currentLoopIndex: runtime.loopIndex,
        };
        if (evaluation.endReason) {
          run = applyRunCompletion(run, evaluation.endReason, buildCompletionSummary(evaluation.endReason, runtime));
          await store.saveRun(run);
          break;
        }
        currentStep = getStepById(detail, evaluation.nextStepId);
        continue;
      }

      if (currentStep.type === "decision") {
        const evaluation = evaluateDecision({
          detail,
          run,
          step: currentStep,
          runtime,
        });
        await store.saveStepRun(evaluation.stepRun);
        updateRuntimeFromStepRun(runtime, evaluation.stepRun);
        run = {
          ...run,
          currentStepRunId: evaluation.stepRun.id,
          currentLoopIndex: runtime.loopIndex,
        };
        await store.saveRun(run);

        currentStep = getStepById(detail, evaluation.nextStepId);
        continue;
      }

      if (currentStep.type === "loop_control") {
        const evaluation = evaluateLoopControl({
          detail,
          step: currentStep,
          run,
          nextLoopIndex: runtime.loopIndex + 1,
          attemptIndex: runtime.attemptIndex,
        });
        await store.saveStepRun(evaluation.stepRun);
        updateRuntimeFromStepRun(runtime, evaluation.stepRun);
        run = {
          ...run,
          currentStepRunId: evaluation.stepRun.id,
          currentLoopIndex: runtime.loopIndex,
        };
        await store.saveRun(run);

        if (!evaluation.shouldContinue) {
          run = applyRunCompletion(run, "max_loops_reached", buildCompletionSummary("max_loops_reached", runtime));
          await store.saveRun(run);
          break;
        }

        runtime.loopIndex += 1;
        runtime.attemptIndex = 1;
        runtime.lastReviewResult = null;
        currentStep = getStepById(detail, currentStep.loopTargetStepId);
        continue;
      }

      if (currentStep.type === "end") {
        const stepRun = createSystemStepRun({
          detail,
          run,
          step: currentStep,
          loopIndex: runtime.loopIndex,
          attemptIndex: runtime.attemptIndex,
          resultText: currentStep.summaryTemplate.trim() || `到达结束节点《${currentStep.name}》。`,
          decision: {
            outcome: "end",
            reason: `结束节点要求以 ${currentStep.stopReason} 结束工作流。`,
            branchKey: currentStep.stopReason,
          },
        });
        await store.saveStepRun(stepRun);
        updateRuntimeFromStepRun(runtime, stepRun);
        run = {
          ...run,
          currentStepRunId: stepRun.id,
          currentLoopIndex: runtime.loopIndex,
        };
        run = applyRunCompletion(
          run,
          currentStep.stopReason === "completed" ? "end_node_reached" : currentStep.stopReason,
          buildCompletionSummary(
            currentStep.stopReason === "completed" ? "end_node_reached" : currentStep.stopReason,
            runtime,
            currentStep,
          ),
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
    const message = error instanceof Error ? error.message : "工作流运行失败。";
    run = {
      ...run,
      status: "failed",
      finishedAt: getNow(),
      stopReason: "error",
      errorMessage: message,
      summary: buildCompletionSummary("error", runtime),
    };
    await store.saveRun(run);
    throw error;
  } finally {
    store.setRunningState({ activeRunId: null, isRunning: false, stopRequested: false });
  }
}
