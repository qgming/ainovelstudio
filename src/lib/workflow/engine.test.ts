import { describe, expect, it } from "vitest";
import { resetRuntimeForNextLoop } from "./engine";
import { buildStepPrompt } from "./stepPrompt";
import type {
  WorkflowAgentStepDefinition,
  WorkflowDecisionStepDefinition,
  WorkflowReviewResult,
  WorkflowTeamMember,
} from "./types";

function createTeamMember(): WorkflowTeamMember {
  return {
    id: "member-1",
    workflowId: "workflow-1",
    agentId: "agent-1",
    name: "章节作者",
    roleLabel: "写作",
    order: 1,
    responsibilityPrompt: "负责完成当前章节。",
    createdAt: 1,
    updatedAt: 1,
  };
}

function createAgentStep(): WorkflowAgentStepDefinition {
  return {
    id: "step-1",
    workflowId: "workflow-1",
    type: "agent_task",
    name: "章节写作",
    order: 1,
    memberId: "member-1",
    promptTemplate: "完成当前章节。",
    outputMode: "text",
    nextStepId: null,
  };
}

function createDecisionStep(): WorkflowDecisionStepDefinition {
  return {
    id: "step-2",
    workflowId: "workflow-1",
    type: "decision",
    name: "质量检查",
    order: 2,
    memberId: "member-1",
    promptTemplate: "判断当前章节是否通过质检。",
    sourceStepId: "step-1",
    trueNextStepId: "step-pass",
    falseNextStepId: "step-fail",
  };
}

describe("workflow engine", () => {
  it("agent_task 提示词按代理节点模板构建", () => {
    const prompt = buildStepPrompt({
      attemptIndex: 1,
      basePrompt: "基础要求",
      chapterWriteMode: "new_chapter",
      incomingMessages: [],
      previousStepRun: null,
      reviewResult: null,
      step: createAgentStep(),
      teamMember: createTeamMember(),
      workflowName: "自动长篇",
    });

    expect(prompt).toContain("你正在执行工作流《自动长篇》中的代理节点。");
    expect(prompt).toContain("## 执行边界");
    expect(prompt).toContain("## 当前任务");
    expect(prompt).toContain("当前步骤尝试次数：1");
    expect(prompt).not.toContain("循环次数：");
    expect(prompt).not.toContain("## 判断契约");
  });

  it("decision 提示词按判断节点模板构建", () => {
    const prompt = buildStepPrompt({
      attemptIndex: 2,
      basePrompt: "基础要求",
      incomingMessages: [],
      previousStepRun: null,
      reviewResult: null,
      step: createDecisionStep(),
      teamMember: createTeamMember(),
      workflowName: "自动长篇",
    });

    expect(prompt).toContain("你正在执行工作流《自动长篇》中的判断节点。");
    expect(prompt).toContain("## 判断契约");
    expect(prompt).toContain("workflow_decision");
    expect(prompt).not.toContain("## 执行边界");
  });

  it("开始新循环时会清空上一轮的瞬时上下文", () => {
    const reviewResult: WorkflowReviewResult = {
      pass: false,
      issues: [{ message: "章末钩子弱", severity: "high", type: "hook" }],
      revision_brief: "补强章末钩子。",
    };
    const runtime = {
      loopIndex: 2,
      attemptIndex: 3,
      latestStepRunsByStepId: new Map(),
      latestMessageByType: new Map([
        ["revision_brief", { revision_brief: "补强章末钩子。" }],
        ["scene_plan", { beats: ["冲突", "爆点"] }],
      ]),
      lastReviewResult: reviewResult,
      lastDecision: {
        outcome: "retry" as const,
        reason: "进入下一轮",
        branchKey: "continue",
      },
    };

    resetRuntimeForNextLoop(runtime);

    expect(runtime.loopIndex).toBe(2);
    expect(runtime.attemptIndex).toBe(1);
    expect(runtime.latestStepRunsByStepId.size).toBe(0);
    expect(runtime.latestMessageByType.size).toBe(0);
    expect(runtime.lastReviewResult).toBeNull();
    expect(runtime.lastDecision).toBeNull();
  });
});
