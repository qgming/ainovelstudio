use crate::db::open_database;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

type CommandResult<T> = Result<T, String>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLogEntry {
    message_id: String,
    session_id: String,
    session_title: String,
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

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredUsage {
    recorded_at: Option<String>,
    provider: Option<String>,
    model_id: Option<String>,
    finish_reason: Option<String>,
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_tokens: Option<u64>,
    no_cache_tokens: Option<u64>,
    cache_read_tokens: Option<u64>,
    cache_write_tokens: Option<u64>,
    reasoning_tokens: Option<u64>,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn parse_message_meta(raw: &str) -> StoredMessageMeta {
    if raw.trim().is_empty() || raw.trim() == "null" {
        return StoredMessageMeta::default();
    }

    serde_json::from_str::<StoredMessageMeta>(raw).unwrap_or_default()
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

#[tauri::command]
pub fn read_usage_logs(app: AppHandle) -> CommandResult<Vec<UsageLogEntry>> {
    let connection = open_database(&app)?;
    let mut statement = connection
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

    let rows = statement
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
    for row in rows {
        let (message_id, session_id, session_title, created_at, meta_json) =
            row.map_err(error_to_string)?;
        let meta = parse_message_meta(&meta_json);
        let Some(usage) = meta.usage else {
            continue;
        };

        logs.push(UsageLogEntry {
            message_id,
            session_id,
            session_title,
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

    Ok(logs)
}
