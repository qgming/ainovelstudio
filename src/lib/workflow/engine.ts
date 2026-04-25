/**
 * 工作流执行引擎主流程：
 *   - executeConfiguredStep：执行 agent_task / decision 节点（调用 LLM、处理结果）
 *   - runWorkflowFromCursor：按游标推进 step
 *   - startWorkflowRun / resumeWorkflowRun：对外公共入口
 *
 * 历史上还混杂以下职责，已分别拆出：
 *   - 类型与小工具         → runtimeTypes.ts
 *   - 纯查询函数           → selectors.ts
 *   - decision 解析        → decision.ts
 *   - 消息封包/解析        → messages.ts
 *   - 运行态变更           → runtime.ts
 */

import { getEnabledAgents, useSubAgentStore } from "../../stores/subAgentStore";
import { getEnabledSkills, useSkillsStore } from "../../stores/skillsStore";
import { useAgentSettingsStore } from "../../stores/agentSettingsStore";
import { useWorkflowStore } from "../../stores/workflowStore";
import { mergePart, normalizeRecoveredMessageParts } from "../chat/sessionRuntime";
import { derivePlanningState } from "../agent/planning";
import { loadProjectContext } from "../agent/projectContext";
import { runAgentTurn } from "../agent/session";
import type { AgentPart } from "../agent/types";
import { readWorkspaceTextFile, readWorkspaceTree } from "../bookWorkspace/api";
import { buildBookWorkspaceTools } from "../agent/toolsets/factory";
import { buildStepPrompt } from "./stepPrompt";
import {
  createId,
  getNow,
  hasRemainingLoops,
  isAbortError,
  WORKFLOW_DECISION_TOOL_ID,
  type ChapterWriteMode,
  type WorkflowCursor,
  type WorkflowDecisionResult,
  type WorkflowRunMode,
  type WorkflowRuntimeState,
} from "./runtimeTypes";
import {
  buildInitialRun,
  findResumableRun,
  getEnabledToolIds,
  getStepById,
  getTeamMemberById,
  isCompletedStepRun,
  resolveInitialStep,
  resolveWorkflowAgent,
  sortStepRunsForReplay,
} from "./selectors";
import { requireWorkflowDecisionResult } from "./decision";
import { extractStepMessage, getIncomingMessages } from "./messages";
import {
  normalizeInterruptedStepRun,
  resetRuntimeForNextLoop,
  updateRuntimeFromStepRun,
} from "./runtime";
import type {
  WorkflowDecisionStepDefinition,
  WorkflowDetail,
  WorkflowEndStepDefinition,
  WorkflowReviewResult,
  WorkflowRun,
  WorkflowRunStopReason,
  WorkflowStartStepDefinition,
  WorkflowStepDefinition,
  WorkflowStepRun,
} from "./types";

// 重新导出共用工具，便于既有测试与外部消费者从 engine 直接拿到。
export { resetRuntimeForNextLoop } from "./runtime";

/** 推断恢复执行时的下一个游标：把已完成的 step run 顺序回放，确定下一个待执行节点。 */
function inferNextStepFromCompletedRun(
  detail: WorkflowDetail,
  run: WorkflowRun,
  runtime: WorkflowRuntimeState,
): WorkflowCursor {
  let currentStep: WorkflowStepDefinition | null = resolveInitialStep(detail);
  let previousAgentStepRun: WorkflowStepRun | null = null;
  const completedStepRuns = sortStepRunsForReplay(
    detail.stepRuns.filter(
      (stepRun) => stepRun.runId === run.id && isCompletedStepRun(stepRun),
    ),
  );

  for (const stepRun of completedStepRuns) {
    const step = getStepById(detail, stepRun.stepId);
    if (!step || !currentStep || step.id !== currentStep.id) continue;

    runtime.loopIndex = stepRun.loopIndex;
    runtime.attemptIndex = stepRun.attemptIndex;
    updateRuntimeFromStepRun(runtime, stepRun);
    if (step.type === "agent_task" || step.type === "decision") {
      previousAgentStepRun = stepRun;
    }

    if (step.type === "start" || step.type === "agent_task") {
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
        step.loopBehavior === "continue_if_possible" &&
        step.loopTargetStepId &&
        hasRemainingLoops(run.maxLoops, nextLoopIndex) &&
        stepRun.decision?.outcome === "retry";
      if (!shouldContinue) {
        currentStep = null;
        break;
      }
      runtime.loopIndex = nextLoopIndex;
      resetRuntimeForNextLoop(runtime);
      previousAgentStepRun = null;
      currentStep = getStepById(detail, step.loopTargetStepId);
    }
  }

  return { currentStep, previousAgentStepRun };
}

/** 创建系统类型 step run（start / end 节点不调用 LLM，由程序写入结果）。 */
function createSystemStepRun(params: {
  detail: WorkflowDetail;
  run: WorkflowRun;
  step: WorkflowStartStepDefinition | WorkflowEndStepDefinition;
  loopIndex: number;
  attemptIndex: number;
  resultText: string;
  decision: NonNullable<WorkflowStepRun["decision"]>;
}): WorkflowStepRun {
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
    decisionResultJson: null,
    messageType: null,
    messageJson: null,
    decision,
    parts: [],
    usage: null,
    errorMessage: null,
  };
}

/** 执行 agent_task / decision 节点：调用 LLM、流式收集 parts、写库、最终汇总。 */
async function executeConfiguredStep(params: {
  detail: WorkflowDetail;
  run: WorkflowRun;
  outputMode: "text" | "review_json";
  step: Extract<WorkflowStepDefinition, { type: "agent_task" | "decision" }>;
  runtime: WorkflowRuntimeState;
  previousStepRun?: WorkflowStepRun | null;
  reviewResult?: WorkflowReviewResult | null;
  chapterWriteMode?: ChapterWriteMode;
  abortSignal: AbortSignal;
}): Promise<WorkflowStepRun> {
  const {
    detail,
    run,
    step,
    outputMode,
    runtime,
    previousStepRun,
    reviewResult,
    chapterWriteMode,
    abortSignal,
  } = params;

  const member = getTeamMemberById(detail, step.memberId);
  if (!member) throw new Error(`未找到步骤 ${step.name} 对应的团队成员。`);

  const agent = resolveWorkflowAgent(member.agentId);
  if (!agent) throw new Error(`未找到可用代理：${member.agentId}。请检查代理中心配置。`);

  const prompt = buildStepPrompt({
    basePrompt: detail.workflow.basePrompt,
    workflowName: detail.workflow.name,
    teamMember: member,
    step,
    attemptIndex: runtime.attemptIndex,
    previousStepRun,
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
    decisionResultJson: null,
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

  // 确保依赖 store 已初始化（首次执行时可能仍为 idle）。
  const agentSettingsStore = useAgentSettingsStore.getState();
  if (agentSettingsStore.status !== "ready") await agentSettingsStore.initialize();
  const subAgentStore = useSubAgentStore.getState();
  if (subAgentStore.status === "idle") await subAgentStore.initialize();
  const skillsStore = useSkillsStore.getState();
  if (skillsStore.status === "idle") await skillsStore.initialize();

  const enabledSkills = getEnabledSkills(useSkillsStore.getState());
  const providerConfig = useAgentSettingsStore.getState().config;
  const enabledToolIds = getEnabledToolIds(
    member,
    step.type === "decision" ? [WORKFLOW_DECISION_TOOL_ID] : [],
  );
  const enabledAgents = getEnabledAgents(useSubAgentStore.getState()).filter(
    (item) => item.id !== agent.id,
  );

  let workflowDecisionResult: WorkflowDecisionResult | null = null;
  const projectContext = await loadProjectContext({
    readFile: readWorkspaceTextFile,
    readTree: readWorkspaceTree,
    workspaceRootPath: run.workspaceBinding.rootPath,
  });
  // 工作流模式：步骤运行期间用户可能切换书籍，需 guardRootMatch 防止误刷新；
  // decision 节点附加结果回填回调。
  const workspaceTools = buildBookWorkspaceTools({
    rootPath: run.workspaceBinding.rootPath,
    guardRootMatch: true,
    onWorkflowDecision:
      step.type === "decision"
        ? (decision) => {
            workflowDecisionResult = decision;
          }
        : undefined,
  });

  let parts: AgentPart[] = stepRunBase.parts;
  let usage = stepRunBase.usage;
  const stream = runAgentTurn({
    abortSignal,
    activeFilePath: null,
    debugLabel: `workflow:${detail.workflow.name}:loop-${runtime.loopIndex}:attempt-${runtime.attemptIndex}:step-${step.name}`,
    workspaceRootPath: run.workspaceBinding.rootPath,
    conversationHistory: [],
    defaultAgentMarkdown: agent.body,
    enabledAgents,
    enabledSkills,
    enabledToolIds,
    includeAgentCatalog: false,
    mode: "workflow",
    modeContext: {
      nodeKind: step.type,
      workflowName: detail.workflow.name,
      stepName: step.name,
      memberName: member.name,
      memberRoleLabel: member.roleLabel,
      isReworkMode: chapterWriteMode === "rework_current_chapter",
    },
    manualContext: null,
    onUsage: (nextUsage) => {
      usage = nextUsage;
    },
    planningState: derivePlanningState([]),
    projectContext,
    prompt,
    providerConfig,
    workspaceTools,
    onToolRequestStateChange: ({ requestId, status }) => {
      useWorkflowStore
        .getState()
        .trackInflightToolRequest(requestId, status === "start" ? "start" : "finish");
    },
  });

  try {
    for await (const part of stream) {
      parts = mergePart(parts, part);
      await useWorkflowStore.getState().saveStepRun({ ...stepRunBase, parts });
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
    await useWorkflowStore.getState().saveStepRun({ ...stepRunBase, parts });
  }

  const resultText = parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n\n");
  const decisionResultValue =
    step.type === "decision"
      ? requireWorkflowDecisionResult(step, workflowDecisionResult, parts)
      : null;
  const reviewResultValue =
    step.type === "decision"
      ? null
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
    decisionResultJson: decisionResultValue,
    messageType: stepMessage?.messageType ?? null,
    messageJson: stepMessage?.messageJson ?? null,
    parts,
    usage,
  };

  await useWorkflowStore.getState().saveStepRun(finalStepRun);
  return finalStepRun;
}

/** 评估 decision 节点结果，决定下一步与 attempt 计数。 */
function evaluateDecisionNode(params: {
  step: WorkflowDecisionStepDefinition;
  decisionStepRun: WorkflowStepRun;
  attemptIndex: number;
}): {
  stepRun: WorkflowStepRun;
  nextStepId: string | null;
  nextAttemptIndex: number;
  endReason: WorkflowRunStopReason | null;
} {
  const { step, decisionStepRun, attemptIndex } = params;
  const decisionResult = decisionStepRun.decisionResultJson;
  if (!decisionResult) throw new Error(`判断步骤 ${step.name} 缺少结构化 decisionResultJson。`);

  const passed = decisionResult.pass;
  const nextStepId = passed ? step.trueNextStepId : step.falseNextStepId;

  const stepRun: WorkflowStepRun = {
    ...decisionStepRun,
    decision: {
      outcome: passed ? "pass" : "fail",
      reason: decisionResult.reason,
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

/** run 标记结束态。 */
function applyRunCompletion(
  run: WorkflowRun,
  stopReason: Exclude<WorkflowRunStopReason, null>,
  summary: string,
): WorkflowRun {
  return {
    ...run,
    status: stopReason === "manual_stop" ? "stopped" : "completed",
    finishedAt: getNow(),
    stopReason,
    summary,
  };
}

/** 不同 stopReason 的人类可读摘要文案。 */
function buildCompletionSummary(
  stopReason: Exclude<WorkflowRunStopReason, null>,
  runtime: WorkflowRuntimeState,
  endStep?: WorkflowEndStepDefinition,
): string {
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
      return (
        endStep?.summaryTemplate?.trim() ||
        `工作流在结束节点《${endStep?.name ?? "未命名结束节点"}》处结束。`
      );
    case "error":
      return "工作流运行异常结束。";
    default:
      return "工作流已结束。";
  }
}

function buildFinishAfterCurrentLoopSummary(loopIndex: number): string {
  return `已按请求在第 ${loopIndex} 轮完整结束后停止继续下一轮。`;
}

/** 加载工作流详情，优先使用 store 内的当前缓存。 */
async function loadWorkflowDetailForRun(workflowId: string) {
  const store = useWorkflowStore.getState();
  if (store.currentDetail?.workflow.id === workflowId) {
    return store.currentDetail;
  }
  await store.loadWorkflowDetail(workflowId);
  const nextDetail = useWorkflowStore.getState().currentDetail;
  if (!nextDetail) throw new Error("未找到工作流详情。");
  return nextDetail;
}

/** 主推进循环：按当前 step 类型分支执行直到结束 / 暂停 / 出错。 */
async function runWorkflowFromCursor(params: {
  detail: WorkflowDetail;
  initialCursor: WorkflowCursor;
  mode: WorkflowRunMode;
  run: WorkflowRun;
  runtime: WorkflowRuntimeState;
}): Promise<void> {
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
    finishAfterCurrentLoopRequested: false,
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

      // 开始节点：仅初始化运行状态。
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

      // Agent 任务节点：调用 LLM 完成 step。
      if (currentStep.type === "agent_task") {
        const chapterWriteMode: ChapterWriteMode | undefined = currentStep.name.includes(
          "章节写作",
        )
          ? runtime.attemptIndex > 1
            ? "rework_current_chapter"
            : "new_chapter"
          : undefined;
        previousAgentStepRun = await executeConfiguredStep({
          abortSignal: abortController.signal,
          chapterWriteMode,
          detail,
          outputMode: currentStep.outputMode,
          previousStepRun: previousAgentStepRun,
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

      // 判断节点：执行 + 评估分支。
      if (currentStep.type === "decision") {
        const sourceStepRun =
          runtime.latestStepRunsByStepId.get(currentStep.sourceStepId) ?? previousAgentStepRun;
        if (!sourceStepRun) {
          throw new Error(`判断步骤 ${currentStep.name} 缺少来源步骤结果。`);
        }
        const decisionStepRun = await executeConfiguredStep({
          abortSignal: abortController.signal,
          detail,
          outputMode: "review_json",
          previousStepRun: sourceStepRun,
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

      // 结束节点：写系统 step run，按 loopBehavior 决定是否进入下一轮。
      if (currentStep.type === "end") {
        const shouldContinueByLoopConfig =
          currentStep.loopBehavior === "continue_if_possible" &&
          currentStep.loopTargetStepId &&
          hasRemainingLoops(run.maxLoops, runtime.loopIndex + 1);
        const finishAfterCurrentLoopRequested =
          useWorkflowStore.getState().finishAfterCurrentLoopRequested;
        const shouldContinue = shouldContinueByLoopConfig && !finishAfterCurrentLoopRequested;

        const stepRun = createSystemStepRun({
          detail,
          run,
          step: currentStep,
          loopIndex: runtime.loopIndex,
          attemptIndex: runtime.attemptIndex,
          resultText: shouldContinue
            ? `结束节点允许继续下一轮，准备进入第 ${runtime.loopIndex + 1} 轮。`
            : finishAfterCurrentLoopRequested && shouldContinueByLoopConfig
              ? buildFinishAfterCurrentLoopSummary(runtime.loopIndex)
              : currentStep.summaryTemplate.trim() ||
                `到达结束节点《${currentStep.name}》。`,
          decision: {
            outcome: shouldContinue ? "retry" : "end",
            reason: shouldContinue
              ? `结束节点要求在轮次允许时继续执行，下一轮从 ${currentStep.loopTargetStepId} 开始。`
              : finishAfterCurrentLoopRequested && shouldContinueByLoopConfig
                ? "已收到“本轮后结束”请求，当前轮完成后停止继续下一轮。"
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
          resetRuntimeForNextLoop(runtime);
          previousAgentStepRun = null;
          currentStep = getStepById(detail, currentStep.loopTargetStepId);
          continue;
        }

        if (finishAfterCurrentLoopRequested && shouldContinueByLoopConfig) {
          run = applyRunCompletion(
            run,
            "completed",
            buildFinishAfterCurrentLoopSummary(runtime.loopIndex),
          );
          await store.saveRun(run);
          break;
        }

        const stopReason: Exclude<WorkflowRunStopReason, null> =
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
      finishAfterCurrentLoopRequested: false,
      inflightToolRequestIds: [],
      isRunning: false,
      stopRequested: false,
    });
  }
}

/** 启动一次新的工作流运行。 */
export async function startWorkflowRun(workflowId: string): Promise<void> {
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

/** 继续一次已暂停 / 失败的工作流运行。 */
export async function resumeWorkflowRun(workflowId: string, runId?: string | null): Promise<void> {
  const detail = await loadWorkflowDetailForRun(workflowId);
  const run = findResumableRun(detail, runId);
  if (!run) throw new Error("没有可继续的工作流运行。");

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
