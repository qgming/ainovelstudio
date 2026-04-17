import type { AgentPart, AgentUsage, AgentRunStatus } from "../agent/types";

export type WorkflowRunStatus = "idle" | "queued" | "running" | "completed" | "failed" | "stopped";

export type WorkflowStepType = "agent_task" | "review_gate" | "loop_control";

export type WorkflowStepOutputMode = "text" | "review_json";

export type WorkflowWorkspaceBinding = {
  workflowId: string;
  bookId: string;
  rootPath: string;
  bookName: string;
  boundAt: number;
};

export type WorkflowLoopConfig = {
  maxLoops: number;
  maxReworkPerLoop: number;
  stopOnReviewFailure: boolean;
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

export type WorkflowReviewGateStepDefinition = {
  id: string;
  workflowId: string;
  type: "review_gate";
  name: string;
  order: number;
  memberId: string;
  promptTemplate: string;
  sourceStepId: string;
  passNextStepId: string | null;
  failNextStepId: string | null;
  passRule: "review_json.pass == true";
};

export type WorkflowLoopControlStepDefinition = {
  id: string;
  workflowId: string;
  type: "loop_control";
  name: string;
  order: number;
  loopTargetStepId: string | null;
  continueWhen: "remainingLoops > 0";
  finishWhen: "remainingLoops <= 0";
};

export type WorkflowStepDefinition =
  | WorkflowAgentStepDefinition
  | WorkflowReviewGateStepDefinition
  | WorkflowLoopControlStepDefinition;

export type WorkflowStepInput =
  | Omit<WorkflowAgentStepDefinition, "id" | "workflowId" | "order">
  | Omit<WorkflowReviewGateStepDefinition, "id" | "workflowId" | "order">
  | Omit<WorkflowLoopControlStepDefinition, "id" | "workflowId" | "order">;

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
      outcome: "pass" | "fail" | "retry";
      reason: string;
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
  decision: WorkflowStepDecision;
  parts: AgentPart[];
  usage?: AgentUsage | null;
  errorMessage: string | null;
};

export type WorkflowRunStopReason =
  | "completed"
  | "manual_stop"
  | "max_loops_reached"
  | "error"
  | "review_failed"
  | null;

export type WorkflowRun = {
  id: string;
  workflowId: string;
  status: WorkflowRunStatus;
  startedAt: number;
  finishedAt: number | null;
  workspaceBinding: WorkflowWorkspaceBinding;
  loopConfigSnapshot: WorkflowLoopConfig;
  currentLoopIndex: number;
  maxLoops: number;
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
