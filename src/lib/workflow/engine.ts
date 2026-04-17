import { getEnabledAgents, useSubAgentStore, type ResolvedAgent } from "../../stores/subAgentStore";
import { getEnabledSkills, useSkillsStore } from "../../stores/skillsStore";
import { useAgentSettingsStore } from "../../stores/agentSettingsStore";
import { useBookWorkspaceStore } from "../../stores/bookWorkspaceStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import type { AgentPart } from "../agent/types";
import { streamAgentText } from "../agent/modelGateway";
import { runSubAgentTask } from "../agent/session";
import { createLocalResourceToolset, createWorkspaceToolset } from "../agent/tools";
import type {
  WorkflowDetail,
  WorkflowLoopControlStepDefinition,
  WorkflowReviewGateStepDefinition,
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
  workflowName: string;
  teamMember: WorkflowTeamMember;
  step: WorkflowStepDefinition;
  loopIndex: number;
  attemptIndex: number;
  previousResult?: string | null;
  reviewResult?: WorkflowReviewResult | null;
}) {
  const { workflowName, teamMember, step, loopIndex, attemptIndex, previousResult, reviewResult } = params;
  const sections = [
    `你正在执行工作流《${workflowName}》中的步骤。`,
    `当前团队成员：${teamMember.name}`,
    `成员职责：${teamMember.roleLabel}`,
    teamMember.responsibilityPrompt ? `职责补充：${teamMember.responsibilityPrompt}` : null,
    `循环次数：${loopIndex}`,
    `返工次数：${attemptIndex}`,
    `步骤名称：${step.name}`,
    step.type === "agent_task" ? `步骤提示词：${step.promptTemplate}` : null,
    previousResult ? `上一步结果摘要：\n${previousResult}` : null,
    reviewResult
      ? `最近一次审查结果：\n${JSON.stringify(reviewResult, null, 2)}`
      : null,
    step.type === "agent_task" && step.outputMode === "review_json"
      ? [
          "你必须返回严格 JSON，不要添加代码块包裹，不要输出 JSON 之外的说明。",
          'JSON 格式示例：{"pass": true, "issues": [], "revision_brief": ""}',
        ].join("\n")
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

async function executeAgentStep(params: {
  detail: WorkflowDetail;
  run: WorkflowRun;
  step: Extract<WorkflowStepDefinition, { type: "agent_task" }>;
  loopIndex: number;
  attemptIndex: number;
  previousResult?: string | null;
  reviewResult?: WorkflowReviewResult | null;
  abortSignal: AbortSignal;
}) {
  const { detail, run, step, loopIndex, attemptIndex, previousResult, reviewResult, abortSignal } = params;
  const member = getTeamMemberById(detail, step.memberId);
  if (!member) {
    throw new Error(`未找到步骤 ${step.name} 对应的团队成员。`);
  }
  if (!member.enabled) {
    throw new Error(`团队成员 ${member.name} 当前已禁用。`);
  }

  const agent = getEnabledAgents(useSubAgentStore.getState()).find((item) => item.id === member.agentId);
  if (!agent) {
    throw new Error(`未找到可用代理：${member.agentId}`);
  }

  const prompt = buildStepPrompt({
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

  const enabledSkills = getEnabledSkills(useSkillsStore.getState());
  const providerConfig = useAgentSettingsStore.getState().config;
  const enabledToolIds = getEnabledToolIds(member).filter((toolId) => toolId !== "task");
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

  const snapshots = new Map<string, AgentPart>();
  const result = await runSubAgentTask({
    abortSignal,
    agentId: agent.id,
    enabledAgents: [agent as ResolvedAgent],
    enabledSkills,
    taskPrompt: prompt,
    providerConfig,
    streamFn: streamAgentText,
    workspaceTools: { ...workspaceTools, ...localResourceTools },
    enabledToolIds,
    onProgress: (snapshot) => {
      snapshots.set(snapshot.id, snapshot);
      void useWorkflowStore.getState().saveStepRun({
        ...stepRunBase,
        parts: Array.from(snapshots.values()),
      });
    },
  });

  const reviewResultValue = step.outputMode === "review_json"
    ? useWorkflowStore.getState().parseReviewResult(result.text)
    : null;

  const finalStepRun: WorkflowStepRun = {
    ...stepRunBase,
    status: "completed",
    finishedAt: getNow(),
    resultText: result.text,
    resultJson: reviewResultValue,
    parts: Array.from(snapshots.values()),
    usage: null,
  };

  await useWorkflowStore.getState().saveStepRun(finalStepRun);
  return finalStepRun;
}

function evaluateReviewGate(params: {
  detail: WorkflowDetail;
  step: WorkflowReviewGateStepDefinition;
  previousAgentStepRun: WorkflowStepRun;
  run: WorkflowRun;
  loopIndex: number;
  attemptIndex: number;
}) {
  const { detail, step, previousAgentStepRun, run, loopIndex, attemptIndex } = params;
  const review = previousAgentStepRun.resultJson;
  if (!review) {
    throw new Error(`审查步骤 ${step.name} 缺少可解析的 JSON 输出。`);
  }

  const passed = review.pass === true;
  const stepRun: WorkflowStepRun = {
    id: createId("workflow-step-run"),
    runId: run.id,
    workflowId: detail.workflow.id,
    stepId: step.id,
    loopIndex,
    attemptIndex,
    memberId: null,
    status: "completed",
    startedAt: getNow(),
    finishedAt: getNow(),
    inputPrompt: `根据步骤 ${previousAgentStepRun.stepId} 的结构化审查结果决定下一步。`,
    resultText: passed ? "审查通过。" : "审查未通过。",
    resultJson: review,
    decision: {
      outcome: passed ? "pass" : "fail",
      reason: passed ? "审查 JSON 返回 pass=true" : review.revision_brief || "审查 JSON 返回 pass=false",
    },
    parts: [],
    usage: null,
    errorMessage: null,
  };

  return stepRun;
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
        previousAgentStepRun = await executeAgentStep({
          detail,
          run,
          step: currentStep,
          loopIndex,
          attemptIndex,
          previousResult: previousAgentStepRun?.resultText ?? null,
          reviewResult: previousAgentStepRun?.resultJson ?? null,
          abortSignal: abortController.signal,
        });
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
        if (!previousAgentStepRun) {
          throw new Error(`审查判断步骤 ${currentStep.name} 缺少来源步骤结果。`);
        }
        const stepRun = evaluateReviewGate({
          detail,
          step: currentStep,
          previousAgentStepRun,
          run,
          loopIndex,
          attemptIndex,
        });
        await store.saveStepRun(stepRun);
        run = {
          ...run,
          currentStepRunId: stepRun.id,
          currentLoopIndex: loopIndex,
        };
        await store.saveRun(run);

        if (stepRun.decision?.outcome === "fail") {
          if (attemptIndex >= run.loopConfigSnapshot.maxReworkPerLoop && run.loopConfigSnapshot.stopOnReviewFailure) {
            run = {
              ...run,
              status: "failed",
              finishedAt: getNow(),
              stopReason: "review_failed",
              errorMessage: stepRun.decision.reason,
              summary: "审查未通过，且已达到最大返工次数。",
            };
            await store.saveRun(run);
            break;
          }
          attemptIndex += 1;
          currentStep = getStepById(detail, currentStep.failNextStepId);
          continue;
        }

        attemptIndex = 1;
        currentStep = getStepById(detail, currentStep.passNextStepId);
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
