use rusqlite::{params, Connection};
use serde_json::Value;
use std::collections::HashSet;

use super::{
    types::{
        Workflow, WorkflowDetail, WorkflowReviewResult, WorkflowRun, WorkflowStepDecision,
        WorkflowStepDefinition, WorkflowStepInput, WorkflowStepRun, WorkflowTeamMember,
    },
    validate::{
        deserialize_json, error_to_string, now_timestamp, parse_optional_json, serialize_json,
        step_id, validate_loop_config, validate_member_payload, validate_run_status,
    },
    CommandResult,
};

pub(crate) fn validate_step_input(
    connection: &Connection,
    workflow_id: &str,
    step: &WorkflowStepInput,
) -> CommandResult<()> {
    match step {
        WorkflowStepInput::AgentTask {
            name,
            member_id,
            prompt_template,
            output_mode,
            next_step_id,
        } => {
            if name.trim().is_empty() {
                return Err("步骤名称不能为空。".into());
            }
            if member_id.trim().is_empty() || !has_member(connection, workflow_id, member_id)? {
                return Err("步骤引用的团队成员不存在。".into());
            }
            if prompt_template.trim().is_empty() {
                return Err("代理步骤提示词不能为空。".into());
            }
            if !matches!(output_mode.as_str(), "text" | "review_json") {
                return Err("代理步骤输出模式不合法。".into());
            }
            if let Some(next_step_id) = next_step_id {
                if !has_step(connection, workflow_id, next_step_id)? {
                    return Err("步骤的下一步引用不存在。".into());
                }
            }
        }
        WorkflowStepInput::ReviewGate {
            name,
            member_id,
            prompt_template,
            source_step_id,
            pass_next_step_id,
            fail_next_step_id,
            pass_rule,
        } => {
            if name.trim().is_empty() {
                return Err("步骤名称不能为空。".into());
            }
            if member_id.trim().is_empty() || !has_member(connection, workflow_id, member_id)? {
                return Err("审查节点引用的团队成员不存在。".into());
            }
            if prompt_template.trim().is_empty() {
                return Err("审查节点提示词不能为空。".into());
            }
            if source_step_id.trim().is_empty()
                || !has_step(connection, workflow_id, source_step_id)?
            {
                return Err("审查判断引用的来源步骤不存在。".into());
            }
            if pass_rule.trim().is_empty() {
                return Err("审查判断规则不能为空。".into());
            }
            if let Some(pass_next_step_id) = pass_next_step_id {
                if !has_step(connection, workflow_id, pass_next_step_id)? {
                    return Err("审查判断的通过分支引用不存在。".into());
                }
            }
            if let Some(fail_next_step_id) = fail_next_step_id {
                if !has_step(connection, workflow_id, fail_next_step_id)? {
                    return Err("审查判断的失败分支引用不存在。".into());
                }
            }
        }
        WorkflowStepInput::LoopControl {
            name,
            loop_target_step_id,
            continue_when,
            finish_when,
        } => {
            if name.trim().is_empty() {
                return Err("步骤名称不能为空。".into());
            }
            if continue_when.trim().is_empty() || finish_when.trim().is_empty() {
                return Err("循环控制条件不能为空。".into());
            }
            if let Some(loop_target_step_id) = loop_target_step_id {
                if !has_step(connection, workflow_id, loop_target_step_id)? {
                    return Err("循环控制引用的目标步骤不存在。".into());
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_step_definition(
    connection: &Connection,
    workflow_id: &str,
    step: &WorkflowStepDefinition,
) -> CommandResult<()> {
    match step {
        WorkflowStepDefinition::AgentTask {
            id,
            workflow_id: step_workflow_id,
            name,
            member_id,
            prompt_template,
            output_mode,
            next_step_id,
            ..
        } => {
            if id.trim().is_empty() || step_workflow_id != workflow_id {
                return Err("步骤标识不合法。".into());
            }
            if name.trim().is_empty() {
                return Err("步骤名称不能为空。".into());
            }
            if member_id.trim().is_empty() || !has_member(connection, workflow_id, member_id)? {
                return Err("步骤引用的团队成员不存在。".into());
            }
            if prompt_template.trim().is_empty() {
                return Err("代理步骤提示词不能为空。".into());
            }
            if !matches!(output_mode.as_str(), "text" | "review_json") {
                return Err("代理步骤输出模式不合法。".into());
            }
            if let Some(next_step_id) = next_step_id {
                if !has_step(connection, workflow_id, next_step_id)? && next_step_id != id {
                    return Err("步骤的下一步引用不存在。".into());
                }
            }
        }
        WorkflowStepDefinition::ReviewGate {
            id,
            workflow_id: step_workflow_id,
            name,
            member_id,
            prompt_template,
            source_step_id,
            pass_next_step_id,
            fail_next_step_id,
            pass_rule,
            ..
        } => {
            if id.trim().is_empty() || step_workflow_id != workflow_id {
                return Err("步骤标识不合法。".into());
            }
            if name.trim().is_empty() {
                return Err("步骤名称不能为空。".into());
            }
            if member_id.trim().is_empty() || !has_member(connection, workflow_id, member_id)? {
                return Err("审查节点引用的团队成员不存在。".into());
            }
            if prompt_template.trim().is_empty() {
                return Err("审查节点提示词不能为空。".into());
            }
            if source_step_id.trim().is_empty()
                || !has_step(connection, workflow_id, source_step_id)?
            {
                return Err("审查判断引用的来源步骤不存在。".into());
            }
            if pass_rule.trim().is_empty() {
                return Err("审查判断规则不能为空。".into());
            }
            if let Some(pass_next_step_id) = pass_next_step_id {
                if !has_step(connection, workflow_id, pass_next_step_id)? && pass_next_step_id != id
                {
                    return Err("审查判断的通过分支引用不存在。".into());
                }
            }
            if let Some(fail_next_step_id) = fail_next_step_id {
                if !has_step(connection, workflow_id, fail_next_step_id)? && fail_next_step_id != id
                {
                    return Err("审查判断的失败分支引用不存在。".into());
                }
            }
        }
        WorkflowStepDefinition::LoopControl {
            id,
            workflow_id: step_workflow_id,
            name,
            loop_target_step_id,
            continue_when,
            finish_when,
            ..
        } => {
            if id.trim().is_empty() || step_workflow_id != workflow_id {
                return Err("步骤标识不合法。".into());
            }
            if name.trim().is_empty() {
                return Err("步骤名称不能为空。".into());
            }
            if continue_when.trim().is_empty() || finish_when.trim().is_empty() {
                return Err("循环控制条件不能为空。".into());
            }
            if let Some(loop_target_step_id) = loop_target_step_id {
                if !has_step(connection, workflow_id, loop_target_step_id)?
                    && loop_target_step_id != id
                {
                    return Err("循环控制引用的目标步骤不存在。".into());
                }
            }
        }
    }
    Ok(())
}

pub(crate) fn validate_all_step_references(
    connection: &Connection,
    workflow_id: &str,
) -> CommandResult<()> {
    let steps = list_steps(connection, workflow_id)?;
    for step in &steps {
        validate_step_definition(connection, workflow_id, step)?;
    }
    Ok(())
}

pub(crate) fn insert_workflow(connection: &Connection, workflow: &Workflow) -> CommandResult<()> {
    validate_run_status(&workflow.last_run_status)?;
    validate_loop_config(&workflow.loop_config)?;
    connection
        .execute(
            r#"
            INSERT INTO workflows (
                id, name, description, base_prompt, source, template_key, package_id, workspace_binding_json, loop_config_json,
                team_member_ids_json, step_ids_json, last_run_id, last_run_status, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            ON CONFLICT(id) DO UPDATE
            SET name = excluded.name,
                description = excluded.description,
                base_prompt = excluded.base_prompt,
                source = excluded.source,
                template_key = excluded.template_key,
                package_id = excluded.package_id,
                workspace_binding_json = excluded.workspace_binding_json,
                loop_config_json = excluded.loop_config_json,
                team_member_ids_json = excluded.team_member_ids_json,
                step_ids_json = excluded.step_ids_json,
                last_run_id = excluded.last_run_id,
                last_run_status = excluded.last_run_status,
                updated_at = excluded.updated_at
            "#,
            params![
                workflow.id,
                workflow.name,
                workflow.description,
                workflow.base_prompt,
                workflow.source,
                workflow.template_key,
                Option::<String>::None,
                workflow.workspace_binding.as_ref().map(serialize_json).transpose()?,
                serialize_json(&workflow.loop_config)?,
                serialize_json(&workflow.team_member_ids)?,
                serialize_json(&workflow.step_ids)?,
                workflow.last_run_id,
                workflow.last_run_status,
                workflow.created_at as i64,
                workflow.updated_at as i64,
            ],
        )
        .map_err(error_to_string)?;
    Ok(())
}

pub(crate) fn set_workflow_package_id(
    connection: &Connection,
    workflow_id: &str,
    package_id: Option<&str>,
) -> CommandResult<()> {
    connection
        .execute(
            "UPDATE workflows SET package_id = ?2 WHERE id = ?1",
            params![workflow_id, package_id],
        )
        .map_err(error_to_string)?;
    Ok(())
}

pub(crate) fn upsert_team_member(
    connection: &Connection,
    member: &WorkflowTeamMember,
) -> CommandResult<()> {
    validate_member_payload(
        &member.agent_id,
        &member.name,
        &member.role_label,
        &member.allowed_tool_ids,
    )?;
    connection
        .execute(
            r#"
            INSERT INTO workflow_team_members (
                id, workflow_id, agent_id, name, role_label, order_index, responsibility_prompt,
                allowed_tool_ids_json, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE
            SET agent_id = excluded.agent_id,
                name = excluded.name,
                role_label = excluded.role_label,
                order_index = excluded.order_index,
                responsibility_prompt = excluded.responsibility_prompt,
                allowed_tool_ids_json = excluded.allowed_tool_ids_json,
                updated_at = excluded.updated_at
            "#,
            params![
                member.id,
                member.workflow_id,
                member.agent_id,
                member.name,
                member.role_label,
                member.order as i64,
                member.responsibility_prompt,
                member.allowed_tool_ids.as_ref().map(serialize_json).transpose()?,
                member.created_at as i64,
                member.updated_at as i64,
            ],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn upsert_step_internal(
    connection: &Connection,
    step: &WorkflowStepDefinition,
    validate_references: bool,
) -> CommandResult<()> {
    let workflow_id = match step {
        WorkflowStepDefinition::AgentTask { workflow_id, .. }
        | WorkflowStepDefinition::ReviewGate { workflow_id, .. }
        | WorkflowStepDefinition::LoopControl { workflow_id, .. } => workflow_id.as_str(),
    };
    if validate_references {
        validate_step_definition(connection, workflow_id, step)?;
    }

    let (id, step_type, name, order, payload_json) = match step {
        WorkflowStepDefinition::AgentTask {
            id,
            name,
            order,
            member_id,
            prompt_template,
            output_mode,
            next_step_id,
            ..
        } => (
            id.clone(),
            "agent_task".to_string(),
            name.clone(),
            *order,
            serialize_json(&serde_json::json!({
                "memberId": member_id,
                "promptTemplate": prompt_template,
                "outputMode": output_mode,
                "nextStepId": next_step_id,
            }))?,
        ),
        WorkflowStepDefinition::ReviewGate {
            id,
            name,
            order,
            member_id,
            prompt_template,
            source_step_id,
            pass_next_step_id,
            fail_next_step_id,
            pass_rule,
            ..
        } => (
            id.clone(),
            "review_gate".to_string(),
            name.clone(),
            *order,
            serialize_json(&serde_json::json!({
                "memberId": member_id,
                "promptTemplate": prompt_template,
                "sourceStepId": source_step_id,
                "passNextStepId": pass_next_step_id,
                "failNextStepId": fail_next_step_id,
                "passRule": pass_rule,
            }))?,
        ),
        WorkflowStepDefinition::LoopControl {
            id,
            name,
            order,
            loop_target_step_id,
            continue_when,
            finish_when,
            ..
        } => (
            id.clone(),
            "loop_control".to_string(),
            name.clone(),
            *order,
            serialize_json(&serde_json::json!({
                "loopTargetStepId": loop_target_step_id,
                "continueWhen": continue_when,
                "finishWhen": finish_when,
            }))?,
        ),
    };

    let now = now_timestamp() as i64;
    connection
        .execute(
            r#"
            INSERT INTO workflow_steps (id, workflow_id, type, name, order_index, payload_json, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(id) DO UPDATE
            SET type = excluded.type,
                name = excluded.name,
                order_index = excluded.order_index,
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at
            "#,
            params![id, workflow_id, step_type, name, order as i64, payload_json, now, now],
        )
        .map_err(error_to_string)?;
    Ok(())
}

pub(crate) fn upsert_step(
    connection: &Connection,
    step: &WorkflowStepDefinition,
) -> CommandResult<()> {
    upsert_step_internal(connection, step, true)
}

pub(crate) fn upsert_step_without_reference_validation(
    connection: &Connection,
    step: &WorkflowStepDefinition,
) -> CommandResult<()> {
    upsert_step_internal(connection, step, false)
}

pub(crate) fn read_workflow(connection: &Connection, workflow_id: &str) -> CommandResult<Workflow> {
    connection
        .query_row(
            r#"
            SELECT id, name, description, base_prompt, source, template_key, created_at, updated_at,
                   workspace_binding_json, loop_config_json, team_member_ids_json, step_ids_json,
                   last_run_id, last_run_status
            FROM workflows
            WHERE id = ?1
            "#,
            params![workflow_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, Option<String>>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, String>(13)?,
                ))
            },
        )
        .map_err(error_to_string)
        .and_then(
            |(
                id,
                name,
                description,
                base_prompt,
                source,
                template_key,
                created_at,
                updated_at,
                workspace_binding_raw,
                loop_config_raw,
                team_member_ids_raw,
                step_ids_raw,
                last_run_id,
                last_run_status,
            )| {
                Ok(Workflow {
                    id,
                    name,
                    description,
                    base_prompt,
                    source,
                    template_key,
                    created_at: created_at as u64,
                    updated_at: updated_at as u64,
                    workspace_binding: parse_optional_json(workspace_binding_raw)?,
                    loop_config: deserialize_json(&loop_config_raw)?,
                    team_member_ids: deserialize_json(&team_member_ids_raw)?,
                    step_ids: deserialize_json(&step_ids_raw)?,
                    last_run_id,
                    last_run_status,
                })
            },
        )
}

pub(crate) fn list_all_workflows(connection: &Connection) -> CommandResult<Vec<Workflow>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id
            FROM workflows
            ORDER BY updated_at DESC, created_at DESC
            "#,
        )
        .map_err(error_to_string)?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;
    ids.into_iter()
        .map(|workflow_id| read_workflow(connection, &workflow_id))
        .collect()
}

pub(crate) fn list_team_members(
    connection: &Connection,
    workflow_id: &str,
) -> CommandResult<Vec<WorkflowTeamMember>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, workflow_id, agent_id, name, role_label, order_index,
                   responsibility_prompt, allowed_tool_ids_json, created_at, updated_at
            FROM workflow_team_members
            WHERE workflow_id = ?1
            ORDER BY order_index ASC, created_at ASC
            "#,
        )
        .map_err(error_to_string)?;
    let mut rows = statement
        .query(params![workflow_id])
        .map_err(error_to_string)?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(error_to_string)? {
        result.push(WorkflowTeamMember {
            id: row.get::<_, String>(0).map_err(error_to_string)?,
            workflow_id: row.get::<_, String>(1).map_err(error_to_string)?,
            agent_id: row.get::<_, String>(2).map_err(error_to_string)?,
            name: row.get::<_, String>(3).map_err(error_to_string)?,
            role_label: row.get::<_, String>(4).map_err(error_to_string)?,
            order: row.get::<_, i64>(5).map_err(error_to_string)? as u64,
            responsibility_prompt: row.get::<_, String>(6).map_err(error_to_string)?,
            allowed_tool_ids: parse_optional_json(
                row.get::<_, Option<String>>(7).map_err(error_to_string)?,
            )?,
            created_at: row.get::<_, i64>(8).map_err(error_to_string)? as u64,
            updated_at: row.get::<_, i64>(9).map_err(error_to_string)? as u64,
        });
    }
    Ok(result)
}

pub(crate) fn list_steps(
    connection: &Connection,
    workflow_id: &str,
) -> CommandResult<Vec<WorkflowStepDefinition>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, workflow_id, type, name, order_index, payload_json
            FROM workflow_steps
            WHERE workflow_id = ?1
            ORDER BY order_index ASC, id ASC
            "#,
        )
        .map_err(error_to_string)?;
    let mut rows = statement
        .query(params![workflow_id])
        .map_err(error_to_string)?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(error_to_string)? {
        let id = row.get::<_, String>(0).map_err(error_to_string)?;
        let workflow_id = row.get::<_, String>(1).map_err(error_to_string)?;
        let step_type = row.get::<_, String>(2).map_err(error_to_string)?;
        let name = row.get::<_, String>(3).map_err(error_to_string)?;
        let order = row.get::<_, i64>(4).map_err(error_to_string)? as u64;
        let payload = row.get::<_, String>(5).map_err(error_to_string)?;
        let payload_value = serde_json::from_str::<Value>(&payload).map_err(error_to_string)?;
        let step = match step_type.as_str() {
            "agent_task" => WorkflowStepDefinition::AgentTask {
                id,
                workflow_id,
                name,
                order,
                member_id: payload_value
                    .get("memberId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                prompt_template: payload_value
                    .get("promptTemplate")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                output_mode: payload_value
                    .get("outputMode")
                    .and_then(Value::as_str)
                    .unwrap_or("text")
                    .to_string(),
                next_step_id: payload_value
                    .get("nextStepId")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
            },
            "review_gate" => WorkflowStepDefinition::ReviewGate {
                id,
                workflow_id,
                name,
                order,
                member_id: payload_value
                    .get("memberId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                prompt_template: payload_value
                    .get("promptTemplate")
                    .and_then(Value::as_str)
                    .unwrap_or("请基于来源节点的输出进行审查，并按 JSON 格式返回结论。")
                    .to_string(),
                source_step_id: payload_value
                    .get("sourceStepId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                pass_next_step_id: payload_value
                    .get("passNextStepId")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                fail_next_step_id: payload_value
                    .get("failNextStepId")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                pass_rule: payload_value
                    .get("passRule")
                    .and_then(Value::as_str)
                    .unwrap_or("review_json.pass == true")
                    .to_string(),
            },
            _ => WorkflowStepDefinition::LoopControl {
                id,
                workflow_id,
                name,
                order,
                loop_target_step_id: payload_value
                    .get("loopTargetStepId")
                    .and_then(Value::as_str)
                    .map(ToString::to_string),
                continue_when: payload_value
                    .get("continueWhen")
                    .and_then(Value::as_str)
                    .unwrap_or("remainingLoops > 0")
                    .to_string(),
                finish_when: payload_value
                    .get("finishWhen")
                    .and_then(Value::as_str)
                    .unwrap_or("remainingLoops <= 0")
                    .to_string(),
            },
        };
        result.push(step);
    }
    Ok(result)
}

pub(crate) fn list_runs(
    connection: &Connection,
    workflow_id: &str,
) -> CommandResult<Vec<WorkflowRun>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, workflow_id, status, started_at, finished_at, workspace_binding_json,
                   loop_config_snapshot_json, current_loop_index, max_loops, current_step_run_id,
                   stop_reason, summary, error_message
            FROM workflow_runs
            WHERE workflow_id = ?1
            ORDER BY started_at DESC, id DESC
            "#,
        )
        .map_err(error_to_string)?;
    let mut rows = statement
        .query(params![workflow_id])
        .map_err(error_to_string)?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(error_to_string)? {
        result.push(WorkflowRun {
            id: row.get::<_, String>(0).map_err(error_to_string)?,
            workflow_id: row.get::<_, String>(1).map_err(error_to_string)?,
            status: row.get::<_, String>(2).map_err(error_to_string)?,
            started_at: row.get::<_, i64>(3).map_err(error_to_string)? as u64,
            finished_at: row
                .get::<_, Option<i64>>(4)
                .map_err(error_to_string)?
                .map(|value| value as u64),
            workspace_binding: deserialize_json(
                &row.get::<_, String>(5).map_err(error_to_string)?,
            )?,
            loop_config_snapshot: deserialize_json(
                &row.get::<_, String>(6).map_err(error_to_string)?,
            )?,
            current_loop_index: row.get::<_, i64>(7).map_err(error_to_string)? as u64,
            max_loops: row.get::<_, i64>(8).map_err(error_to_string)? as u64,
            current_step_run_id: row.get::<_, Option<String>>(9).map_err(error_to_string)?,
            stop_reason: row.get::<_, Option<String>>(10).map_err(error_to_string)?,
            summary: row.get::<_, Option<String>>(11).map_err(error_to_string)?,
            error_message: row.get::<_, Option<String>>(12).map_err(error_to_string)?,
        });
    }
    Ok(result)
}

pub(crate) fn list_step_runs(
    connection: &Connection,
    workflow_id: &str,
) -> CommandResult<Vec<WorkflowStepRun>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, run_id, workflow_id, step_id, loop_index, attempt_index, member_id, status,
                   started_at, finished_at, input_prompt, result_text, result_json, decision_json,
                   parts_json, usage_json, error_message
            FROM workflow_step_runs
            WHERE workflow_id = ?1
            ORDER BY run_id DESC, loop_index ASC, attempt_index ASC, started_at ASC, id ASC
            "#,
        )
        .map_err(error_to_string)?;
    let mut rows = statement
        .query(params![workflow_id])
        .map_err(error_to_string)?;
    let mut result = Vec::new();
    while let Some(row) = rows.next().map_err(error_to_string)? {
        result.push(WorkflowStepRun {
            id: row.get::<_, String>(0).map_err(error_to_string)?,
            run_id: row.get::<_, String>(1).map_err(error_to_string)?,
            workflow_id: row.get::<_, String>(2).map_err(error_to_string)?,
            step_id: row.get::<_, String>(3).map_err(error_to_string)?,
            loop_index: row.get::<_, i64>(4).map_err(error_to_string)? as u64,
            attempt_index: row.get::<_, i64>(5).map_err(error_to_string)? as u64,
            member_id: row.get::<_, Option<String>>(6).map_err(error_to_string)?,
            status: row.get::<_, String>(7).map_err(error_to_string)?,
            started_at: row
                .get::<_, Option<i64>>(8)
                .map_err(error_to_string)?
                .map(|value| value as u64),
            finished_at: row
                .get::<_, Option<i64>>(9)
                .map_err(error_to_string)?
                .map(|value| value as u64),
            input_prompt: row.get::<_, String>(10).map_err(error_to_string)?,
            result_text: row.get::<_, String>(11).map_err(error_to_string)?,
            result_json: parse_optional_json::<WorkflowReviewResult>(
                row.get::<_, Option<String>>(12).map_err(error_to_string)?,
            )?,
            decision: parse_optional_json::<WorkflowStepDecision>(
                row.get::<_, Option<String>>(13).map_err(error_to_string)?,
            )?,
            parts: deserialize_json(&row.get::<_, String>(14).map_err(error_to_string)?)?,
            usage: parse_optional_json(row.get::<_, Option<String>>(15).map_err(error_to_string)?)?,
            error_message: row.get::<_, Option<String>>(16).map_err(error_to_string)?,
        });
    }
    Ok(result)
}

pub(crate) fn build_workflow_detail(
    connection: &Connection,
    workflow_id: &str,
) -> CommandResult<WorkflowDetail> {
    Ok(WorkflowDetail {
        workflow: read_workflow(connection, workflow_id)?,
        team_members: list_team_members(connection, workflow_id)?,
        steps: list_steps(connection, workflow_id)?,
        runs: list_runs(connection, workflow_id)?,
        step_runs: list_step_runs(connection, workflow_id)?,
    })
}

pub(crate) fn replace_workflow_member_ids(
    connection: &Connection,
    workflow_id: &str,
) -> CommandResult<()> {
    let ids = list_team_members(connection, workflow_id)?
        .into_iter()
        .map(|item| item.id)
        .collect::<Vec<_>>();
    connection
        .execute(
            "UPDATE workflows SET team_member_ids_json = ?2, updated_at = ?3 WHERE id = ?1",
            params![workflow_id, serialize_json(&ids)?, now_timestamp() as i64],
        )
        .map_err(error_to_string)?;
    Ok(())
}

pub(crate) fn replace_workflow_step_ids(
    connection: &Connection,
    workflow_id: &str,
) -> CommandResult<()> {
    let ids = list_steps(connection, workflow_id)?
        .into_iter()
        .map(|item| step_id(&item).to_string())
        .collect::<Vec<_>>();
    connection
        .execute(
            "UPDATE workflows SET step_ids_json = ?2, updated_at = ?3 WHERE id = ?1",
            params![workflow_id, serialize_json(&ids)?, now_timestamp() as i64],
        )
        .map_err(error_to_string)?;
    Ok(())
}

pub(crate) fn has_member(
    connection: &Connection,
    workflow_id: &str,
    target_member_id: &str,
) -> CommandResult<bool> {
    Ok(list_team_members(connection, workflow_id)?
        .into_iter()
        .any(|member| member.id == target_member_id))
}

pub(crate) fn has_step(
    connection: &Connection,
    workflow_id: &str,
    target_step_id: &str,
) -> CommandResult<bool> {
    Ok(list_steps(connection, workflow_id)?
        .into_iter()
        .any(|step| step_id(&step) == target_step_id))
}

pub(crate) fn read_member(
    connection: &Connection,
    workflow_id: &str,
    member_id: &str,
) -> CommandResult<WorkflowTeamMember> {
    list_team_members(connection, workflow_id)?
        .into_iter()
        .find(|member| member.id == member_id)
        .ok_or_else(|| "未找到团队成员。".to_string())
}

pub(crate) fn read_step(
    connection: &Connection,
    workflow_id: &str,
    target_step_id: &str,
) -> CommandResult<WorkflowStepDefinition> {
    list_steps(connection, workflow_id)?
        .into_iter()
        .find(|step| step_id(step) == target_step_id)
        .ok_or_else(|| "未找到工作流步骤。".to_string())
}

pub(crate) fn validate_reorder_member_ids(
    current_ids: &[String],
    ordered_member_ids: &[String],
) -> CommandResult<()> {
    let current_set = current_ids.iter().cloned().collect::<HashSet<_>>();
    let next_set = ordered_member_ids.iter().cloned().collect::<HashSet<_>>();
    if current_ids.len() != ordered_member_ids.len() || current_set != next_set {
        return Err("团队成员重排列表与当前成员不一致。".into());
    }
    Ok(())
}

pub(crate) fn validate_reorder_step_ids(
    current_ids: &[String],
    ordered_step_ids: &[String],
) -> CommandResult<()> {
    let current_set = current_ids.iter().cloned().collect::<HashSet<_>>();
    let next_set = ordered_step_ids.iter().cloned().collect::<HashSet<_>>();
    if current_ids.len() != ordered_step_ids.len() || current_set != next_set {
        return Err("步骤重排列表与当前步骤不一致。".into());
    }
    Ok(())
}
