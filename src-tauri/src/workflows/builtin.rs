use crate::embedded_resources::EMBEDDED_WORKFLOW_FILES;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{HashMap, HashSet};

use super::{
    repository::{
        insert_workflow, set_workflow_package_id, upsert_step_without_reference_validation,
        upsert_team_member, validate_all_step_references,
    },
    types::{
        BuiltinWorkflowsInitializationResult, WorkflowFiles, WorkflowPackageDefinition,
        WorkflowPackageManifest, WorkflowPackageRecord, WorkflowStepDefinition, WorkflowTeamMember,
        WorkflowTemplateStep,
    },
    validate::{
        build_workflow, create_id, deserialize_json, normalize_text_content, now_timestamp,
        serialize_json, step_id, validate_workflow_package_manifest,
    },
    CommandResult, WORKFLOW_PRIMARY_FILES, WORKFLOW_SOURCE_BUILTIN, WORKFLOW_SOURCE_INSTALLED,
};

pub(crate) fn collect_embedded_workflow_files(workflow_id: &str) -> WorkflowFiles {
    let prefix = format!("{workflow_id}/");
    EMBEDDED_WORKFLOW_FILES
        .iter()
        .filter(|file| file.path.starts_with(&prefix))
        .filter_map(|file| {
            file.path.strip_prefix(&prefix).map(|relative_path| {
                (
                    relative_path.to_string(),
                    normalize_text_content(file.content),
                )
            })
        })
        .collect()
}

pub(crate) fn embedded_workflow_ids() -> Vec<String> {
  let mut ids = EMBEDDED_WORKFLOW_FILES
        .iter()
        .filter_map(|file| file.path.split('/').next())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    ids
}

fn list_builtin_package_ids(connection: &Connection) -> CommandResult<Vec<String>> {
    let mut statement = connection
        .prepare(
            "SELECT id FROM workflow_packages WHERE source_kind = ?1 OR is_builtin = 1 ORDER BY id ASC",
        )
        .map_err(super::validate::error_to_string)?;
    let rows = statement
        .query_map(params![WORKFLOW_SOURCE_BUILTIN], |row| row.get::<_, String>(0))
        .map_err(super::validate::error_to_string)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(super::validate::error_to_string)
}

fn remove_stale_builtin_workflows(connection: &Connection) -> CommandResult<()> {
    let active_package_ids = embedded_workflow_ids().into_iter().collect::<HashSet<_>>();
    let stored_package_ids = list_builtin_package_ids(connection)?;

    for package_id in stored_package_ids {
        if active_package_ids.contains(&package_id) {
            continue;
        }

        let template_key = format!("builtin:{package_id}");
        connection
            .execute(
                "DELETE FROM workflows WHERE source = ?1 AND (package_id = ?2 OR template_key = ?3)",
                params![WORKFLOW_SOURCE_BUILTIN, package_id, template_key],
            )
            .map_err(super::validate::error_to_string)?;
        connection
            .execute("DELETE FROM workflow_packages WHERE id = ?1", params![package_id])
            .map_err(super::validate::error_to_string)?;
    }

    Ok(())
}

pub(crate) fn save_workflow_package_record(
    connection: &Connection,
    package_id: &str,
    source_kind: &str,
    is_builtin: bool,
    manifest: &WorkflowPackageManifest,
    files: &WorkflowFiles,
) -> CommandResult<()> {
    connection
        .execute(
            r#"
            INSERT INTO workflow_packages (id, source_kind, is_builtin, manifest_json, files_json, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE
            SET source_kind = excluded.source_kind,
                is_builtin = excluded.is_builtin,
                manifest_json = excluded.manifest_json,
                files_json = excluded.files_json,
                updated_at = excluded.updated_at
            "#,
            params![
                package_id,
                source_kind,
                if is_builtin { 1 } else { 0 },
                serialize_json(manifest)?,
                serialize_json(files)?,
                now_timestamp() as i64,
            ],
        )
        .map_err(super::validate::error_to_string)?;
    Ok(())
}

pub(crate) fn load_workflow_package_record(
    connection: &Connection,
    workflow_id: &str,
) -> CommandResult<
    Option<(
        WorkflowPackageRecord,
        WorkflowPackageManifest,
        WorkflowFiles,
    )>,
> {
    connection
        .query_row(
            "SELECT id, source_kind, is_builtin, manifest_json, files_json, updated_at FROM workflow_packages WHERE id = ?1",
            params![workflow_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .optional()
        .map_err(super::validate::error_to_string)?
        .map(|(id, source_kind, is_builtin, manifest_json, files_json, updated_at)| {
            let record = WorkflowPackageRecord {
                id,
                source_kind,
                is_builtin: is_builtin != 0,
                manifest_json: manifest_json.clone(),
                files_json: files_json.clone(),
                updated_at: updated_at as u64,
            };
            let manifest = deserialize_json::<WorkflowPackageManifest>(&manifest_json)?;
            let files = deserialize_json::<WorkflowFiles>(&files_json)?;
            Ok((record, manifest, files))
        })
        .transpose()
}

pub(crate) fn parse_workflow_package_definition(
    files: &WorkflowFiles,
) -> CommandResult<WorkflowPackageDefinition> {
    for primary_file in WORKFLOW_PRIMARY_FILES {
        if !files.contains_key(primary_file) {
            return Err(format!("workflow package 缺少 {}。", primary_file));
        }
    }

    let workflow_text = files
        .get("WORKFLOW.json")
        .ok_or_else(|| "workflow package 缺少 WORKFLOW.json。".to_string())?;
    deserialize_json(workflow_text)
}

pub(crate) fn read_workflow_id_by_template_key(
    connection: &Connection,
    template_key: &str,
) -> CommandResult<Option<String>> {
    connection
        .query_row(
            "SELECT id FROM workflows WHERE template_key = ?1",
            params![template_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(super::validate::error_to_string)
}

pub(crate) fn count_workflow_related_rows(
    connection: &Connection,
    workflow_id: &str,
) -> CommandResult<(u64, u64)> {
    let member_count = connection
        .query_row(
            "SELECT COUNT(*) FROM workflow_team_members WHERE workflow_id = ?1",
            params![workflow_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(super::validate::error_to_string)?;
    let step_count = connection
        .query_row(
            "SELECT COUNT(*) FROM workflow_steps WHERE workflow_id = ?1",
            params![workflow_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(super::validate::error_to_string)?;
    Ok((member_count as u64, step_count as u64))
}

pub(crate) fn should_repair_builtin_workflow(
    connection: &Connection,
    workflow_id: &str,
    package_id: &str,
    package_changed: bool,
) -> CommandResult<bool> {
    let current_package_id = connection
        .query_row(
            "SELECT package_id FROM workflows WHERE id = ?1",
            params![workflow_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(super::validate::error_to_string)?
        .flatten();
    let (member_count, step_count) = count_workflow_related_rows(connection, workflow_id)?;
    Ok(package_changed
        || current_package_id.as_deref() != Some(package_id)
        || member_count == 0
        || step_count == 0)
}

pub(crate) fn materialize_workflow_from_package(
    connection: &Connection,
    package_id: &str,
    manifest: &WorkflowPackageManifest,
    definition: &WorkflowPackageDefinition,
) -> CommandResult<Option<String>> {
    let exists = read_workflow_id_by_template_key(connection, &definition.template_key)?;
    if exists.is_some() {
        return Ok(None);
    }
    materialize_workflow_from_package_force(connection, package_id, manifest, definition).map(Some)
}

pub(crate) fn materialize_workflow_from_package_force(
    connection: &Connection,
    package_id: &str,
    manifest: &WorkflowPackageManifest,
    definition: &WorkflowPackageDefinition,
) -> CommandResult<String> {
    let now = now_timestamp();
    let workflow_id = create_id("workflow");
    let mut workflow = build_workflow(
        &workflow_id,
        &definition.name,
        &definition.description,
        &definition.base_prompt,
        if manifest.id.starts_with("auto-") {
            "builtin"
        } else {
            "user"
        },
        Some(&definition.template_key),
        definition.loop_config.clone(),
        now,
    );
    workflow.updated_at = now;
    insert_workflow(connection, &workflow)?;
    set_workflow_package_id(connection, &workflow_id, Some(package_id))?;

    let mut member_ids_by_key = HashMap::<String, String>::new();
    let mut members = Vec::new();
    for (index, member) in definition.team_members.iter().enumerate() {
        let member_id = create_id("workflow-member");
        member_ids_by_key.insert(member.key.clone(), member_id.clone());
        members.push(WorkflowTeamMember {
            id: member_id,
            workflow_id: workflow_id.clone(),
            agent_id: member.agent_id.clone(),
            name: member.name.clone(),
            role_label: member.role_label.clone(),
            order: index as u64,
            responsibility_prompt: member.responsibility_prompt.clone(),
            allowed_tool_ids: member.allowed_tool_ids.clone(),
            created_at: now,
            updated_at: now,
        });
    }
    for member in &members {
        upsert_team_member(connection, member)?;
    }

    let mut step_ids_by_key = HashMap::<String, String>::new();
    for step in &definition.steps {
        let key = match step {
            WorkflowTemplateStep::Start { key, .. }
            | WorkflowTemplateStep::AgentTask { key, .. }
            | WorkflowTemplateStep::Decision { key, .. }
            | WorkflowTemplateStep::End { key, .. } => key,
        };
        step_ids_by_key.insert(key.clone(), create_id("workflow-step"));
    }

    let mut steps = Vec::new();
    for (index, step) in definition.steps.iter().enumerate() {
        let order = index as u64;
        let built_step =
            match step {
                WorkflowTemplateStep::Start {
                    key,
                    name,
                    next_step_key,
                } => WorkflowStepDefinition::Start {
                    id: step_ids_by_key
                        .get(key)
                        .cloned()
                        .ok_or_else(|| "workflow 模板缺少步骤键。".to_string())?,
                    workflow_id: workflow_id.clone(),
                    name: name.clone(),
                    order,
                    next_step_id: next_step_key
                        .as_ref()
                        .and_then(|value| step_ids_by_key.get(value).cloned()),
                },
                WorkflowTemplateStep::AgentTask {
                    key,
                    name,
                    member_key,
                    prompt_template,
                    output_mode,
                    next_step_key,
                } => WorkflowStepDefinition::AgentTask {
                    id: step_ids_by_key
                        .get(key)
                        .cloned()
                        .ok_or_else(|| "workflow 模板缺少步骤键。".to_string())?,
                    workflow_id: workflow_id.clone(),
                    name: name.clone(),
                    order,
                    member_id: member_ids_by_key.get(member_key).cloned().ok_or_else(|| {
                        format!("workflow 模板引用了不存在的成员键：{member_key}")
                    })?,
                    prompt_template: prompt_template.clone(),
                    output_mode: output_mode.clone(),
                    next_step_id: next_step_key
                        .as_ref()
                        .and_then(|value| step_ids_by_key.get(value).cloned()),
                },
                WorkflowTemplateStep::Decision {
                    key,
                    name,
                    member_key,
                    prompt_template,
                    source_step_key,
                    true_next_step_key,
                    false_next_step_key,
                    pass_rule,
                } => WorkflowStepDefinition::Decision {
                    id: step_ids_by_key
                        .get(key)
                        .cloned()
                        .ok_or_else(|| "workflow 模板缺少步骤键。".to_string())?,
                    workflow_id: workflow_id.clone(),
                    name: name.clone(),
                    order,
                    member_id: member_ids_by_key
                        .get(member_key)
                        .cloned()
                        .or_else(|| members.first().map(|item| item.id.clone()))
                        .unwrap_or_default(),
                    prompt_template: prompt_template.clone(),
                    source_step_id: step_ids_by_key.get(source_step_key).cloned().ok_or_else(
                        || format!("workflow 模板引用了不存在的步骤键：{source_step_key}"),
                    )?,
                    true_next_step_id: true_next_step_key
                        .as_ref()
                        .and_then(|value| step_ids_by_key.get(value).cloned()),
                    false_next_step_id: false_next_step_key
                        .as_ref()
                        .and_then(|value| step_ids_by_key.get(value).cloned()),
                    pass_rule: pass_rule.clone(),
                },
                WorkflowTemplateStep::End {
                    key,
                    name,
                    stop_reason,
                    summary_template,
                    loop_behavior,
                    loop_target_step_key,
                } => WorkflowStepDefinition::End {
                    id: step_ids_by_key
                        .get(key)
                        .cloned()
                        .ok_or_else(|| "workflow 模板缺少步骤键。".to_string())?,
                    workflow_id: workflow_id.clone(),
                    name: name.clone(),
                    order,
                    stop_reason: stop_reason.clone(),
                    summary_template: summary_template.clone(),
                    loop_behavior: loop_behavior.clone(),
                    loop_target_step_id: loop_target_step_key
                        .as_ref()
                        .and_then(|value| step_ids_by_key.get(value).cloned()),
                },
            };
        steps.push(built_step);
    }

    for step in &steps {
        upsert_step_without_reference_validation(connection, step)?;
    }
    validate_all_step_references(connection, &workflow_id)?;

    workflow.team_member_ids = members.into_iter().map(|item| item.id).collect();
    workflow.step_ids = steps.iter().map(|item| step_id(item).to_string()).collect();
    insert_workflow(connection, &workflow)?;
    set_workflow_package_id(connection, &workflow_id, Some(package_id))?;
    Ok(workflow_id)
}

pub(crate) fn repair_builtin_workflow_from_package(
    connection: &Connection,
    workflow_id: &str,
    package_id: &str,
    manifest: &WorkflowPackageManifest,
    definition: &WorkflowPackageDefinition,
) -> CommandResult<String> {
    connection
        .execute("DELETE FROM workflows WHERE id = ?1", params![workflow_id])
        .map_err(super::validate::error_to_string)?;
    materialize_workflow_from_package_force(connection, package_id, manifest, definition)
}

pub(crate) fn sync_builtin_workflow_definition(
    connection: &Connection,
    package_id: &str,
    manifest: &WorkflowPackageManifest,
    definition: &WorkflowPackageDefinition,
    package_changed: bool,
) -> CommandResult<Option<String>> {
    match read_workflow_id_by_template_key(connection, &definition.template_key)? {
        Some(existing_workflow_id) => {
            if should_repair_builtin_workflow(
                connection,
                &existing_workflow_id,
                package_id,
                package_changed,
            )? {
                return repair_builtin_workflow_from_package(
                    connection,
                    &existing_workflow_id,
                    package_id,
                    manifest,
                    definition,
                )
                .map(Some);
            }
            Ok(None)
        }
        None => materialize_workflow_from_package(connection, package_id, manifest, definition),
    }
}

pub(crate) fn sync_builtin_workflow_packages_to_database(
    connection: &Connection,
) -> CommandResult<Vec<(WorkflowPackageManifest, WorkflowPackageDefinition, bool)>> {
    let mut result = Vec::new();
    for workflow_id in embedded_workflow_ids() {
        let existing_record = load_workflow_package_record(connection, &workflow_id)?;
        if let Some((existing, _, _)) = &existing_record {
            if existing.source_kind == WORKFLOW_SOURCE_INSTALLED {
                continue;
            }
        }

        let files = collect_embedded_workflow_files(&workflow_id);
        let manifest_text = files
            .get("manifest.json")
            .ok_or_else(|| format!("内置 workflow {workflow_id} 缺少 manifest.json。"))?;
        let manifest = deserialize_json::<WorkflowPackageManifest>(manifest_text)?;
        validate_workflow_package_manifest(&manifest, &workflow_id)?;
        let definition = parse_workflow_package_definition(&files)?;
        let manifest_json = serialize_json(&manifest)?;
        let files_json = serialize_json(&files)?;
        let package_changed = existing_record
            .as_ref()
            .map(|(existing, _, _)| {
                existing.manifest_json != manifest_json || existing.files_json != files_json
            })
            .unwrap_or(true);
        save_workflow_package_record(
            connection,
            &workflow_id,
            WORKFLOW_SOURCE_BUILTIN,
            true,
            &manifest,
            &files,
        )?;
        result.push((manifest, definition, package_changed));
    }
    Ok(result)
}

pub(crate) fn ensure_workflow_package_id_column(connection: &Connection) -> CommandResult<()> {
    let mut statement = connection
        .prepare("PRAGMA table_info(workflows)")
        .map_err(super::validate::error_to_string)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(super::validate::error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(super::validate::error_to_string)?;
    if columns.iter().any(|column| column == "package_id") {
        return Ok(());
    }
    connection
        .execute("ALTER TABLE workflows ADD COLUMN package_id TEXT", [])
        .map_err(super::validate::error_to_string)?;
    Ok(())
}

pub(crate) fn sync_builtin_workflows_to_database(
    connection: &Connection,
) -> CommandResult<BuiltinWorkflowsInitializationResult> {
    ensure_workflow_package_id_column(connection)?;
    remove_stale_builtin_workflows(connection)?;
    let packages = sync_builtin_workflow_packages_to_database(connection)?;
    let mut initialized_workflow_ids = Vec::new();
    let mut skipped_template_keys = Vec::new();

    for (manifest, definition, package_changed) in packages {
        match sync_builtin_workflow_definition(
            connection,
            &manifest.id,
            &manifest,
            &definition,
            package_changed,
        )? {
            Some(workflow_id) => initialized_workflow_ids.push(workflow_id),
            None => skipped_template_keys.push(definition.template_key),
        }
    }

    Ok(BuiltinWorkflowsInitializationResult {
        initialized_workflow_ids,
        skipped_template_keys,
    })
}
