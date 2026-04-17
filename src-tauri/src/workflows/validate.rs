use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    types::{
        Workflow, WorkflowBasicsPatch, WorkflowFiles, WorkflowLoopConfig, WorkflowPackageManifest,
        WorkflowStepDefinition, WorkflowStepInput, WorkflowWorkspaceBindingInput,
    },
    CommandResult,
};

pub(crate) fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

pub(crate) fn now_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub(crate) fn serialize_json<T: Serialize>(value: &T) -> CommandResult<String> {
    serde_json::to_string(value).map_err(error_to_string)
}

pub(crate) fn deserialize_json<T: for<'de> Deserialize<'de>>(value: &str) -> CommandResult<T> {
    serde_json::from_str(value).map_err(error_to_string)
}

pub(crate) fn parse_optional_json<T: for<'de> Deserialize<'de>>(
    value: Option<String>,
) -> CommandResult<Option<T>> {
    value.map(|raw| deserialize_json(&raw)).transpose()
}

pub(crate) fn create_id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4())
}

pub(crate) fn default_loop_config() -> WorkflowLoopConfig {
    WorkflowLoopConfig {
        max_loops: 1,
        max_rework_per_loop: 1,
        stop_on_review_failure: true,
    }
}

pub(crate) fn normalize_text_content(content: &str) -> String {
    content.replace("\r\n", "\n")
}

pub(crate) fn validate_workflow_package_manifest(
    manifest: &WorkflowPackageManifest,
    workflow_id: &str,
) -> CommandResult<()> {
    if manifest.id.trim().is_empty() {
        return Err("workflow manifest 缺少 id。".into());
    }
    if manifest.id != workflow_id {
        return Err("workflow manifest.id 必须与目录名保持一致。".into());
    }
    if manifest.name.trim().is_empty() {
        return Err("workflow manifest 缺少 name。".into());
    }
    if manifest.description.trim().is_empty() {
        return Err("workflow manifest 缺少 description。".into());
    }
    if manifest.entry.as_deref().unwrap_or("WORKFLOW.json") != "WORKFLOW.json" {
        return Err("workflow manifest.entry 目前必须为 WORKFLOW.json。".into());
    }
    Ok(())
}

pub(crate) fn step_id(step: &WorkflowStepDefinition) -> &str {
    match step {
        WorkflowStepDefinition::AgentTask { id, .. }
        | WorkflowStepDefinition::ReviewGate { id, .. }
        | WorkflowStepDefinition::LoopControl { id, .. } => id,
    }
}

pub(crate) fn build_workflow(
    id: &str,
    name: &str,
    description: &str,
    source: &str,
    template_key: Option<&str>,
    loop_config: WorkflowLoopConfig,
    now: u64,
) -> Workflow {
    Workflow {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        status: "draft".into(),
        source: source.to_string(),
        template_key: template_key.map(ToString::to_string),
        created_at: now,
        updated_at: now,
        workspace_binding: None,
        loop_config,
        team_member_ids: Vec::new(),
        step_ids: Vec::new(),
        last_run_id: None,
        last_run_status: "idle".into(),
    }
}

pub(crate) fn validate_workflow_status(status: &str) -> CommandResult<()> {
    if matches!(status, "draft" | "ready" | "archived") {
        Ok(())
    } else {
        Err("工作流状态不合法。".into())
    }
}

pub(crate) fn validate_run_status(status: &str) -> CommandResult<()> {
    if matches!(
        status,
        "idle" | "queued" | "running" | "completed" | "failed" | "stopped"
    ) {
        Ok(())
    } else {
        Err("工作流运行状态不合法。".into())
    }
}

pub(crate) fn validate_binding_input(binding: &WorkflowWorkspaceBindingInput) -> CommandResult<()> {
    if binding.book_id.trim().is_empty()
        || binding.root_path.trim().is_empty()
        || binding.book_name.trim().is_empty()
    {
        return Err("工作区绑定信息不完整。".into());
    }
    Ok(())
}

pub(crate) fn validate_loop_config(loop_config: &WorkflowLoopConfig) -> CommandResult<()> {
    if loop_config.max_loops == 0 {
        return Err("最大循环次数必须大于 0。".into());
    }
    if loop_config.max_rework_per_loop == 0 {
        return Err("每轮最大返工次数必须大于 0。".into());
    }
    Ok(())
}

pub(crate) fn validate_member_payload(
    agent_id: &str,
    name: &str,
    role_label: &str,
    allowed_tool_ids: &Option<Vec<String>>,
) -> CommandResult<()> {
    if agent_id.trim().is_empty() {
        return Err("团队成员必须选择代理。".into());
    }
    if name.trim().is_empty() {
        return Err("团队成员名称不能为空。".into());
    }
    if role_label.trim().is_empty() {
        return Err("团队成员角色不能为空。".into());
    }
    if let Some(tool_ids) = allowed_tool_ids {
        if tool_ids.iter().any(|tool_id| tool_id.trim().is_empty()) {
            return Err("工具权限列表中存在空值。".into());
        }
    }
    Ok(())
}

pub(crate) fn validate_workflow_basics_payload(
    payload: &WorkflowBasicsPatch,
) -> CommandResult<String> {
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Err("工作流名称不能为空。".into());
    }
    validate_workflow_status(&payload.status)?;
    Ok(name)
}

pub(crate) fn build_step_from_input(
    step_id: String,
    workflow_id: String,
    order: u64,
    step: WorkflowStepInput,
) -> WorkflowStepDefinition {
    match step {
        WorkflowStepInput::AgentTask {
            name,
            member_id,
            prompt_template,
            output_mode,
            next_step_id,
        } => WorkflowStepDefinition::AgentTask {
            id: step_id,
            workflow_id,
            name,
            order,
            member_id,
            prompt_template,
            output_mode,
            next_step_id,
        },
        WorkflowStepInput::ReviewGate {
            name,
            source_step_id,
            pass_next_step_id,
            fail_next_step_id,
            pass_rule,
        } => WorkflowStepDefinition::ReviewGate {
            id: step_id,
            workflow_id,
            name,
            order,
            source_step_id,
            pass_next_step_id,
            fail_next_step_id,
            pass_rule,
        },
        WorkflowStepInput::LoopControl {
            name,
            loop_target_step_id,
            continue_when,
            finish_when,
        } => WorkflowStepDefinition::LoopControl {
            id: step_id,
            workflow_id,
            name,
            order,
            loop_target_step_id,
            continue_when,
            finish_when,
        },
    }
}

pub(crate) fn reorder_steps_in_place(steps: &mut [WorkflowStepDefinition]) {
    for (index, step) in steps.iter_mut().enumerate() {
        match step {
            WorkflowStepDefinition::AgentTask { order, .. }
            | WorkflowStepDefinition::ReviewGate { order, .. }
            | WorkflowStepDefinition::LoopControl { order, .. } => *order = index as u64,
        }
    }
}

pub(crate) fn clear_deleted_step_references(
    steps: &mut [WorkflowStepDefinition],
    deleted_step_id: &str,
) {
    for step in steps.iter_mut() {
        match step {
            WorkflowStepDefinition::AgentTask { next_step_id, .. } => {
                if next_step_id.as_deref() == Some(deleted_step_id) {
                    *next_step_id = None;
                }
            }
            WorkflowStepDefinition::ReviewGate {
                source_step_id,
                pass_next_step_id,
                fail_next_step_id,
                ..
            } => {
                if source_step_id == deleted_step_id {
                    *source_step_id = String::new();
                }
                if pass_next_step_id.as_deref() == Some(deleted_step_id) {
                    *pass_next_step_id = None;
                }
                if fail_next_step_id.as_deref() == Some(deleted_step_id) {
                    *fail_next_step_id = None;
                }
            }
            WorkflowStepDefinition::LoopControl {
                loop_target_step_id,
                ..
            } => {
                if loop_target_step_id.as_deref() == Some(deleted_step_id) {
                    *loop_target_step_id = None;
                }
            }
        }
    }
}

pub(crate) fn _unused_connection_marker(_: &Connection, _: &WorkflowFiles) {}
