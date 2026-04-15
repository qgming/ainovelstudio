use crate::db::open_database;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::AppHandle;

type CommandResult<T> = Result<T, String>;

const DEFAULT_AGENT_CONFIG_KEY: &str = "default-agent";
const DEFAULT_AGENT_TEMPLATE: &str = include_str!("../resources/config/AGENTS.md");
const DEFAULT_AGENT_CONFIG_PATH: &str = "sqlite://config/AGENTS.md";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultAgentConfigDocument {
    initialized_from_builtin: bool,
    markdown: String,
    path: String,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn normalize_markdown(content: &str) -> String {
    content.replace("\r\n", "\n")
}

fn current_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn build_document(markdown: String, initialized_from_builtin: bool) -> DefaultAgentConfigDocument {
    DefaultAgentConfigDocument {
        initialized_from_builtin,
        markdown,
        path: DEFAULT_AGENT_CONFIG_PATH.into(),
    }
}

fn ensure_default_agent_document(app: &AppHandle) -> CommandResult<DefaultAgentConfigDocument> {
    let connection = open_database(app)?;
    let existing = connection
        .query_row(
            "SELECT markdown, initialized_from_builtin FROM config_documents WHERE key = ?1",
            params![DEFAULT_AGENT_CONFIG_KEY],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? != 0)),
        )
        .optional()
        .map_err(error_to_string)?;

    if let Some((markdown, initialized_from_builtin)) = existing {
        return Ok(build_document(
            normalize_markdown(&markdown),
            initialized_from_builtin,
        ));
    }

    let markdown = normalize_markdown(DEFAULT_AGENT_TEMPLATE);
    connection
        .execute(
            r#"
            INSERT INTO config_documents (key, markdown, initialized_from_builtin, updated_at)
            VALUES (?1, ?2, 1, ?3)
            "#,
            params![DEFAULT_AGENT_CONFIG_KEY, markdown, current_timestamp()],
        )
        .map_err(error_to_string)?;

    Ok(build_document(
        normalize_markdown(DEFAULT_AGENT_TEMPLATE),
        true,
    ))
}

#[tauri::command]
pub fn initialize_default_agent_config(
    app: AppHandle,
) -> CommandResult<DefaultAgentConfigDocument> {
    ensure_default_agent_document(&app)
}

#[tauri::command]
pub fn read_default_agent_config(app: AppHandle) -> CommandResult<DefaultAgentConfigDocument> {
    ensure_default_agent_document(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_default_agent_config(
    app: AppHandle,
    content: String,
) -> CommandResult<DefaultAgentConfigDocument> {
    let connection = open_database(&app)?;
    let markdown = normalize_markdown(&content);
    connection
        .execute(
            r#"
            INSERT INTO config_documents (key, markdown, initialized_from_builtin, updated_at)
            VALUES (?1, ?2, 0, ?3)
            ON CONFLICT(key) DO UPDATE
            SET markdown = excluded.markdown,
                initialized_from_builtin = 0,
                updated_at = excluded.updated_at
            "#,
            params![DEFAULT_AGENT_CONFIG_KEY, markdown, current_timestamp()],
        )
        .map_err(error_to_string)?;

    Ok(build_document(markdown, false))
}
