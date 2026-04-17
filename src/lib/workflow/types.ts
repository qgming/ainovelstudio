import type { AgentPart, AgentUsage, AgentRunStatus } from "../agent/types";

export type WorkflowRunStatus = "idle" | "queued" | "running" | "completed" | "failed" | "stopped";

export type WorkflowStepType = "start" | "agent_task" | "decision" | "end";

export type WorkflowStepOutputMode = "text" | "review_json";

export type WorkflowMessageType = "scene_plan" | "review_result" | "revision_brief" | "lore_update_summary" | string;

export type WorkflowMessagePayload = Record<string, unknown>;

export type WorkflowWorkspaceBinding = {
  workflowId: string;
  bookId: string;
  rootPath: string;
  bookName: string;
  boundAt: number;
};

export type WorkflowLoopConfig = {
  maxLoops: number | null;
};

export type WorkflowTeamMember = {
  id: string;
  workflowId: string;
  agentId: string;
  name: string;
  roleLabel: string;
  order: number;
  responsibilityPrompt: string;
  allowedToolIds?: string[];
  createdAt: number;
  updatedAt: number;
};

export type WorkflowRunStopReason =
  | "completed"
  | "manual_stop"
  | "end_node_reached"
  | "error"
  | "review_failed"
  | null;

export type WorkflowEndLoopBehavior = "finish" | "continue_if_possible";

export type WorkflowEndStopReason = "completed" | "review_failed";

export type WorkflowStartStepDefinition = {
  id: string;
  workflowId: string;
  type: "start";
  name: string;
  order: number;
  nextStepId: string | null;
};

export type WorkflowAgentStepDefinition = {
  id: string;
  workflowId: string;
  type: "agent_task";
  name: string;
  order: number;
  memberId: string;
  promptTemplate: string;
  outputMode: WorkflowStepOutputMode;
  nextStepId: string | null;
};

export type WorkflowDecisionStepDefinition = {
  id: string;
  workflowId: string;
  type: "decision";
  name: string;
  order: number;
  memberId: string;
  promptTemplate: string;
  sourceStepId: string;
  trueNextStepId: string | null;
  falseNextStepId: string | null;
  passRule: "review_json.pass == true";
};

export type WorkflowEndStepDefinition = {
  id: string;
  workflowId: string;
  type: "end";
  name: string;
  order: number;
  stopReason: WorkflowEndStopReason;
  summaryTemplate: string;
  loopBehavior: WorkflowEndLoopBehavior;
  loopTargetStepId: string | null;
};

export type WorkflowStepDefinition =
  | WorkflowStartStepDefinition
  | WorkflowAgentStepDefinition
  | WorkflowDecisionStepDefinition
  | WorkflowEndStepDefinition;

export type WorkflowStepInput =
  | Omit<WorkflowStartStepDefinition, "id" | "workflowId" | "order">
  | Omit<WorkflowAgentStepDefinition, "id" | "workflowId" | "order">
  | Omit<WorkflowDecisionStepDefinition, "id" | "workflowId" | "order">
  | Omit<WorkflowEndStepDefinition, "id" | "workflowId" | "order">;

export type WorkflowSource = "builtin" | "user";

export type Workflow = {
  id: string;
  name: string;
  description: string;
  basePrompt: string;
  source: WorkflowSource;
  templateKey: string | null;
  createdAt: number;
  updatedAt: number;
  workspaceBinding: WorkflowWorkspaceBinding | null;
  loopConfig: WorkflowLoopConfig;
  teamMemberIds: string[];
  stepIds: string[];
  lastRunId: string | null;
  lastRunStatus: WorkflowRunStatus;
};

export type BuiltinWorkflowsInitializationResult = {
  initializedWorkflowIds: string[];
  skippedTemplateKeys: string[];
};

export type WorkflowReviewIssue = {
  type: string;
  severity: "low" | "medium" | "high";
  message: string;
};

export type WorkflowReviewResult = {
  pass: boolean;
  issues: WorkflowReviewIssue[];
  revision_brief: string;
};

export type WorkflowStepDecision =
  | {
      outcome: "pass" | "fail" | "retry" | "end";
      reason: string;
      branchKey?: string;
    }
  | null;

export type WorkflowStepRun = {
  id: string;
  runId: string;
  workflowId: string;
  stepId: string;
  loopIndex: number;
  attemptIndex: number;
  memberId: string | null;
  status: AgentRunStatus;
  startedAt: number | null;
  finishedAt: number | null;
  inputPrompt: string;
  resultText: string;
  resultJson: WorkflowReviewResult | null;
  messageType: WorkflowMessageType | null;
  messageJson: WorkflowMessagePayload | null;
  decision: WorkflowStepDecision;
  parts: AgentPart[];
  usage?: AgentUsage | null;
  errorMessage: string | null;
};

export type WorkflowRun = {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  startedAt: number;
  finishedAt: number | null;
  workspaceBinding: WorkflowWorkspaceBinding;
  loopConfigSnapshot: WorkflowLoopConfig;
  currentLoopIndex: number;
  maxLoops: number | null;
  currentStepRunId: string | null;
  stopReason: WorkflowRunStopReason;
  summary: string | null;
  errorMessage: string | null;
};

export type WorkflowDetail = {
  workflow: Workflow;
  teamMembers: WorkflowTeamMember[];
  steps: WorkflowStepDefinition[];
  runs: WorkflowRun[];
  stepRuns: WorkflowStepRun[];
};

export type WorkflowStorageShape = {
  workflows: Workflow[];
  teamMembers: WorkflowTeamMember[];
  steps: WorkflowStepDefinition[];
  runs: WorkflowRun[];
  stepRuns: WorkflowStepRun[];
};
