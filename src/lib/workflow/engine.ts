import { getEnabledAgents, getResolvedAgents, useSubAgentStore } from "../../stores/subAgentStore";
import { getEnabledSkills, useSkillsStore } from "../../stores/skillsStore";
import { useAgentSettingsStore } from "../../stores/agentSettingsStore";
import { useBookWorkspaceStore } from "../../stores/bookWorkspaceStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { mergePart } from "../chat/sessionRuntime";
import { derivePlanningState } from "../agent/planning";
import { runAgentTurn } from "../agent/session";
import { createLocalResourceToolset, createWorkspaceToolset } from "../agent/tools";
import type {
  WorkflowDetail,
  WorkflowLoopControlStepDefinition,
  WorkflowReviewResult,
  WorkflowRun,
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

function buildStepPrompt(params: {
  basePrompt?: string | null;
  workflowName: string;
  teamMember: WorkflowTeamMember;
  step: WorkflowStepDefinition;
  loopIndex: number;
  attemptIndex: number;
  previousResult?: string | null;
  reviewResult?: WorkflowReviewResult | null;
}) {
  const { basePrompt, workflowName, teamMember, step, loopIndex, attemptIndex, previousResult, reviewResult } = params;
  const sections = [
    `你正在执行工作流《${workflowName}》中的步骤。`,
    basePrompt ? `工作流基础消息：\n${basePrompt}` : null,
    [
      "执行规则：",
      "- 当前步骤处理的数据事实以已绑定书籍工作区中的文件为准。",
      "- 开始前先使用 browse / search / read 等工具定位并读取相关文件，再继续处理。",
      "- 如需产出或修订内容，使用工作区工具直接写回对应文件。",
      "- 步骤之间的流转、返工和循环由程序控制，你只负责完成当前步骤，不要自行决定跳过、改序或结束流程。",
    ].join("\n"),
    `当前团队成员：${teamMember.name}`,
    `成员职责：${teamMember.roleLabel}`,
    teamMember.responsibilityPrompt ? `职责补充：${teamMember.responsibilityPrompt}` : null,
    `循环次数：${loopIndex}`,
    `返工次数：${attemptIndex}`,
    `步骤名称：${step.name}`,
    step.type === "agent_task" ? `步骤提示词：${step.promptTemplate}` : null,
    step.type === "review_gate" ? `审查提示词：${step.promptTemplate}` : null,
    previousResult
      ? `上一步结果摘要（仅供参考，涉及事实请回到工作区文件核对）：\n${previousResult}`
      : null,
    reviewResult
      ? `最近一次审查结果（仅供参考，涉及事实请回到工作区文件核对）：\n${JSON.stringify(reviewResult, null, 2)}`
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

async function executeConfiguredStep(params: {
  detail: WorkflowDetail;
  run: WorkflowRun;
  outputMode: "text" | "review_json";
  step: Extract<WorkflowStepDefinition, { type: "agent_task" | "review_gate" }>;
  loopIndex: number;
  attemptIndex: number;
  previousResult?: string | null;
  reviewResult?: WorkflowReviewResult | null;
  abortSignal: AbortSignal;
}) {
  const {
    detail,
    run,
    step,
    outputMode,
    loopIndex,
    attemptIndex,
    previousResult,
    reviewResult,
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
    loopIndex,
    attemptIndex,
    previousResult,
    reviewResult,
  });

  const stepRunBase: WorkflowStepRun = {
    id: createId("workflow-step-run"),
    runId: run.id,
    workflowId: detail.workflow.id,
    stepId: step.id,
    loopIndex,
    attemptIndex,
    memberId: member.id,
    status: "running",
    startedAt: getNow(),
    finishedAt: null,
    inputPrompt: prompt,
    resultText: "",
    resultJson: null,
    decision: null,
    parts: [],
    usage: null,
    errorMessage: null,
  };

  await useWorkflowStore.getState().saveStepRun(stepRunBase);
  await useWorkflowStore.getState().saveRun({
    ...run,
    currentLoopIndex: loopIndex,
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

  const finalStepRun: WorkflowStepRun = {
    ...stepRunBase,
    status: "completed",
    finishedAt: getNow(),
    resultText,
    resultJson: reviewResultValue,
    parts,
    usage,
  };

  await useWorkflowStore.getState().saveStepRun(finalStepRun);
  return finalStepRun;
}

function evaluateReviewGate(params: {
  reviewStepRun: WorkflowStepRun;
}): WorkflowStepRun {
  const { reviewStepRun } = params;
  return {
    ...reviewStepRun,
    decision: {
      outcome: "pass",
      reason: "审查节点已完成，后续流转按工作流程序配置继续执行。",
    },
    resultText: reviewStepRun.resultText || "审查节点已完成。",
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
  const shouldContinue = nextLoopIndex <= run.maxLoops;
  const stepRun: WorkflowStepRun = {
    id: createId("workflow-step-run"),
    runId: run.id,
    workflowId: detail.workflow.id,
    stepId: step.id,
    loopIndex: nextLoopIndex - 1,
    attemptIndex,
    memberId: null,
    status: "completed",
    startedAt: getNow(),
    finishedAt: getNow(),
    inputPrompt: "根据循环配置决定是否继续执行。",
    resultText: shouldContinue ? `继续进入第 ${nextLoopIndex} 轮循环。` : "已达到最大循环次数。",
    resultJson: null,
    decision: {
      outcome: shouldContinue ? "retry" : "pass",
      reason: shouldContinue ? "remainingLoops > 0" : "remainingLoops <= 0",
    },
    parts: [],
    usage: null,
    errorMessage: null,
  };

  return stepRun;
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
  await store.saveRun(run);
  store.setRunningState({ activeRunId: run.id, isRunning: true, stopRequested: false });

  try {
    let currentStep: WorkflowStepDefinition | null = detail.steps[0] ?? null;
    let loopIndex = 1;
    let attemptIndex = 1;
    let previousAgentStepRun: WorkflowStepRun | null = null;
    const latestStepRunsByStepId = new Map<string, WorkflowStepRun>();

    while (currentStep) {
      if (useWorkflowStore.getState().stopRequested) {
        abortController.abort();
        run = {
          ...run,
          status: "stopped",
          finishedAt: getNow(),
          stopReason: "manual_stop",
          summary: "用户手动停止了工作流运行。",
        };
        await store.saveRun(run);
        break;
      }

      if (currentStep.type === "agent_task") {
        previousAgentStepRun = await executeConfiguredStep({
          detail,
          outputMode: currentStep.outputMode,
          run,
          step: currentStep,
          loopIndex,
          attemptIndex,
          previousResult: previousAgentStepRun?.resultText ?? null,
          reviewResult: previousAgentStepRun?.resultJson ?? null,
          abortSignal: abortController.signal,
        });
        latestStepRunsByStepId.set(currentStep.id, previousAgentStepRun);
        run = {
          ...run,
          currentStepRunId: previousAgentStepRun.id,
          currentLoopIndex: loopIndex,
        };
        await store.saveRun(run);
        currentStep = getStepById(detail, currentStep.nextStepId);
        continue;
      }

      if (currentStep.type === "review_gate") {
        const sourceStepRun = latestStepRunsByStepId.get(currentStep.sourceStepId) ?? previousAgentStepRun;
        if (!sourceStepRun) {
          throw new Error(`审查判断步骤 ${currentStep.name} 缺少来源步骤结果。`);
        }
        const reviewStepRun = await executeConfiguredStep({
          abortSignal: abortController.signal,
          attemptIndex,
          step: currentStep,
          detail,
          loopIndex,
          outputMode: "review_json",
          previousResult: sourceStepRun.resultText ?? null,
          reviewResult: sourceStepRun.resultJson ?? null,
          run,
        });
        const stepRun = evaluateReviewGate({ reviewStepRun });
        await store.saveStepRun(stepRun);
        latestStepRunsByStepId.set(currentStep.id, stepRun);
        run = {
          ...run,
          currentStepRunId: stepRun.id,
          currentLoopIndex: loopIndex,
        };
        await store.saveRun(run);
        attemptIndex = 1;
        currentStep = getStepById(detail, currentStep.passNextStepId ?? currentStep.failNextStepId);
        continue;
      }

      const stepRun = evaluateLoopControl({
        detail,
        step: currentStep,
        run,
        nextLoopIndex: loopIndex + 1,
        attemptIndex,
      });
      await store.saveStepRun(stepRun);
      run = {
        ...run,
        currentStepRunId: stepRun.id,
      };
      await store.saveRun(run);

      if (loopIndex + 1 > run.maxLoops) {
        run = {
          ...run,
          status: "completed",
          finishedAt: getNow(),
          stopReason: "max_loops_reached",
          summary: `工作流已完成，共执行 ${loopIndex} 轮。`,
        };
        await store.saveRun(run);
        break;
      }

      loopIndex += 1;
      attemptIndex = 1;
      currentStep = getStepById(detail, currentStep.loopTargetStepId);
    }

    if (run.status === "running") {
      run = {
        ...run,
        status: "completed",
        finishedAt: getNow(),
        stopReason: "completed",
        summary: `工作流已顺利完成，共执行 ${loopIndex} 轮。`,
      };
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
      summary: "工作流运行异常结束。",
    };
    await store.saveRun(run);
    throw error;
  } finally {
    store.setRunningState({ activeRunId: null, isRunning: false, stopRequested: false });
  }
}
