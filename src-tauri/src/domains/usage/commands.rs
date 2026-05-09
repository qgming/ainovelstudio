use crate::infrastructure::db::open_database;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

type CommandResult<T> = Result<T, String>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLogEntry {
    message_id: String,
    session_id: String,
    session_title: String,
    /// 来源模式：chat（图书 Agent）
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

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn parse_entry_meta(raw: &str) -> StoredMessageMeta {
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return StoredMessageMeta::default();
    };
    let Some(meta) = value.get("message").and_then(|message| message.get("meta")) else {
        return StoredMessageMeta::default();
    };
    serde_json::from_value::<StoredMessageMeta>(meta.clone()).unwrap_or_default()
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
                e.id AS message_id,
                e.session_id,
                s.title AS session_title,
                e.created_at,
                e.payload_json
            FROM chat_entries e
            INNER JOIN chat_sessions s ON s.id = e.session_id
            WHERE e.entry_type = 'message'
              AND json_extract(e.payload_json, '$.message.role') = ?1
            ORDER BY e.created_at DESC, e.seq DESC
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
                row.get::<_, String>("payload_json")?,
            ))
        })
        .map_err(error_to_string)?;

    let mut logs = Vec::new();
    for row in chat_rows {
        let (message_id, session_id, session_title, created_at, payload_json) =
            row.map_err(error_to_string)?;
        let meta = parse_entry_meta(&payload_json);
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

    sort_logs(&mut logs);
    Ok(logs)
}
