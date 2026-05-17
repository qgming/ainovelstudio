use crate::infrastructure::db::open_database;
use rusqlite::{params, Connection, Row};
use serde::Serialize;
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use uuid::Uuid;

type CommandResult<T> = Result<T, String>;
const AI_CALL_LOG_LIMIT: usize = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCallLogEntry {
    id: String,
    created_at: String,
    method: String,
    url: String,
    model_id: String,
    status: u16,
    ok: bool,
    request_json: String,
    response_json: String,
    error: String,
}

pub struct NewAiCallLog {
    pub method: String,
    pub url: String,
    pub status: u16,
    pub ok: bool,
    pub request_json: String,
    pub response_json: String,
    pub error: String,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn now_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn model_id_from_request(request_json: &str) -> String {
    serde_json::from_str::<Value>(request_json)
        .ok()
        .and_then(|value| {
            value
                .get("model")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn extract_sse_data_payloads(value: &str) -> Vec<Value> {
    let mut payloads = Vec::new();
    let mut current = Vec::<String>::new();

    for line in value.replace("\r\n", "\n").split('\n') {
        if line.trim().is_empty() {
            if !current.is_empty() {
                push_sse_payload(&mut payloads, &current.join("\n"));
                current.clear();
            }
            continue;
        }

        if let Some(payload) = line.strip_prefix("data:") {
            current.push(payload.trim_start().to_string());
        }
    }

    if !current.is_empty() {
        push_sse_payload(&mut payloads, &current.join("\n"));
    }

    payloads
}

fn push_sse_payload(payloads: &mut Vec<Value>, payload: &str) {
    let trimmed = payload.trim();
    if trimmed.is_empty() || trimmed == "[DONE]" {
        return;
    }

    match serde_json::from_str::<Value>(trimmed) {
        Ok(value) => payloads.push(value),
        Err(_) => payloads.push(Value::String(trimmed.to_string())),
    }
}

fn normalize_json_log_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if serde_json::from_str::<Value>(trimmed).is_ok() {
        return trimmed.to_string();
    }

    let sse_payloads = extract_sse_data_payloads(trimmed);
    if !sse_payloads.is_empty() {
        return serde_json::to_string(&sse_payloads).unwrap_or_else(|_| trimmed.to_string());
    }

    serde_json::to_string(trimmed).unwrap_or_else(|_| trimmed.to_string())
}

fn map_ai_call_log(row: &Row<'_>) -> rusqlite::Result<AiCallLogEntry> {
    Ok(AiCallLogEntry {
        id: row.get(0)?,
        created_at: row.get(1)?,
        method: row.get(2)?,
        url: row.get(3)?,
        model_id: row.get(4)?,
        status: row.get(5)?,
        ok: row.get::<_, i64>(6)? != 0,
        request_json: row.get(7)?,
        response_json: row.get(8)?,
        error: row.get(9)?,
    })
}

pub fn record_ai_call_log(app: &AppHandle, log: NewAiCallLog) -> CommandResult<()> {
    let connection = open_database(app)?;
    let request_json = normalize_json_log_value(&log.request_json);
    let response_json = normalize_json_log_value(&log.response_json);
    let model_id = model_id_from_request(&request_json);
    connection
        .execute(
            r#"
            INSERT INTO ai_call_logs (
                id,
                created_at,
                method,
                url,
                model_id,
                status,
                ok,
                request_json,
                response_json,
                error
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                Uuid::new_v4().to_string(),
                now_millis(),
                log.method,
                log.url,
                model_id,
                log.status,
                if log.ok { 1 } else { 0 },
                request_json,
                response_json,
                log.error,
            ],
        )
        .map_err(error_to_string)?;
    prune_ai_call_logs(&connection)
}

fn prune_ai_call_logs(connection: &Connection) -> CommandResult<()> {
    connection
        .execute(
            r#"
            DELETE FROM ai_call_logs
            WHERE id NOT IN (
                SELECT id FROM ai_call_logs
                ORDER BY CAST(created_at AS INTEGER) DESC
                LIMIT ?1
            )
            "#,
            params![AI_CALL_LOG_LIMIT as i64],
        )
        .map_err(error_to_string)?;
    Ok(())
}

#[tauri::command]
pub fn read_ai_call_logs(app: AppHandle) -> CommandResult<Vec<AiCallLogEntry>> {
    let connection = open_database(&app)?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT
                id,
                created_at,
                method,
                url,
                model_id,
                status,
                ok,
                request_json,
                response_json,
                error
            FROM ai_call_logs
            ORDER BY CAST(created_at AS INTEGER) DESC
            LIMIT ?1
            "#,
        )
        .map_err(error_to_string)?;
    let logs = statement
        .query_map(params![AI_CALL_LOG_LIMIT as i64], map_ai_call_log)
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;
    Ok(logs)
}

#[tauri::command]
pub fn clear_ai_call_logs(app: AppHandle) -> CommandResult<()> {
    let connection = open_database(&app)?;
    connection
        .execute("DELETE FROM ai_call_logs", [])
        .map_err(error_to_string)?;
    Ok(())
}
