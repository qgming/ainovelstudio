use crate::domains::usage::commands::record_usage_from_message_payload;
use crate::infrastructure::db::open_database;
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use uuid::Uuid;

type CommandResult<T> = Result<T, String>;

const ACTIVE_SESSION_KEY: &str = "chat.active_session_id";
const DRAFT_KEY_PREFIX: &str = "chat.draft.";
const SKILLS_PREFERENCES_KEY: &str = "skills.preferences";
const AGENT_SETTINGS_KEY: &str = "agent.settings";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionSummary {
    book_id: String,
    id: String,
    title: String,
    summary: String,
    status: String,
    created_at: String,
    updated_at: String,
    last_message_at: Option<String>,
    pinned: bool,
    archived: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEntryDocument {
    id: String,
    seq: i64,
    entry_type: String,
    payload: Value,
    created_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatBootstrap {
    book_id: String,
    sessions: Vec<ChatSessionSummary>,
    active_session_id: Option<String>,
    active_session_entries: Vec<ChatEntryDocument>,
    active_session_draft: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEntryInput {
    #[serde(default)]
    id: Option<String>,
    entry_type: String,
    payload: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionPatch {
    title: Option<String>,
    summary: Option<String>,
    status: Option<String>,
    updated_at: Option<String>,
    last_message_at: Option<Option<String>>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TogglePreferences {
    enabled_by_id: std::collections::HashMap<String, bool>,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderConfig {
    #[serde(default)]
    api_key: String,
    #[serde(default, rename = "baseURL")]
    base_url: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    simulate_opencode_beta: bool,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderPreset {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    provider: String,
    #[serde(default, rename = "baseURL")]
    base_url: String,
    #[serde(default)]
    website_url: Option<String>,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelConfigPreset {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    config: AgentProviderConfig,
    #[serde(default)]
    created_at: String,
    #[serde(default)]
    updated_at: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSettingsDocument {
    #[serde(default)]
    config: AgentProviderConfig,
    #[serde(default)]
    enabled_tools: std::collections::HashMap<String, bool>,
    #[serde(default)]
    provider_presets: Vec<AgentProviderPreset>,
    #[serde(default)]
    model_config_presets: Vec<AgentModelConfigPreset>,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn now_iso() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn normalize_session_title(value: Option<String>) -> String {
    let trimmed = value.unwrap_or_default().trim().to_string();
    if trimmed.is_empty() {
        "新对话".into()
    } else {
        trimmed
    }
}

fn draft_key(session_id: &str) -> String {
    format!("{DRAFT_KEY_PREFIX}{session_id}")
}

fn active_session_key(book_id: &str) -> String {
    format!("{ACTIVE_SESSION_KEY}.{book_id}")
}

fn parse_json(raw: &str, fallback: Value) -> Value {
    serde_json::from_str(raw).unwrap_or(fallback)
}

fn parse_preferences(value: Option<Value>) -> TogglePreferences {
    value
        .and_then(|raw| serde_json::from_value::<TogglePreferences>(raw).ok())
        .unwrap_or_default()
}

fn parse_agent_settings(value: Option<Value>) -> Option<AgentSettingsDocument> {
    value.and_then(|raw| serde_json::from_value::<AgentSettingsDocument>(raw).ok())
}

fn row_to_session(row: &Row<'_>) -> rusqlite::Result<ChatSessionSummary> {
    Ok(ChatSessionSummary {
        book_id: row.get("book_id")?,
        id: row.get("id")?,
        title: row.get("title")?,
        summary: row.get("summary")?,
        status: row.get("status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        last_message_at: row.get("last_message_at")?,
        pinned: row.get::<_, i64>("pinned")? != 0,
        archived: row.get::<_, i64>("archived")? != 0,
    })
}

fn load_sessions(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> CommandResult<Vec<ChatSessionSummary>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT book_id, id, title, summary, status, created_at, updated_at, last_message_at, pinned, archived
            FROM chat_sessions
            WHERE archived = 0 AND book_id = ?1
            ORDER BY updated_at DESC, created_at DESC
            "#,
        )
        .map_err(error_to_string)?;

    let sessions = statement
        .query_map(params![book_id], row_to_session)
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(sessions)
}

fn read_session(
    connection: &rusqlite::Connection,
    session_id: &str,
    book_id: &str,
) -> CommandResult<ChatSessionSummary> {
    connection
        .query_row(
            r#"
            SELECT book_id, id, title, summary, status, created_at, updated_at, last_message_at, pinned, archived
            FROM chat_sessions
            WHERE id = ?1 AND book_id = ?2
            "#,
            params![session_id, book_id],
            row_to_session,
        )
        .map_err(error_to_string)
}

fn load_entries(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> CommandResult<Vec<ChatEntryDocument>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, seq, entry_type, payload_json, created_at
            FROM chat_entries
            WHERE session_id = ?1
            ORDER BY seq ASC
            "#,
        )
        .map_err(error_to_string)?;

    let entries = statement
        .query_map(params![session_id], |row| {
            let payload_json: String = row.get("payload_json")?;
            Ok(ChatEntryDocument {
                id: row.get("id")?,
                seq: row.get("seq")?,
                entry_type: row.get("entry_type")?,
                payload: parse_json(&payload_json, Value::Null),
                created_at: row.get("created_at")?,
            })
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(entries)
}

fn get_state_value(connection: &rusqlite::Connection, key: &str) -> CommandResult<Option<Value>> {
    let raw = connection
        .query_row(
            "SELECT value_json FROM app_state WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?;

    Ok(raw.and_then(|value| serde_json::from_str::<Value>(&value).ok()))
}

fn set_state_value(
    connection: &rusqlite::Connection,
    key: &str,
    value: &Value,
) -> CommandResult<()> {
    connection
        .execute(
            r#"
            INSERT INTO app_state (key, value_json, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE
            SET value_json = excluded.value_json,
                updated_at = excluded.updated_at
            "#,
            params![key, value.to_string(), now_iso()],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn delete_state_value(connection: &rusqlite::Connection, key: &str) -> CommandResult<()> {
    connection
        .execute("DELETE FROM app_state WHERE key = ?1", params![key])
        .map_err(error_to_string)?;
    Ok(())
}

fn create_session(connection: &rusqlite::Connection, book_id: &str) -> CommandResult<String> {
    let session_id = Uuid::new_v4().to_string();
    let now = now_iso();
    connection
        .execute(
            r#"
            INSERT INTO chat_sessions (book_id, id, title, summary, status, created_at, updated_at, last_message_at, pinned, archived)
            VALUES (?1, ?2, ?3, '', 'idle', ?4, ?4, NULL, 0, 0)
            "#,
            params![book_id, session_id, "新对话", now],
        )
        .map_err(error_to_string)?;
    Ok(session_id)
}

fn ensure_active_session(
    connection: &rusqlite::Connection,
    book_id: &str,
) -> CommandResult<String> {
    let sessions = load_sessions(connection, book_id)?;
    if sessions.is_empty() {
        let session_id = create_session(connection, book_id)?;
        set_state_value(
            connection,
            &active_session_key(book_id),
            &Value::String(session_id.clone()),
        )?;
        return Ok(session_id);
    }

    if let Some(Value::String(session_id)) =
        get_state_value(connection, &active_session_key(book_id))?
    {
        if sessions.iter().any(|session| session.id == session_id) {
            return Ok(session_id);
        }
    }

    let session_id = sessions[0].id.clone();
    set_state_value(
        connection,
        &active_session_key(book_id),
        &Value::String(session_id.clone()),
    )?;
    Ok(session_id)
}

fn build_bootstrap(
    connection: &rusqlite::Connection,
    book_id: &str,
    session_id: String,
) -> CommandResult<ChatBootstrap> {
    let draft = get_state_value(connection, &draft_key(&session_id))?
        .and_then(|value| value.as_str().map(ToString::to_string))
        .unwrap_or_default();

    Ok(ChatBootstrap {
        book_id: book_id.to_string(),
        sessions: load_sessions(connection, book_id)?,
        active_session_id: Some(session_id.clone()),
        active_session_entries: load_entries(connection, &session_id)?,
        active_session_draft: draft,
    })
}

fn apply_patch(
    connection: &rusqlite::Connection,
    session_id: &str,
    book_id: &str,
    patch: Option<ChatSessionPatch>,
) -> CommandResult<ChatSessionSummary> {
    let current = read_session(connection, session_id, book_id)?;
    if let Some(patch) = patch {
        let title = normalize_session_title(patch.title.or(Some(current.title.clone())));
        let summary = patch.summary.unwrap_or(current.summary.clone());
        let status = patch.status.unwrap_or(current.status.clone());
        let updated_at = patch.updated_at.unwrap_or_else(now_iso);
        let last_message_at = patch
            .last_message_at
            .unwrap_or(current.last_message_at.clone());

        connection
            .execute(
                r#"
                UPDATE chat_sessions
                SET title = ?2,
                    summary = ?3,
                    status = ?4,
                    updated_at = ?5,
                    last_message_at = ?6
                WHERE id = ?1
                "#,
                params![
                    session_id,
                    title,
                    summary,
                    status,
                    updated_at,
                    last_message_at
                ],
            )
            .map_err(error_to_string)?;
    }

    read_session(connection, session_id, book_id)
}

fn next_entry_seq(connection: &rusqlite::Connection, session_id: &str) -> CommandResult<i64> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM chat_entries WHERE session_id = ?1",
            params![session_id],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error_to_string)
}

#[tauri::command]
pub fn read_skill_preferences(app: AppHandle) -> CommandResult<TogglePreferences> {
    let connection = open_database(&app)?;
    Ok(parse_preferences(get_state_value(
        &connection,
        SKILLS_PREFERENCES_KEY,
    )?))
}

#[tauri::command]
pub fn write_skill_preferences(
    app: AppHandle,
    preferences: TogglePreferences,
) -> CommandResult<TogglePreferences> {
    let connection = open_database(&app)?;
    let value = serde_json::to_value(&preferences).map_err(error_to_string)?;
    set_state_value(&connection, SKILLS_PREFERENCES_KEY, &value)?;
    Ok(preferences)
}

#[tauri::command]
pub fn clear_skill_preferences(app: AppHandle) -> CommandResult<()> {
    let connection = open_database(&app)?;
    delete_state_value(&connection, SKILLS_PREFERENCES_KEY)
}

#[tauri::command]
pub fn read_agent_settings(app: AppHandle) -> CommandResult<Option<AgentSettingsDocument>> {
    let connection = open_database(&app)?;
    Ok(parse_agent_settings(get_state_value(
        &connection,
        AGENT_SETTINGS_KEY,
    )?))
}

#[tauri::command]
pub fn write_agent_settings(
    app: AppHandle,
    settings: AgentSettingsDocument,
) -> CommandResult<AgentSettingsDocument> {
    let connection = open_database(&app)?;
    let value = serde_json::to_value(&settings).map_err(error_to_string)?;
    set_state_value(&connection, AGENT_SETTINGS_KEY, &value)?;
    Ok(settings)
}

#[tauri::command]
pub fn clear_agent_settings(app: AppHandle) -> CommandResult<()> {
    let connection = open_database(&app)?;
    delete_state_value(&connection, AGENT_SETTINGS_KEY)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn initialize_chat_storage(app: AppHandle, bookId: String) -> CommandResult<ChatBootstrap> {
    let connection = open_database(&app)?;
    let session_id = ensure_active_session(&connection, &bookId)?;
    build_bootstrap(&connection, &bookId, session_id)
}
#[tauri::command]
#[allow(non_snake_case)]
pub fn create_chat_session(app: AppHandle, bookId: String) -> CommandResult<ChatBootstrap> {
    let connection = open_database(&app)?;
    let session_id = create_session(&connection, &bookId)?;
    set_state_value(
        &connection,
        &active_session_key(&bookId),
        &Value::String(session_id.clone()),
    )?;
    build_bootstrap(&connection, &bookId, session_id)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn switch_chat_session(
    app: AppHandle,
    bookId: String,
    sessionId: String,
) -> CommandResult<ChatBootstrap> {
    let connection = open_database(&app)?;
    read_session(&connection, &sessionId, &bookId)?;
    set_state_value(
        &connection,
        &active_session_key(&bookId),
        &Value::String(sessionId.clone()),
    )?;
    build_bootstrap(&connection, &bookId, sessionId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_chat_session(
    app: AppHandle,
    bookId: String,
    sessionId: String,
) -> CommandResult<ChatBootstrap> {
    let connection = open_database(&app)?;
    read_session(&connection, &sessionId, &bookId)?;
    connection
        .execute(
            "DELETE FROM chat_sessions WHERE id = ?1",
            params![sessionId.clone()],
        )
        .map_err(error_to_string)?;
    delete_state_value(&connection, &draft_key(&sessionId))?;
    let next_session_id = ensure_active_session(&connection, &bookId)?;
    build_bootstrap(&connection, &bookId, next_session_id)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn rename_chat_session(
    app: AppHandle,
    bookId: String,
    sessionId: String,
    title: String,
) -> CommandResult<ChatSessionSummary> {
    let connection = open_database(&app)?;
    apply_patch(
        &connection,
        &sessionId,
        &bookId,
        Some(ChatSessionPatch {
            title: Some(title),
            summary: None,
            status: None,
            updated_at: None,
            last_message_at: None,
        }),
    )
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn set_chat_draft(app: AppHandle, sessionId: String, draft: String) -> CommandResult<()> {
    let connection = open_database(&app)?;
    let book_id = connection
        .query_row(
            "SELECT book_id FROM chat_sessions WHERE id = ?1",
            params![sessionId.clone()],
            |row| row.get::<_, String>(0),
        )
        .map_err(error_to_string)?;
    read_session(&connection, &sessionId, &book_id)?;
    set_state_value(&connection, &draft_key(&sessionId), &Value::String(draft))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn load_chat_entries(
    app: AppHandle,
    bookId: String,
    sessionId: String,
) -> CommandResult<Vec<ChatEntryDocument>> {
    let connection = open_database(&app)?;
    read_session(&connection, &sessionId, &bookId)?;
    load_entries(&connection, &sessionId)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn append_chat_entry(
    app: AppHandle,
    bookId: String,
    sessionId: String,
    entry: ChatEntryInput,
    sessionPatch: Option<ChatSessionPatch>,
) -> CommandResult<ChatSessionSummary> {
    let connection = open_database(&app)?;
    let seq = next_entry_seq(&connection, &sessionId)?;
    let book_id = read_session(&connection, &sessionId, &bookId)?.book_id;
    let entry_id = entry.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let payload = entry.payload;
    let created_at = now_iso();
    connection
        .execute(
            r#"
            INSERT INTO chat_entries (id, session_id, seq, entry_type, payload_json, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            "#,
            params![
                entry_id.clone(),
                sessionId.clone(),
                seq,
                entry.entry_type,
                payload.to_string(),
                created_at.clone()
            ],
        )
        .map_err(error_to_string)?;
    let summary = apply_patch(&connection, &sessionId, &book_id, sessionPatch)?;
    record_usage_from_message_payload(
        &connection,
        entry_id,
        sessionId,
        summary.title.clone(),
        created_at,
        &payload,
    )?;
    Ok(summary)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn update_chat_entry(
    app: AppHandle,
    bookId: String,
    sessionId: String,
    entryId: String,
    payload: Value,
    sessionPatch: Option<ChatSessionPatch>,
) -> CommandResult<ChatSessionSummary> {
    let connection = open_database(&app)?;
    let book_id = read_session(&connection, &sessionId, &bookId)?.book_id;
    let created_at = connection
        .query_row(
            "SELECT created_at FROM chat_entries WHERE session_id = ?1 AND id = ?2",
            params![sessionId.clone(), entryId.clone()],
            |row| row.get::<_, String>(0),
        )
        .map_err(error_to_string)?;
    connection
        .execute(
            r#"
            UPDATE chat_entries
            SET payload_json = ?3
            WHERE session_id = ?1 AND id = ?2
            "#,
            params![sessionId.clone(), entryId.clone(), payload.to_string()],
        )
        .map_err(error_to_string)?;
    let summary = apply_patch(&connection, &sessionId, &book_id, sessionPatch)?;
    record_usage_from_message_payload(
        &connection,
        entryId,
        sessionId,
        summary.title.clone(),
        created_at,
        &payload,
    )?;
    Ok(summary)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_chat_entry(
    app: AppHandle,
    bookId: String,
    sessionId: String,
    entryId: String,
    sessionPatch: Option<ChatSessionPatch>,
) -> CommandResult<ChatSessionSummary> {
    let connection = open_database(&app)?;
    let book_id = read_session(&connection, &sessionId, &bookId)?.book_id;
    connection
        .execute(
            "DELETE FROM chat_entries WHERE session_id = ?1 AND id = ?2",
            params![sessionId.clone(), entryId],
        )
        .map_err(error_to_string)?;
    apply_patch(&connection, &sessionId, &book_id, sessionPatch)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn append_compaction_entry(
    app: AppHandle,
    bookId: String,
    sessionId: String,
    summary: String,
    tokensBefore: i64,
    firstKeptMessageId: Option<String>,
    sessionPatch: Option<ChatSessionPatch>,
) -> CommandResult<ChatSessionSummary> {
    append_chat_entry(
        app,
        bookId,
        sessionId,
        ChatEntryInput {
            id: None,
            entry_type: "compaction".into(),
            payload: serde_json::json!({
                "summary": summary,
                "tokensBefore": tokensBefore,
                "firstKeptMessageId": firstKeptMessageId,
            }),
        },
        sessionPatch,
    )
}
