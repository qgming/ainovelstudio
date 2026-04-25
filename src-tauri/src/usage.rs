use crate::db::open_database;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

type CommandResult<T> = Result<T, String>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLogEntry {
    message_id: String,
    session_id: String,
    session_title: String,
    /// 来源模式：chat（图书 Agent）/ workflow（工作流）/ expansion（创作台）
    source_type: String,
    source_name: String,
    book_name: String,
    created_at: String,
    recorded_at: String,
    provider: String,
    model_id: String,
    finish_reason: String,
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
    no_cache_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    reasoning_tokens: u64,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredMessageMeta {
    workspace_root_path: Option<String>,
    usage: Option<StoredUsage>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredUsage {
    pub recorded_at: Option<String>,
    pub provider: Option<String>,
    pub model_id: Option<String>,
    pub finish_reason: Option<String>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    pub no_cache_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredWorkflowBinding {
    root_path: Option<String>,
    book_name: Option<String>,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn current_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn parse_message_meta(raw: &str) -> StoredMessageMeta {
    if raw.trim().is_empty() || raw.trim() == "null" {
        return StoredMessageMeta::default();
    }

    serde_json::from_str::<StoredMessageMeta>(raw).unwrap_or_default()
}

fn parse_stored_usage(raw: &str) -> Option<StoredUsage> {
    if raw.trim().is_empty() || raw.trim() == "null" {
        return None;
    }

    serde_json::from_str::<StoredUsage>(raw).ok()
}

fn parse_workflow_binding(raw: &str) -> StoredWorkflowBinding {
    if raw.trim().is_empty() || raw.trim() == "null" {
        return StoredWorkflowBinding::default();
    }

    serde_json::from_str::<StoredWorkflowBinding>(raw).unwrap_or_default()
}

fn as_u64(value: Option<u64>) -> u64 {
    value.unwrap_or(0)
}

fn extract_book_name(workspace_root_path: Option<&str>) -> String {
    let Some(path) = workspace_root_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return String::new();
    };

    path.replace('\\', "/")
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_string()
}

fn millis_to_epoch(value: Option<i64>) -> String {
    value
        .map(|timestamp| (timestamp.max(0) as u64) / 1000)
        .unwrap_or(0)
        .to_string()
}

fn sort_logs(logs: &mut [UsageLogEntry]) {
    logs.sort_by(|left, right| {
        let right_timestamp = right
            .recorded_at
            .parse::<u64>()
            .unwrap_or_else(|_| right.created_at.parse::<u64>().unwrap_or(0));
        let left_timestamp = left
            .recorded_at
            .parse::<u64>()
            .unwrap_or_else(|_| left.created_at.parse::<u64>().unwrap_or(0));

        right_timestamp
            .cmp(&left_timestamp)
            .then_with(|| right.message_id.cmp(&left.message_id))
    });
}

#[tauri::command]
pub fn read_usage_logs(app: AppHandle) -> CommandResult<Vec<UsageLogEntry>> {
    let connection = open_database(&app)?;
    let mut chat_statement = connection
        .prepare(
            r#"
            SELECT
                m.id AS message_id,
                m.session_id,
                s.title AS session_title,
                m.created_at,
                m.meta_json
            FROM chat_messages m
            INNER JOIN chat_sessions s ON s.id = m.session_id
            WHERE m.role = ?1
            ORDER BY m.created_at DESC, m.seq DESC
            "#,
        )
        .map_err(error_to_string)?;

    let chat_rows = chat_statement
        .query_map(params!["assistant"], |row| {
            Ok((
                row.get::<_, String>("message_id")?,
                row.get::<_, String>("session_id")?,
                row.get::<_, String>("session_title")?,
                row.get::<_, String>("created_at")?,
                row.get::<_, String>("meta_json")?,
            ))
        })
        .map_err(error_to_string)?;

    let mut logs = Vec::new();
    for row in chat_rows {
        let (message_id, session_id, session_title, created_at, meta_json) =
            row.map_err(error_to_string)?;
        let meta = parse_message_meta(&meta_json);
        let Some(usage) = meta.usage else {
            continue;
        };

        logs.push(UsageLogEntry {
            message_id,
            session_id,
            session_title: session_title.clone(),
            source_type: "chat".to_string(),
            source_name: session_title,
            book_name: extract_book_name(meta.workspace_root_path.as_deref()),
            created_at: created_at.clone(),
            recorded_at: usage.recorded_at.unwrap_or(created_at),
            provider: usage.provider.unwrap_or_default(),
            model_id: usage.model_id.unwrap_or_default(),
            finish_reason: usage.finish_reason.unwrap_or_default(),
            input_tokens: as_u64(usage.input_tokens),
            output_tokens: as_u64(usage.output_tokens),
            total_tokens: as_u64(usage.total_tokens),
            no_cache_tokens: as_u64(usage.no_cache_tokens),
            cache_read_tokens: as_u64(usage.cache_read_tokens),
            cache_write_tokens: as_u64(usage.cache_write_tokens),
            reasoning_tokens: as_u64(usage.reasoning_tokens),
        });
    }

    let mut workflow_statement = connection
        .prepare(
            r#"
            SELECT
                sr.id AS message_id,
                sr.run_id AS session_id,
                w.name AS workflow_name,
                sr.started_at,
                sr.finished_at,
                sr.usage_json,
                r.workspace_binding_json
            FROM workflow_step_runs sr
            INNER JOIN workflow_runs r ON r.id = sr.run_id
            INNER JOIN workflows w ON w.id = sr.workflow_id
            WHERE sr.usage_json IS NOT NULL AND TRIM(sr.usage_json) != ''
            "#,
        )
        .map_err(error_to_string)?;

    let workflow_rows = workflow_statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>("message_id")?,
                row.get::<_, String>("session_id")?,
                row.get::<_, String>("workflow_name")?,
                row.get::<_, Option<i64>>("started_at")?,
                row.get::<_, Option<i64>>("finished_at")?,
                row.get::<_, String>("usage_json")?,
                row.get::<_, String>("workspace_binding_json")?,
            ))
        })
        .map_err(error_to_string)?;

    for row in workflow_rows {
        let (
            message_id,
            session_id,
            workflow_name,
            started_at,
            finished_at,
            usage_json,
            workspace_binding_json,
        ) = row.map_err(error_to_string)?;
        let Some(usage) = parse_stored_usage(&usage_json) else {
            continue;
        };
        let binding = parse_workflow_binding(&workspace_binding_json);
        let created_at = millis_to_epoch(finished_at.or(started_at));
        let binding_book_name = binding.book_name.unwrap_or_default();

        logs.push(UsageLogEntry {
            message_id,
            session_id,
            session_title: workflow_name.clone(),
            source_type: "workflow".to_string(),
            source_name: workflow_name,
            book_name: if binding_book_name.trim().is_empty() {
                extract_book_name(binding.root_path.as_deref())
            } else {
                binding_book_name
            },
            created_at: created_at.clone(),
            recorded_at: usage.recorded_at.unwrap_or(created_at),
            provider: usage.provider.unwrap_or_default(),
            model_id: usage.model_id.unwrap_or_default(),
            finish_reason: usage.finish_reason.unwrap_or_default(),
            input_tokens: as_u64(usage.input_tokens),
            output_tokens: as_u64(usage.output_tokens),
            total_tokens: as_u64(usage.total_tokens),
            no_cache_tokens: as_u64(usage.no_cache_tokens),
            cache_read_tokens: as_u64(usage.cache_read_tokens),
            cache_write_tokens: as_u64(usage.cache_write_tokens),
            reasoning_tokens: as_u64(usage.reasoning_tokens),
        });
    }

    append_expansion_logs(&connection, &mut logs)?;

    sort_logs(&mut logs);
    Ok(logs)
}


#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordExpansionUsageInput {
    pub workspace_id: String,
    pub workspace_name: Option<String>,
    pub action_id: String,
    pub action_label: Option<String>,
    pub usage: StoredUsage,
}

/// 写入一条创作台模式的用量日志。由前端 useExpansionWorkspaceAgent.onUsage 调用。
#[tauri::command]
pub fn record_expansion_usage(
    app: AppHandle,
    payload: RecordExpansionUsageInput,
) -> CommandResult<()> {
    let connection = open_database(&app)?;
    let usage_json = serde_json::to_string(&payload.usage).map_err(error_to_string)?;
    let created_at = current_timestamp_millis();
    let id = format!("expansion-usage-{}-{}", payload.workspace_id, created_at);
    connection
        .execute(
            r#"
            INSERT INTO expansion_usage_logs
              (id, workspace_id, workspace_name, action_id, action_label, usage_json, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                id,
                payload.workspace_id,
                payload.workspace_name.unwrap_or_default(),
                payload.action_id,
                payload.action_label.unwrap_or_default(),
                usage_json,
                created_at,
            ],
        )
        .map_err(error_to_string)?;
    Ok(())
}

/// 把创作台用量日志加到 logs 中。每条 expansion_usage_logs 行 → 一条 UsageLogEntry。
fn append_expansion_logs(
    connection: &rusqlite::Connection,
    logs: &mut Vec<UsageLogEntry>,
) -> CommandResult<()> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, workspace_id, workspace_name, action_id, action_label, usage_json, created_at
            FROM expansion_usage_logs
            "#,
        )
        .map_err(error_to_string)?;

    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>("id")?,
                row.get::<_, String>("workspace_id")?,
                row.get::<_, String>("workspace_name")?,
                row.get::<_, String>("action_id")?,
                row.get::<_, String>("action_label")?,
                row.get::<_, String>("usage_json")?,
                row.get::<_, i64>("created_at")?,
            ))
        })
        .map_err(error_to_string)?;

    for row in rows {
        let (id, workspace_id, workspace_name, action_id, action_label, usage_json, created_at) =
            row.map_err(error_to_string)?;
        let Some(usage) = parse_stored_usage(&usage_json) else {
            continue;
        };
        // created_at 表里是 ms；统一为秒字符串与其它来源对齐。
        let created_at_str = ((created_at.max(0) as u64) / 1000).to_string();
        let resolved_label = if action_label.trim().is_empty() {
            action_id.clone()
        } else {
            action_label.clone()
        };
        // 创作台没有"书籍"绑定，沿用 workspaceName 作为业务关联文本，兼容 UI 列。
        logs.push(UsageLogEntry {
            message_id: id,
            session_id: workspace_id.clone(),
            session_title: resolved_label.clone(),
            source_type: "expansion".to_string(),
            source_name: resolved_label,
            book_name: workspace_name,
            created_at: created_at_str.clone(),
            recorded_at: usage.recorded_at.unwrap_or(created_at_str),
            provider: usage.provider.unwrap_or_default(),
            model_id: usage.model_id.unwrap_or_default(),
            finish_reason: usage.finish_reason.unwrap_or_default(),
            input_tokens: as_u64(usage.input_tokens),
            output_tokens: as_u64(usage.output_tokens),
            total_tokens: as_u64(usage.total_tokens),
            no_cache_tokens: as_u64(usage.no_cache_tokens),
            cache_read_tokens: as_u64(usage.cache_read_tokens),
            cache_write_tokens: as_u64(usage.cache_write_tokens),
            reasoning_tokens: as_u64(usage.reasoning_tokens),
        });
    }
    Ok(())
}
