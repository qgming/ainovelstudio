use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

type CommandResult<T> = Result<T, String>;

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn ensure_database_directory(app: &AppHandle) -> CommandResult<PathBuf> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(error_to_string)?
        .join("data");
    fs::create_dir_all(&root).map_err(error_to_string)?;
    Ok(root)
}

fn run_migrations(connection: &Connection) -> CommandResult<()> {
    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS chat_sessions (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL DEFAULT '',
                summary TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'idle',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_message_at TEXT,
                pinned INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at
            ON chat_sessions(updated_at DESC);

            CREATE TABLE IF NOT EXISTS chat_messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                role TEXT NOT NULL,
                author TEXT NOT NULL,
                parts_json TEXT NOT NULL,
                meta_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_session_seq
            ON chat_messages(session_id, seq);

            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS skill_packages (
                id TEXT PRIMARY KEY,
                source_kind TEXT NOT NULL,
                is_builtin INTEGER NOT NULL DEFAULT 0,
                manifest_json TEXT NOT NULL,
                files_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS agent_packages (
                id TEXT PRIMARY KEY,
                source_kind TEXT NOT NULL,
                is_builtin INTEGER NOT NULL DEFAULT 0,
                manifest_json TEXT NOT NULL,
                files_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS config_documents (
                key TEXT PRIMARY KEY,
                markdown TEXT NOT NULL,
                initialized_from_builtin INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            "#,
        )
        .map_err(error_to_string)?;

    Ok(())
}

pub fn open_database(app: &AppHandle) -> CommandResult<Connection> {
    let db_path = ensure_database_directory(app)?.join("app.db");
    let connection = Connection::open(db_path).map_err(error_to_string)?;
    run_migrations(&connection)?;
    Ok(connection)
}
