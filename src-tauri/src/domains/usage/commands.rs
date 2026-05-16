use crate::infrastructure::db::open_database;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

type CommandResult<T> = Result<T, String>;
const USAGE_LOG_LIMIT: usize = 100;

#[derive(Clone, Serialize)]
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

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    request_count: u64,
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
    no_cache_tokens: u64,
    cache_read_tokens: u64,
    cache_write_tokens: u64,
    reasoning_tokens: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDailyStat {
    date_key: String,
    request_count: u64,
    token_total: u64,
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

fn parse_entry_meta_value(value: &Value) -> StoredMessageMeta {
    let Some(meta) = value.get("message").and_then(|message| message.get("meta")) else {
        return StoredMessageMeta::default();
    };
    serde_json::from_value::<StoredMessageMeta>(meta.clone()).unwrap_or_default()
}

fn as_u64(value: Option<u64>) -> u64 {
    value.unwrap_or(0)
}

fn as_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn read_u64(row: &Row<'_>, column: &str) -> rusqlite::Result<u64> {
    let value = row.get::<_, i64>(column)?;
    Ok(value.max(0) as u64)
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

fn add_summary_delta(connection: &Connection, delta: &UsageSummary) -> CommandResult<()> {
    connection
        .execute(
            r#"
            INSERT INTO usage_summary (
                id, request_count, input_tokens, output_tokens, total_tokens,
                no_cache_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, updated_at
            )
            VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, strftime('%s', 'now'))
            ON CONFLICT(id) DO UPDATE SET
                request_count = usage_summary.request_count + excluded.request_count,
                input_tokens = usage_summary.input_tokens + excluded.input_tokens,
                output_tokens = usage_summary.output_tokens + excluded.output_tokens,
                total_tokens = usage_summary.total_tokens + excluded.total_tokens,
                no_cache_tokens = usage_summary.no_cache_tokens + excluded.no_cache_tokens,
                cache_read_tokens = usage_summary.cache_read_tokens + excluded.cache_read_tokens,
                cache_write_tokens = usage_summary.cache_write_tokens + excluded.cache_write_tokens,
                reasoning_tokens = usage_summary.reasoning_tokens + excluded.reasoning_tokens,
                updated_at = excluded.updated_at
            "#,
            params![
                as_i64(delta.request_count),
                as_i64(delta.input_tokens),
                as_i64(delta.output_tokens),
                as_i64(delta.total_tokens),
                as_i64(delta.no_cache_tokens),
                as_i64(delta.cache_read_tokens),
                as_i64(delta.cache_write_tokens),
                as_i64(delta.reasoning_tokens),
            ],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn subtract_summary_delta(connection: &Connection, delta: &UsageSummary) -> CommandResult<()> {
    connection
        .execute(
            r#"
            UPDATE usage_summary SET
                request_count = MAX(0, request_count - ?1),
                input_tokens = MAX(0, input_tokens - ?2),
                output_tokens = MAX(0, output_tokens - ?3),
                total_tokens = MAX(0, total_tokens - ?4),
                no_cache_tokens = MAX(0, no_cache_tokens - ?5),
                cache_read_tokens = MAX(0, cache_read_tokens - ?6),
                cache_write_tokens = MAX(0, cache_write_tokens - ?7),
                reasoning_tokens = MAX(0, reasoning_tokens - ?8),
                updated_at = strftime('%s', 'now')
            WHERE id = 1
            "#,
            params![
                as_i64(delta.request_count),
                as_i64(delta.input_tokens),
                as_i64(delta.output_tokens),
                as_i64(delta.total_tokens),
                as_i64(delta.no_cache_tokens),
                as_i64(delta.cache_read_tokens),
                as_i64(delta.cache_write_tokens),
                as_i64(delta.reasoning_tokens),
            ],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn date_key_for_epoch(connection: &Connection, epoch: &str) -> CommandResult<String> {
    connection
        .query_row(
            "SELECT COALESCE(strftime('%Y-%m-%d', ?1, 'unixepoch', 'localtime'), '')",
            params![epoch],
            |row| row.get::<_, String>(0),
        )
        .map_err(error_to_string)
}

fn add_daily_delta(
    connection: &Connection,
    recorded_at: &str,
    total_tokens: u64,
) -> CommandResult<()> {
    let date_key = date_key_for_epoch(connection, recorded_at)?;
    if date_key.is_empty() {
        return Ok(());
    }
    connection
        .execute(
            r#"
            INSERT INTO usage_daily_stats (date_key, request_count, token_total, updated_at)
            VALUES (?1, 1, ?2, strftime('%s', 'now'))
            ON CONFLICT(date_key) DO UPDATE SET
                request_count = usage_daily_stats.request_count + 1,
                token_total = usage_daily_stats.token_total + excluded.token_total,
                updated_at = excluded.updated_at
            "#,
            params![date_key, as_i64(total_tokens)],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn subtract_daily_delta(
    connection: &Connection,
    recorded_at: &str,
    total_tokens: u64,
) -> CommandResult<()> {
    let date_key = date_key_for_epoch(connection, recorded_at)?;
    if date_key.is_empty() {
        return Ok(());
    }
    connection
        .execute(
            r#"
            UPDATE usage_daily_stats SET
                request_count = MAX(0, request_count - 1),
                token_total = MAX(0, token_total - ?2),
                updated_at = strftime('%s', 'now')
            WHERE date_key = ?1
            "#,
            params![date_key, as_i64(total_tokens)],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn map_usage_log(row: &Row<'_>) -> rusqlite::Result<UsageLogEntry> {
    Ok(UsageLogEntry {
        message_id: row.get("message_id")?,
        session_id: row.get("session_id")?,
        session_title: row.get("session_title")?,
        source_type: row.get("source_type")?,
        source_name: row.get("source_name")?,
        book_name: row.get("book_name")?,
        created_at: row.get("created_at")?,
        recorded_at: row.get("recorded_at")?,
        provider: row.get("provider")?,
        model_id: row.get("model_id")?,
        finish_reason: row.get("finish_reason")?,
        input_tokens: read_u64(row, "input_tokens")?,
        output_tokens: read_u64(row, "output_tokens")?,
        total_tokens: read_u64(row, "total_tokens")?,
        no_cache_tokens: read_u64(row, "no_cache_tokens")?,
        cache_read_tokens: read_u64(row, "cache_read_tokens")?,
        cache_write_tokens: read_u64(row, "cache_write_tokens")?,
        reasoning_tokens: read_u64(row, "reasoning_tokens")?,
    })
}

fn read_usage_log_by_message_id(
    connection: &Connection,
    message_id: &str,
) -> CommandResult<Option<UsageLogEntry>> {
    connection
        .query_row(
            r#"
            SELECT message_id, session_id, session_title, source_type, source_name, book_name,
                   created_at, recorded_at, provider, model_id, finish_reason,
                   input_tokens, output_tokens, total_tokens, no_cache_tokens,
                   cache_read_tokens, cache_write_tokens, reasoning_tokens
            FROM usage_logs
            WHERE message_id = ?1
            "#,
            params![message_id],
            map_usage_log,
        )
        .optional()
        .map_err(error_to_string)
}

fn usage_summary_from_log(log: &UsageLogEntry) -> UsageSummary {
    UsageSummary {
        request_count: 1,
        input_tokens: log.input_tokens,
        output_tokens: log.output_tokens,
        total_tokens: log.total_tokens,
        no_cache_tokens: log.no_cache_tokens,
        cache_read_tokens: log.cache_read_tokens,
        cache_write_tokens: log.cache_write_tokens,
        reasoning_tokens: log.reasoning_tokens,
    }
}

fn prune_usage_logs(connection: &Connection) -> CommandResult<()> {
    connection
        .execute(
            r#"
            DELETE FROM usage_logs
            WHERE message_id NOT IN (
                SELECT message_id
                FROM usage_logs
                ORDER BY CAST(recorded_at AS INTEGER) DESC, CAST(created_at AS INTEGER) DESC, message_id DESC
                LIMIT ?1
            )
            "#,
            params![USAGE_LOG_LIMIT as i64],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn insert_usage_log(connection: &Connection, log: &UsageLogEntry) -> CommandResult<()> {
    connection
        .execute(
            r#"
            INSERT INTO usage_logs (
                message_id, session_id, session_title, source_type, source_name, book_name,
                created_at, recorded_at, provider, model_id, finish_reason,
                input_tokens, output_tokens, total_tokens, no_cache_tokens,
                cache_read_tokens, cache_write_tokens, reasoning_tokens
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
            ON CONFLICT(message_id) DO UPDATE SET
                session_id = excluded.session_id,
                session_title = excluded.session_title,
                source_type = excluded.source_type,
                source_name = excluded.source_name,
                book_name = excluded.book_name,
                created_at = excluded.created_at,
                recorded_at = excluded.recorded_at,
                provider = excluded.provider,
                model_id = excluded.model_id,
                finish_reason = excluded.finish_reason,
                input_tokens = excluded.input_tokens,
                output_tokens = excluded.output_tokens,
                total_tokens = excluded.total_tokens,
                no_cache_tokens = excluded.no_cache_tokens,
                cache_read_tokens = excluded.cache_read_tokens,
                cache_write_tokens = excluded.cache_write_tokens,
                reasoning_tokens = excluded.reasoning_tokens
            "#,
            params![
                log.message_id,
                log.session_id,
                log.session_title,
                log.source_type,
                log.source_name,
                log.book_name,
                log.created_at,
                log.recorded_at,
                log.provider,
                log.model_id,
                log.finish_reason,
                as_i64(log.input_tokens),
                as_i64(log.output_tokens),
                as_i64(log.total_tokens),
                as_i64(log.no_cache_tokens),
                as_i64(log.cache_read_tokens),
                as_i64(log.cache_write_tokens),
                as_i64(log.reasoning_tokens),
            ],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn upsert_usage_log_and_stats(connection: &Connection, log: &UsageLogEntry) -> CommandResult<()> {
    if let Some(previous) = read_usage_log_by_message_id(connection, &log.message_id)? {
        let previous_summary = usage_summary_from_log(&previous);
        subtract_summary_delta(connection, &previous_summary)?;
        subtract_daily_delta(connection, &previous.recorded_at, previous.total_tokens)?;
    }

    let next_summary = usage_summary_from_log(log);
    add_summary_delta(connection, &next_summary)?;
    add_daily_delta(connection, &log.recorded_at, log.total_tokens)?;
    insert_usage_log(connection, log)?;
    prune_usage_logs(connection)
}

fn build_usage_log(
    message_id: String,
    session_id: String,
    session_title: String,
    created_at: String,
    payload: &Value,
) -> Option<UsageLogEntry> {
    let meta = parse_entry_meta_value(payload);
    let usage = meta.usage?;
    let recorded_at = usage.recorded_at.unwrap_or_else(|| created_at.clone());
    Some(UsageLogEntry {
        message_id,
        session_id,
        session_title: session_title.clone(),
        source_type: "chat".to_string(),
        source_name: session_title,
        book_name: extract_book_name(meta.workspace_root_path.as_deref()),
        created_at,
        recorded_at,
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
    })
}

fn clear_usage_tables(connection: &Connection) -> CommandResult<()> {
    connection
        .execute("DELETE FROM usage_logs", [])
        .map_err(error_to_string)?;
    connection
        .execute("DELETE FROM usage_daily_stats", [])
        .map_err(error_to_string)?;
    connection
        .execute("DELETE FROM usage_summary", [])
        .map_err(error_to_string)?;
    Ok(())
}

fn backfill_usage_tables(connection: &Connection) -> CommandResult<()> {
    clear_usage_tables(connection)?;

    let rows = {
        let mut statement = connection
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
                ORDER BY e.created_at ASC, e.seq ASC
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
                    row.get::<_, String>("payload_json")?,
                ))
            })
            .map_err(error_to_string)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(error_to_string)?;
        rows
    };

    for (message_id, session_id, session_title, created_at, payload_json) in rows {
        let Ok(payload) = serde_json::from_str::<Value>(&payload_json) else {
            continue;
        };
        let Some(log) =
            build_usage_log(message_id, session_id, session_title, created_at, &payload)
        else {
            continue;
        };
        upsert_usage_log_and_stats(connection, &log)?;
    }

    connection
        .execute(
            r#"
            INSERT OR IGNORE INTO usage_summary (
                id, request_count, input_tokens, output_tokens, total_tokens,
                no_cache_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, updated_at
            )
            VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0, strftime('%s', 'now'))
            "#,
            [],
        )
        .map_err(error_to_string)?;
    Ok(())
}

pub fn ensure_usage_tables_initialized(connection: &Connection) -> CommandResult<()> {
    let exists = connection
        .query_row("SELECT id FROM usage_summary WHERE id = 1", [], |row| {
            row.get::<_, i64>(0)
        })
        .optional()
        .map_err(error_to_string)?
        .is_some();

    if exists {
        return Ok(());
    }

    backfill_usage_tables(connection)
}

pub fn record_usage_from_message_payload(
    connection: &Connection,
    message_id: String,
    session_id: String,
    session_title: String,
    created_at: String,
    payload: &Value,
) -> CommandResult<()> {
    ensure_usage_tables_initialized(connection)?;
    let Some(log) = build_usage_log(message_id, session_id, session_title, created_at, payload)
    else {
        return Ok(());
    };
    upsert_usage_log_and_stats(connection, &log)
}

#[tauri::command]
pub fn read_usage_logs(app: AppHandle) -> CommandResult<Vec<UsageLogEntry>> {
    let connection = open_database(&app)?;
    ensure_usage_tables_initialized(&connection)?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT message_id, session_id, session_title, source_type, source_name, book_name,
                   created_at, recorded_at, provider, model_id, finish_reason,
                   input_tokens, output_tokens, total_tokens, no_cache_tokens,
                   cache_read_tokens, cache_write_tokens, reasoning_tokens
            FROM usage_logs
            ORDER BY CAST(recorded_at AS INTEGER) DESC, CAST(created_at AS INTEGER) DESC, message_id DESC
            LIMIT ?1
            "#,
        )
        .map_err(error_to_string)?;

    let logs = statement
        .query_map(params![USAGE_LOG_LIMIT as i64], map_usage_log)
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;
    Ok(logs)
}

#[tauri::command]
pub fn read_usage_summary(app: AppHandle) -> CommandResult<UsageSummary> {
    let connection = open_database(&app)?;
    ensure_usage_tables_initialized(&connection)?;
    connection
        .query_row(
            r#"
            SELECT request_count, input_tokens, output_tokens, total_tokens,
                   no_cache_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens
            FROM usage_summary
            WHERE id = 1
            "#,
            [],
            |row| {
                Ok(UsageSummary {
                    request_count: read_u64(row, "request_count")?,
                    input_tokens: read_u64(row, "input_tokens")?,
                    output_tokens: read_u64(row, "output_tokens")?,
                    total_tokens: read_u64(row, "total_tokens")?,
                    no_cache_tokens: read_u64(row, "no_cache_tokens")?,
                    cache_read_tokens: read_u64(row, "cache_read_tokens")?,
                    cache_write_tokens: read_u64(row, "cache_write_tokens")?,
                    reasoning_tokens: read_u64(row, "reasoning_tokens")?,
                })
            },
        )
        .map_err(error_to_string)
}

#[tauri::command]
pub fn read_usage_daily_stats(app: AppHandle) -> CommandResult<Vec<UsageDailyStat>> {
    let connection = open_database(&app)?;
    ensure_usage_tables_initialized(&connection)?;
    let mut statement = connection
        .prepare(
            r#"
            SELECT date_key, request_count, token_total
            FROM usage_daily_stats
            WHERE request_count > 0 OR token_total > 0
            ORDER BY date_key ASC
            "#,
        )
        .map_err(error_to_string)?;

    let stats = statement
        .query_map([], |row| {
            Ok(UsageDailyStat {
                date_key: row.get("date_key")?,
                request_count: read_u64(row, "request_count")?,
                token_total: read_u64(row, "token_total")?,
            })
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;
    Ok(stats)
}
