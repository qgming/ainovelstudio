import { invoke } from "@tauri-apps/api/core";
import type {
  BuiltinWorkflowsInitializationResult,
  Workflow,
  WorkflowDetail,
  WorkflowLoopConfig,
  WorkflowReviewResult,
  WorkflowRun,
  WorkflowStepDefinition,
  WorkflowStepInput,
  WorkflowStepRun,
  WorkflowTeamMember,
  WorkflowWorkspaceBinding,
} from "./types";

export function listWorkflows() {
  return invoke<Workflow[]>("list_workflows");
}

export function initializeBuiltinWorkflows() {
  return invoke<BuiltinWorkflowsInitializationResult>("initialize_builtin_workflows");
}

export function createWorkflow(name: string) {
  return invoke<Workflow>("create_workflow", { name });
}

export function exportWorkflowZip(workflowId: string) {
  return invoke<string | null>("export_workflow_zip", { workflowId });
}

export function deleteWorkflow(workflowId: string) {
  return invoke<void>("delete_workflow", { workflowId });
}

export function getWorkflowDetail(workflowId: string): Promise<WorkflowDetail> {
  return invoke<WorkflowDetail>("get_workflow_detail", { workflowId });
}

export function saveWorkflowBasics(workflowId: string, payload: Pick<Workflow, "name" | "description" | "status">) {
  return invoke<WorkflowDetail>("save_workflow_basics", { workflowId, payload });
}

export function bindWorkflowWorkspace(workflowId: string, binding: Omit<WorkflowWorkspaceBinding, "workflowId" | "boundAt">) {
  return invoke<WorkflowDetail>("bind_workflow_workspace", { workflowId, binding });
}

export function updateWorkflowLoopConfig(workflowId: string, loopConfig: WorkflowLoopConfig) {
  return invoke<WorkflowDetail>("update_workflow_loop_config", { workflowId, loopConfig });
}

export function addWorkflowTeamMember(
  workflowId: string,
  payload: Pick<WorkflowTeamMember, "agentId" | "name" | "roleLabel" | "responsibilityPrompt" | "allowedToolIds">,
) {
  return invoke<WorkflowDetail>("add_workflow_team_member", { workflowId, payload });
}

export function updateWorkflowTeamMember(
  workflowId: string,
  memberId: string,
  payload: Partial<Pick<WorkflowTeamMember, "name" | "roleLabel" | "enabled" | "responsibilityPrompt" | "allowedToolIds" | "agentId">>,
) {
  return invoke<WorkflowDetail>("update_workflow_team_member", { workflowId, memberId, payload });
}

export function removeWorkflowTeamMember(workflowId: string, memberId: string) {
  return invoke<WorkflowDetail>("remove_workflow_team_member", { workflowId, memberId });
}

export function reorderWorkflowTeamMembers(workflowId: string, orderedMemberIds: string[]) {
  return invoke<WorkflowDetail>("reorder_workflow_team_members", { workflowId, orderedMemberIds });
}

export function addWorkflowStep(workflowId: string, step: WorkflowStepInput) {
  return invoke<WorkflowDetail>("add_workflow_step", { workflowId, step });
}

export function updateWorkflowStep(workflowId: string, stepId: string, payload: Partial<WorkflowStepDefinition>) {
  return invoke<WorkflowDetail>("update_workflow_step", { workflowId, stepId, payload });
}

export function removeWorkflowStep(workflowId: string, stepId: string) {
  return invoke<WorkflowDetail>("remove_workflow_step", { workflowId, stepId });
}

export function reorderWorkflowSteps(workflowId: string, orderedStepIds: string[]) {
  return invoke<WorkflowDetail>("reorder_workflow_steps", { workflowId, orderedStepIds });
}

export function saveWorkflowRun(run: WorkflowRun) {
  return invoke<WorkflowRun>("save_workflow_run", { run });
}

export function saveWorkflowStepRun(stepRun: WorkflowStepRun) {
  return invoke<WorkflowStepRun>("save_workflow_step_run", { stepRun });
}

export function parseWorkflowReviewResult(text: string): WorkflowReviewResult | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed) as Partial<WorkflowReviewResult>;
    if (typeof parsed.pass !== "boolean") {
      return null;
    }
    return {
      pass: parsed.pass,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      revision_brief: typeof parsed.revision_brief === "string" ? parsed.revision_brief : "",
    };
  } catch {
    return null;
  }
}
