use crate::db::open_database;
use rusqlite::params;
use tauri::AppHandle;

use super::{
    builtin::sync_builtin_workflows_to_database,
    management::{delete_workflow as delete_workflow_record, export_workflow_zip as export_workflow_zip_archive},
    repository::{
        build_workflow_detail, insert_workflow, list_all_workflows, list_steps, list_team_members,
        read_member, read_step, replace_workflow_member_ids, replace_workflow_step_ids,
        upsert_step, upsert_team_member, validate_reorder_member_ids, validate_reorder_step_ids,
        validate_step_input,
    },
    types::{
        BuiltinWorkflowsInitializationResult, Workflow, WorkflowBasicsPatch, WorkflowDetail,
        WorkflowLoopConfig, WorkflowRun, WorkflowStepDefinition, WorkflowStepInput,
        WorkflowStepRun, WorkflowTeamMember, WorkflowTeamMemberCreateInput,
        WorkflowTeamMemberPatch, WorkflowWorkspaceBinding, WorkflowWorkspaceBindingInput,
    },
    validate::{
        build_step_from_input, build_workflow, clear_deleted_step_references, create_id,
        default_loop_config, error_to_string, now_timestamp, reorder_steps_in_place,
        serialize_json, step_id, validate_binding_input, validate_loop_config,
        validate_member_payload, validate_run_status, validate_workflow_basics_payload,
    },
    CommandResult,
};

#[tauri::command]
pub fn initialize_builtin_workflows(
    app: AppHandle,
) -> CommandResult<BuiltinWorkflowsInitializationResult> {
    let connection = open_database(&app)?;
    sync_builtin_workflows_to_database(&connection)
}

#[tauri::command]
pub fn list_workflows(app: AppHandle) -> CommandResult<Vec<Workflow>> {
    let connection = open_database(&app)?;
    list_all_workflows(&connection)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workflow(app: AppHandle, name: String) -> CommandResult<Workflow> {
    let connection = open_database(&app)?;
    let now = now_timestamp();
    let workflow_name = if name.trim().is_empty() {
        "未命名工作流".to_string()
    } else {
        name.trim().to_string()
    };
    let workflow = build_workflow(
        &create_id("workflow"),
        &workflow_name,
        "",
        "user",
        None,
        default_loop_config(),
        now,
    );
    insert_workflow(&connection, &workflow)?;
    Ok(workflow)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn export_workflow_zip(app: AppHandle, workflowId: String) -> CommandResult<Option<String>> {
    export_workflow_zip_archive(&app, &workflowId).await
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_workflow(app: AppHandle, workflowId: String) -> CommandResult<()> {
    let connection = open_database(&app)?;
    delete_workflow_record(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_workflow_detail(app: AppHandle, workflowId: String) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn save_workflow_basics(
    app: AppHandle,
    workflowId: String,
    payload: WorkflowBasicsPatch,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    let name = validate_workflow_basics_payload(&payload)?;
    connection
        .execute(
            "UPDATE workflows SET name = ?2, description = ?3, status = ?4, updated_at = ?5 WHERE id = ?1",
            params![workflowId, name, payload.description.trim(), payload.status, now_timestamp() as i64],
        )
        .map_err(error_to_string)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn bind_workflow_workspace(
    app: AppHandle,
    workflowId: String,
    binding: WorkflowWorkspaceBindingInput,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    validate_binding_input(&binding)?;
    let next_binding = WorkflowWorkspaceBinding {
        workflow_id: workflowId.clone(),
        book_id: binding.book_id,
        root_path: binding.root_path,
        book_name: binding.book_name,
        bound_at: now_timestamp(),
    };
    connection
        .execute(
            "UPDATE workflows SET workspace_binding_json = ?2, updated_at = ?3 WHERE id = ?1",
            params![
                workflowId,
                serialize_json(&next_binding)?,
                now_timestamp() as i64
            ],
        )
        .map_err(error_to_string)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn update_workflow_loop_config(
    app: AppHandle,
    workflowId: String,
    loopConfig: WorkflowLoopConfig,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    validate_loop_config(&loopConfig)?;
    connection
        .execute(
            "UPDATE workflows SET loop_config_json = ?2, updated_at = ?3 WHERE id = ?1",
            params![
                workflowId,
                serialize_json(&loopConfig)?,
                now_timestamp() as i64
            ],
        )
        .map_err(error_to_string)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn add_workflow_team_member(
    app: AppHandle,
    workflowId: String,
    payload: WorkflowTeamMemberCreateInput,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    validate_member_payload(
        &payload.agent_id,
        &payload.name,
        &payload.role_label,
        &payload.allowed_tool_ids,
    )?;
    let order = list_team_members(&connection, &workflowId)?.len() as u64;
    let now = now_timestamp();
    let member = WorkflowTeamMember {
        id: create_id("workflow-member"),
        workflow_id: workflowId.clone(),
        agent_id: payload.agent_id,
        name: payload.name.trim().to_string(),
        role_label: payload.role_label.trim().to_string(),
        enabled: true,
        order,
        responsibility_prompt: payload.responsibility_prompt.trim().to_string(),
        allowed_tool_ids: payload.allowed_tool_ids,
        created_at: now,
        updated_at: now,
    };
    upsert_team_member(&connection, &member)?;
    replace_workflow_member_ids(&connection, &workflowId)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn update_workflow_team_member(
    app: AppHandle,
    workflowId: String,
    memberId: String,
    payload: WorkflowTeamMemberPatch,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    let mut member = read_member(&connection, &workflowId, &memberId)?;
    if let Some(agent_id) = payload.agent_id {
        member.agent_id = agent_id;
    }
    if let Some(name) = payload.name {
        member.name = name.trim().to_string();
    }
    if let Some(role_label) = payload.role_label {
        member.role_label = role_label.trim().to_string();
    }
    if let Some(enabled) = payload.enabled {
        member.enabled = enabled;
    }
    if let Some(responsibility_prompt) = payload.responsibility_prompt {
        member.responsibility_prompt = responsibility_prompt.trim().to_string();
    }
    if let Some(allowed_tool_ids) = payload.allowed_tool_ids {
        member.allowed_tool_ids = Some(allowed_tool_ids);
    }
    member.updated_at = now_timestamp();
    upsert_team_member(&connection, &member)?;
    replace_workflow_member_ids(&connection, &workflowId)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn remove_workflow_team_member(
    app: AppHandle,
    workflowId: String,
    memberId: String,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    connection
        .execute(
            "DELETE FROM workflow_team_members WHERE workflow_id = ?1 AND id = ?2",
            params![workflowId, memberId],
        )
        .map_err(error_to_string)?;
    replace_workflow_member_ids(&connection, &workflowId)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn reorder_workflow_team_members(
    app: AppHandle,
    workflowId: String,
    orderedMemberIds: Vec<String>,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    let members = list_team_members(&connection, &workflowId)?;
    let current_ids = members
        .iter()
        .map(|member| member.id.clone())
        .collect::<Vec<_>>();
    validate_reorder_member_ids(&current_ids, &orderedMemberIds)?;
    for (index, member_id) in orderedMemberIds.iter().enumerate() {
        connection
            .execute(
                "UPDATE workflow_team_members SET order_index = ?3, updated_at = ?4 WHERE workflow_id = ?1 AND id = ?2",
                params![workflowId, member_id, index as i64, now_timestamp() as i64],
            )
            .map_err(error_to_string)?;
    }
    replace_workflow_member_ids(&connection, &workflowId)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn add_workflow_step(
    app: AppHandle,
    workflowId: String,
    step: WorkflowStepInput,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    validate_step_input(&connection, &workflowId, &step)?;
    let order = list_steps(&connection, &workflowId)?.len() as u64;
    let next_step =
        build_step_from_input(create_id("workflow-step"), workflowId.clone(), order, step);
    upsert_step(&connection, &next_step)?;
    replace_workflow_step_ids(&connection, &workflowId)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn update_workflow_step(
    app: AppHandle,
    workflowId: String,
    stepId: String,
    payload: WorkflowStepDefinition,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    let existing = read_step(&connection, &workflowId, &stepId)?;
    let order = match existing {
        WorkflowStepDefinition::AgentTask { order, .. }
        | WorkflowStepDefinition::ReviewGate { order, .. }
        | WorkflowStepDefinition::LoopControl { order, .. } => order,
    };
    let next_step = match payload {
        WorkflowStepDefinition::AgentTask {
            name,
            member_id,
            prompt_template,
            output_mode,
            next_step_id,
            ..
        } => WorkflowStepDefinition::AgentTask {
            id: stepId,
            workflow_id: workflowId.clone(),
            name,
            order,
            member_id,
            prompt_template,
            output_mode,
            next_step_id,
        },
        WorkflowStepDefinition::ReviewGate {
            name,
            source_step_id,
            pass_next_step_id,
            fail_next_step_id,
            pass_rule,
            ..
        } => WorkflowStepDefinition::ReviewGate {
            id: stepId,
            workflow_id: workflowId.clone(),
            name,
            order,
            source_step_id,
            pass_next_step_id,
            fail_next_step_id,
            pass_rule,
        },
        WorkflowStepDefinition::LoopControl {
            name,
            loop_target_step_id,
            continue_when,
            finish_when,
            ..
        } => WorkflowStepDefinition::LoopControl {
            id: stepId,
            workflow_id: workflowId.clone(),
            name,
            order,
            loop_target_step_id,
            continue_when,
            finish_when,
        },
    };
    upsert_step(&connection, &next_step)?;
    replace_workflow_step_ids(&connection, &workflowId)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn remove_workflow_step(
    app: AppHandle,
    workflowId: String,
    stepId: String,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    let mut steps = list_steps(&connection, &workflowId)?;
    steps.retain(|step| step_id(step) != stepId);
    clear_deleted_step_references(&mut steps, &stepId);
    reorder_steps_in_place(&mut steps);

    connection
        .execute(
            "DELETE FROM workflow_steps WHERE workflow_id = ?1",
            params![workflowId],
        )
        .map_err(error_to_string)?;
    for step in &steps {
        upsert_step(&connection, step)?;
    }
    replace_workflow_step_ids(&connection, &workflowId)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn reorder_workflow_steps(
    app: AppHandle,
    workflowId: String,
    orderedStepIds: Vec<String>,
) -> CommandResult<WorkflowDetail> {
    let connection = open_database(&app)?;
    let steps = list_steps(&connection, &workflowId)?;
    let current_ids = steps
        .iter()
        .map(|step| step_id(step).to_string())
        .collect::<Vec<_>>();
    validate_reorder_step_ids(&current_ids, &orderedStepIds)?;

    for (index, step_id) in orderedStepIds.iter().enumerate() {
        connection
            .execute(
                "UPDATE workflow_steps SET order_index = ?3, updated_at = ?4 WHERE workflow_id = ?1 AND id = ?2",
                params![workflowId, step_id, index as i64, now_timestamp() as i64],
            )
            .map_err(error_to_string)?;
    }
    replace_workflow_step_ids(&connection, &workflowId)?;
    build_workflow_detail(&connection, &workflowId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn save_workflow_run(app: AppHandle, run: WorkflowRun) -> CommandResult<WorkflowRun> {
    let connection = open_database(&app)?;
    validate_run_status(&run.status)?;
    validate_loop_config(&run.loop_config_snapshot)?;
    connection
        .execute(
            r#"
            INSERT INTO workflow_runs (
                id, workflow_id, status, started_at, finished_at, workspace_binding_json,
                loop_config_snapshot_json, current_loop_index, max_loops, current_step_run_id,
                stop_reason, summary, error_message
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT(id) DO UPDATE
            SET status = excluded.status,
                finished_at = excluded.finished_at,
                workspace_binding_json = excluded.workspace_binding_json,
                loop_config_snapshot_json = excluded.loop_config_snapshot_json,
                current_loop_index = excluded.current_loop_index,
                max_loops = excluded.max_loops,
                current_step_run_id = excluded.current_step_run_id,
                stop_reason = excluded.stop_reason,
                summary = excluded.summary,
                error_message = excluded.error_message
            "#,
            params![
                run.id,
                run.workflow_id,
                run.status,
                run.started_at as i64,
                run.finished_at.map(|value| value as i64),
                serialize_json(&run.workspace_binding)?,
                serialize_json(&run.loop_config_snapshot)?,
                run.current_loop_index as i64,
                run.max_loops as i64,
                run.current_step_run_id,
                run.stop_reason,
                run.summary,
                run.error_message,
            ],
        )
        .map_err(error_to_string)?;
    connection
        .execute(
            "UPDATE workflows SET last_run_id = ?2, last_run_status = ?3, updated_at = ?4 WHERE id = ?1",
            params![run.workflow_id, run.id, run.status, now_timestamp() as i64],
        )
        .map_err(error_to_string)?;
    Ok(run)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn save_workflow_step_run(
    app: AppHandle,
    stepRun: WorkflowStepRun,
) -> CommandResult<WorkflowStepRun> {
    let connection = open_database(&app)?;
    connection
        .execute(
            r#"
            INSERT INTO workflow_step_runs (
                id, run_id, workflow_id, step_id, loop_index, attempt_index, member_id, status,
                started_at, finished_at, input_prompt, result_text, result_json, decision_json,
                parts_json, usage_json, error_message
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
            ON CONFLICT(id) DO UPDATE
            SET status = excluded.status,
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                input_prompt = excluded.input_prompt,
                result_text = excluded.result_text,
                result_json = excluded.result_json,
                decision_json = excluded.decision_json,
                parts_json = excluded.parts_json,
                usage_json = excluded.usage_json,
                error_message = excluded.error_message
            "#,
            params![
                stepRun.id,
                stepRun.run_id,
                stepRun.workflow_id,
                stepRun.step_id,
                stepRun.loop_index as i64,
                stepRun.attempt_index as i64,
                stepRun.member_id,
                stepRun.status,
                stepRun.started_at.map(|value| value as i64),
                stepRun.finished_at.map(|value| value as i64),
                stepRun.input_prompt,
                stepRun.result_text,
                stepRun
                    .result_json
                    .as_ref()
                    .map(serialize_json)
                    .transpose()?,
                stepRun.decision.as_ref().map(serialize_json).transpose()?,
                serialize_json(&stepRun.parts)?,
                stepRun.usage.as_ref().map(serialize_json).transpose()?,
                stepRun.error_message,
            ],
        )
        .map_err(error_to_string)?;
    Ok(stepRun)
}
