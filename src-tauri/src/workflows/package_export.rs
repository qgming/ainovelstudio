use std::{
    collections::HashMap,
    io::{Cursor, Write},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

use super::{
    types::{
        Workflow, WorkflowPackageDefinition, WorkflowPackageManifest, WorkflowStepDefinition,
        WorkflowTeamMember, WorkflowTemplateStep, WorkflowTemplateTeamMember,
    },
    validate::error_to_string,
    CommandResult,
};

const WORKFLOW_PACKAGE_SCHEMA_VERSION: u64 = 1;
const WORKFLOW_PACKAGE_AUTHOR: &str = "ainovelstudio";

pub(crate) fn build_export_definition(
    workflow: &Workflow,
    package_id: &str,
    members: &[WorkflowTeamMember],
    steps: &[WorkflowStepDefinition],
) -> CommandResult<WorkflowPackageDefinition> {
    let member_keys = build_member_key_map(members);
    let step_keys = build_step_key_map(steps);

    Ok(WorkflowPackageDefinition {
        template_key: format!("exported:{package_id}"),
        name: workflow.name.clone(),
        description: workflow.description.clone(),
        base_prompt: workflow.base_prompt.clone(),
        loop_config: workflow.loop_config.clone(),
        team_members: build_template_members(members, &member_keys)?,
        steps: build_template_steps(steps, &member_keys, &step_keys)?,
    })
}

pub(crate) fn build_export_manifest(
    workflow: &Workflow,
    package_id: &str,
) -> WorkflowPackageManifest {
    let description = if workflow.description.trim().is_empty() {
        format!("导出自工作流《{}》的配置包。", workflow.name)
    } else {
        workflow.description.clone()
    };
    WorkflowPackageManifest {
        id: package_id.to_string(),
        name: workflow.name.clone(),
        description,
        version: Some("1.0.0".to_string()),
        author: Some(WORKFLOW_PACKAGE_AUTHOR.to_string()),
        tags: vec!["工作流".to_string(), "导出".to_string()],
        entry: Some("WORKFLOW.json".to_string()),
        schema_version: Some(WORKFLOW_PACKAGE_SCHEMA_VERSION),
    }
}

pub(crate) fn build_export_archive(
    manifest: &WorkflowPackageManifest,
    definition: &WorkflowPackageDefinition,
) -> CommandResult<Vec<u8>> {
    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

    write_archive_file(
        &mut archive,
        "manifest.json",
        &serde_json::to_string_pretty(manifest).map_err(error_to_string)?,
        options,
    )?;
    write_archive_file(
        &mut archive,
        "WORKFLOW.json",
        &serde_json::to_string_pretty(definition).map_err(error_to_string)?,
        options,
    )?;

    archive
        .finish()
        .map_err(error_to_string)
        .map(|cursor| cursor.into_inner())
}

pub(crate) fn build_export_package_id(workflow: &Workflow) -> String {
    let base = slugify_identifier(&workflow.name);
    let short_id = workflow
        .id
        .rsplit('-')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("workflow");
    let prefix = if base.is_empty() { "workflow" } else { &base };
    let max_prefix_len = 64usize.saturating_sub(short_id.len() + 1);
    let compact_prefix = prefix
        .chars()
        .take(max_prefix_len.max(1))
        .collect::<String>();
    trim_hyphen_edges(&format!("{compact_prefix}-{short_id}"))
}

pub(crate) fn sanitize_export_file_name(name: &str) -> String {
    let sanitized = name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            _ => character,
        })
        .collect::<String>()
        .trim()
        .trim_matches('.')
        .to_string();
    if sanitized.is_empty() {
        "workflow-export".to_string()
    } else {
        sanitized
    }
}

fn build_member_key_map(members: &[WorkflowTeamMember]) -> HashMap<String, String> {
    members
        .iter()
        .enumerate()
        .map(|(index, member)| (member.id.clone(), format!("member-{}", index + 1)))
        .collect()
}

fn build_step_key_map(steps: &[WorkflowStepDefinition]) -> HashMap<String, String> {
    steps
        .iter()
        .enumerate()
        .map(|(index, step)| (step_identifier(step), format!("step-{}", index + 1)))
        .collect()
}

fn build_template_members(
    members: &[WorkflowTeamMember],
    member_keys: &HashMap<String, String>,
) -> CommandResult<Vec<WorkflowTemplateTeamMember>> {
    members
        .iter()
        .map(|member| {
            Ok(WorkflowTemplateTeamMember {
                key: required_key(member_keys, &member.id, "团队成员")?,
                agent_id: member.agent_id.clone(),
                name: member.name.clone(),
                role_label: member.role_label.clone(),
                responsibility_prompt: member.responsibility_prompt.clone(),
                allowed_tool_ids: member.allowed_tool_ids.clone(),
            })
        })
        .collect()
}

fn build_template_steps(
    steps: &[WorkflowStepDefinition],
    member_keys: &HashMap<String, String>,
    step_keys: &HashMap<String, String>,
) -> CommandResult<Vec<WorkflowTemplateStep>> {
    steps
        .iter()
        .map(|step| match step {
            WorkflowStepDefinition::Start {
                id,
                name,
                next_step_id,
                ..
            } => Ok(WorkflowTemplateStep::Start {
                key: required_key(step_keys, id, "步骤")?,
                name: name.clone(),
                next_step_key: optional_key(step_keys, next_step_id.as_deref()),
            }),
            WorkflowStepDefinition::AgentTask {
                id,
                name,
                member_id,
                prompt_template,
                output_mode,
                next_step_id,
                ..
            } => Ok(WorkflowTemplateStep::AgentTask {
                key: required_key(step_keys, id, "步骤")?,
                name: name.clone(),
                member_key: required_key(member_keys, member_id, "团队成员")?,
                prompt_template: prompt_template.clone(),
                output_mode: output_mode.clone(),
                next_step_key: optional_key(step_keys, next_step_id.as_deref()),
            }),
            WorkflowStepDefinition::Decision {
                id,
                name,
                member_id,
                prompt_template,
                source_step_id,
                true_next_step_id,
                false_next_step_id,
                pass_rule,
                ..
            } => Ok(WorkflowTemplateStep::Decision {
                key: required_key(step_keys, id, "步骤")?,
                name: name.clone(),
                member_key: required_key(member_keys, member_id, "团队成员")?,
                prompt_template: prompt_template.clone(),
                source_step_key: required_key(step_keys, source_step_id, "来源步骤")?,
                true_next_step_key: optional_key(step_keys, true_next_step_id.as_deref()),
                false_next_step_key: optional_key(step_keys, false_next_step_id.as_deref()),
                pass_rule: pass_rule.clone(),
            }),
            WorkflowStepDefinition::End {
                id,
                name,
                stop_reason,
                summary_template,
                loop_behavior,
                loop_target_step_id,
                ..
            } => Ok(WorkflowTemplateStep::End {
                key: required_key(step_keys, id, "步骤")?,
                name: name.clone(),
                stop_reason: stop_reason.clone(),
                summary_template: summary_template.clone(),
                loop_behavior: loop_behavior.clone(),
                loop_target_step_key: optional_key(step_keys, loop_target_step_id.as_deref()),
            }),
        })
        .collect()
}

fn write_archive_file(
    archive: &mut ZipWriter<Cursor<Vec<u8>>>,
    path: &str,
    content: &str,
    options: SimpleFileOptions,
) -> CommandResult<()> {
    archive.start_file(path, options).map_err(error_to_string)?;
    archive
        .write_all(content.as_bytes())
        .map_err(error_to_string)?;
    Ok(())
}

fn step_identifier(step: &WorkflowStepDefinition) -> String {
    match step {
        WorkflowStepDefinition::Start { id, .. }
        | WorkflowStepDefinition::AgentTask { id, .. }
        | WorkflowStepDefinition::Decision { id, .. }
        | WorkflowStepDefinition::End { id, .. } => id.clone(),
    }
}

fn slugify_identifier(value: &str) -> String {
    let mut result = String::new();
    let mut previous_was_hyphen = false;
    for character in value.chars() {
        let normalized = character.to_ascii_lowercase();
        if normalized.is_ascii_lowercase() || normalized.is_ascii_digit() {
            result.push(normalized);
            previous_was_hyphen = false;
        } else if !previous_was_hyphen && !result.is_empty() {
            result.push('-');
            previous_was_hyphen = true;
        }
    }
    trim_hyphen_edges(&result)
}

fn trim_hyphen_edges(value: &str) -> String {
    value.trim_matches('-').to_string()
}

fn required_key(
    keys_by_id: &HashMap<String, String>,
    id: &str,
    label: &str,
) -> CommandResult<String> {
    keys_by_id
        .get(id)
        .cloned()
        .ok_or_else(|| format!("导出工作流失败：未找到{label}映射。"))
}

fn optional_key(keys_by_id: &HashMap<String, String>, id: Option<&str>) -> Option<String> {
    id.and_then(|value| keys_by_id.get(value).cloned())
}
