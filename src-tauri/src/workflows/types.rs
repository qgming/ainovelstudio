use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowWorkspaceBinding {
    pub(crate) workflow_id: String,
    pub(crate) book_id: String,
    pub(crate) root_path: String,
    pub(crate) book_name: String,
    pub(crate) bound_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowWorkspaceBindingInput {
    pub(crate) book_id: String,
    pub(crate) root_path: String,
    pub(crate) book_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowLoopConfig {
    pub(crate) max_loops: u64,
    pub(crate) max_rework_per_loop: u64,
    pub(crate) stop_on_review_failure: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workflow {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) status: String,
    pub(crate) source: String,
    pub(crate) template_key: Option<String>,
    pub(crate) created_at: u64,
    pub(crate) updated_at: u64,
    pub(crate) workspace_binding: Option<WorkflowWorkspaceBinding>,
    pub(crate) loop_config: WorkflowLoopConfig,
    pub(crate) team_member_ids: Vec<String>,
    pub(crate) step_ids: Vec<String>,
    pub(crate) last_run_id: Option<String>,
    pub(crate) last_run_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowTeamMember {
    pub(crate) id: String,
    pub(crate) workflow_id: String,
    pub(crate) agent_id: String,
    pub(crate) name: String,
    pub(crate) role_label: String,
    pub(crate) enabled: bool,
    pub(crate) order: u64,
    pub(crate) responsibility_prompt: String,
    pub(crate) allowed_tool_ids: Option<Vec<String>>,
    pub(crate) created_at: u64,
    pub(crate) updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowStepDefinition {
    AgentTask {
        id: String,
        workflow_id: String,
        name: String,
        order: u64,
        member_id: String,
        prompt_template: String,
        output_mode: String,
        next_step_id: Option<String>,
    },
    ReviewGate {
        id: String,
        workflow_id: String,
        name: String,
        order: u64,
        source_step_id: String,
        pass_next_step_id: Option<String>,
        fail_next_step_id: Option<String>,
        pass_rule: String,
    },
    LoopControl {
        id: String,
        workflow_id: String,
        name: String,
        order: u64,
        loop_target_step_id: Option<String>,
        continue_when: String,
        finish_when: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkflowStepInput {
    AgentTask {
        name: String,
        member_id: String,
        prompt_template: String,
        output_mode: String,
        next_step_id: Option<String>,
    },
    ReviewGate {
        name: String,
        source_step_id: String,
        pass_next_step_id: Option<String>,
        fail_next_step_id: Option<String>,
        pass_rule: String,
    },
    LoopControl {
        name: String,
        loop_target_step_id: Option<String>,
        continue_when: String,
        finish_when: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepDecision {
    pub(crate) outcome: String,
    pub(crate) reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowReviewIssue {
    pub(crate) r#type: String,
    pub(crate) severity: String,
    pub(crate) message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowReviewResult {
    pub(crate) pass: bool,
    pub(crate) issues: Vec<WorkflowReviewIssue>,
    pub(crate) revision_brief: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepRun {
    pub(crate) id: String,
    pub(crate) run_id: String,
    pub(crate) workflow_id: String,
    pub(crate) step_id: String,
    pub(crate) loop_index: u64,
    pub(crate) attempt_index: u64,
    pub(crate) member_id: Option<String>,
    pub(crate) status: String,
    pub(crate) started_at: Option<u64>,
    pub(crate) finished_at: Option<u64>,
    pub(crate) input_prompt: String,
    pub(crate) result_text: String,
    pub(crate) result_json: Option<WorkflowReviewResult>,
    pub(crate) decision: Option<WorkflowStepDecision>,
    pub(crate) parts: Vec<Value>,
    pub(crate) usage: Option<Value>,
    pub(crate) error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRun {
    pub(crate) id: String,
    pub(crate) workflow_id: String,
    pub(crate) status: String,
    pub(crate) started_at: u64,
    pub(crate) finished_at: Option<u64>,
    pub(crate) workspace_binding: WorkflowWorkspaceBinding,
    pub(crate) loop_config_snapshot: WorkflowLoopConfig,
    pub(crate) current_loop_index: u64,
    pub(crate) max_loops: u64,
    pub(crate) current_step_run_id: Option<String>,
    pub(crate) stop_reason: Option<String>,
    pub(crate) summary: Option<String>,
    pub(crate) error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDetail {
    pub(crate) workflow: Workflow,
    pub(crate) team_members: Vec<WorkflowTeamMember>,
    pub(crate) steps: Vec<WorkflowStepDefinition>,
    pub(crate) runs: Vec<WorkflowRun>,
    pub(crate) step_runs: Vec<WorkflowStepRun>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinWorkflowsInitializationResult {
    pub(crate) initialized_workflow_ids: Vec<String>,
    pub(crate) skipped_template_keys: Vec<String>,
}

pub(crate) type WorkflowFiles = HashMap<String, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowPackageManifest {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) description: String,
    #[serde(default)]
    pub(crate) version: Option<String>,
    #[serde(default)]
    pub(crate) author: Option<String>,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
    #[serde(default)]
    pub(crate) entry: Option<String>,
    #[serde(default)]
    pub(crate) schema_version: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowPackageRecord {
    pub(crate) id: String,
    pub(crate) source_kind: String,
    pub(crate) is_builtin: bool,
    pub(crate) manifest_json: String,
    pub(crate) files_json: String,
    pub(crate) updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowPackageDefinition {
    #[serde(default = "default_workflow_status")]
    pub(crate) status: String,
    pub(crate) template_key: String,
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) loop_config: WorkflowLoopConfig,
    pub(crate) team_members: Vec<WorkflowTemplateTeamMember>,
    pub(crate) steps: Vec<WorkflowTemplateStep>,
}

fn default_workflow_status() -> String {
    "draft".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkflowTemplateTeamMember {
    pub(crate) key: String,
    pub(crate) agent_id: String,
    pub(crate) name: String,
    pub(crate) role_label: String,
    pub(crate) responsibility_prompt: String,
    #[serde(default)]
    pub(crate) enabled: Option<bool>,
    #[serde(default)]
    pub(crate) allowed_tool_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum WorkflowTemplateStep {
    AgentTask {
        key: String,
        name: String,
        member_key: String,
        prompt_template: String,
        output_mode: String,
        next_step_key: Option<String>,
    },
    ReviewGate {
        key: String,
        name: String,
        source_step_key: String,
        pass_next_step_key: Option<String>,
        fail_next_step_key: Option<String>,
        pass_rule: String,
    },
    LoopControl {
        key: String,
        name: String,
        loop_target_step_key: Option<String>,
        continue_when: String,
        finish_when: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowBasicsPatch {
    pub(crate) name: String,
    pub(crate) description: String,
    pub(crate) status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowTeamMemberCreateInput {
    pub(crate) agent_id: String,
    pub(crate) name: String,
    pub(crate) role_label: String,
    pub(crate) responsibility_prompt: String,
    pub(crate) allowed_tool_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowTeamMemberPatch {
    pub(crate) agent_id: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) role_label: Option<String>,
    pub(crate) enabled: Option<bool>,
    pub(crate) responsibility_prompt: Option<String>,
    pub(crate) allowed_tool_ids: Option<Vec<String>>,
}
