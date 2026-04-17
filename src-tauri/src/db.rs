use crate::{workflows::run_workflow_migrations, workspace_db::run_workspace_migrations};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

type CommandResult<T> = Result<T, String>;
const ACTIVE_SESSION_KEY_PREFIX: &str = "chat.active_session_id.";

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

#[derive(Clone)]
struct RegistryEntry {
    created_at: String,
    id: String,
    root_path: String,
}

fn normalize_registry_root_path(value: &str) -> String {
    let normalized = value.replace('\\', "/");
    if let Some(path) = normalized.strip_prefix("//?/UNC/") {
        return format!("//{}", path);
    }
    if let Some(path) = normalized.strip_prefix("//?/") {
        return path.to_string();
    }
    normalized
}

fn is_exact_registry_path(value: &str) -> bool {
    normalize_registry_root_path(value) == value.replace('\\', "/")
}

fn should_replace_registry_canonical(current: &RegistryEntry, candidate: &RegistryEntry) -> bool {
    let current_exact = is_exact_registry_path(&current.root_path);
    let candidate_exact = is_exact_registry_path(&candidate.root_path);
    if current_exact != candidate_exact {
        return candidate_exact;
    }
    if current.created_at != candidate.created_at {
        return candidate.created_at < current.created_at;
    }
    candidate.id < current.id
}

fn active_session_state_key(book_id: &str) -> String {
    format!("{ACTIVE_SESSION_KEY_PREFIX}{book_id}")
}

fn migrate_active_session_state_key(
    connection: &Connection,
    previous_book_id: &str,
    next_book_id: &str,
) -> CommandResult<()> {
    if previous_book_id == next_book_id {
        return Ok(());
    }

    let previous_key = active_session_state_key(previous_book_id);
    let next_key = active_session_state_key(next_book_id);
    let state = connection
        .query_row(
            "SELECT value_json, updated_at FROM app_state WHERE key = ?1",
            params![previous_key],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(error_to_string)?;

    let Some((value_json, updated_at)) = state else {
        return Ok(());
    };

    let next_exists = connection
        .query_row(
            "SELECT key FROM app_state WHERE key = ?1",
            params![next_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?
        .is_some();

    if !next_exists {
        connection
            .execute(
                "INSERT INTO app_state (key, value_json, updated_at) VALUES (?1, ?2, ?3)",
                params![next_key, value_json, updated_at],
            )
            .map_err(error_to_string)?;
    }

    connection
        .execute(
            "DELETE FROM app_state WHERE key = ?1",
            params![previous_key],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn cleanup_book_workspace_registry(connection: &Connection) -> CommandResult<()> {
    let mut statement = connection
        .prepare(
            "SELECT id, root_path, created_at FROM book_workspace_registry ORDER BY created_at ASC, id ASC",
        )
        .map_err(error_to_string)?;
    let entries = statement
        .query_map([], |row| {
            Ok(RegistryEntry {
                id: row.get::<_, String>(0)?,
                root_path: row.get::<_, String>(1)?,
                created_at: row.get::<_, String>(2)?,
            })
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    if entries.is_empty() {
        return Ok(());
    }

    let mut entries_by_path = HashMap::<String, Vec<RegistryEntry>>::new();
    for entry in entries {
        entries_by_path
            .entry(normalize_registry_root_path(&entry.root_path))
            .or_default()
            .push(entry);
    }

    for (normalized_root_path, grouped_entries) in entries_by_path {
        let mut canonical = grouped_entries[0].clone();
        for entry in grouped_entries.iter().skip(1) {
            if should_replace_registry_canonical(&canonical, entry) {
                canonical = entry.clone();
            }
        }

        if canonical.root_path != normalized_root_path {
            connection
                .execute(
                    "UPDATE book_workspace_registry SET root_path = ?1 WHERE id = ?2",
                    params![normalized_root_path, canonical.id],
                )
                .map_err(error_to_string)?;
        }

        for entry in grouped_entries {
            if entry.id == canonical.id {
                continue;
            }

            connection
                .execute(
                    "UPDATE chat_sessions SET book_id = ?1 WHERE book_id = ?2",
                    params![canonical.id, entry.id],
                )
                .map_err(error_to_string)?;
            migrate_active_session_state_key(connection, &entry.id, &canonical.id)?;
            connection
                .execute(
                    "DELETE FROM book_workspace_registry WHERE id = ?1",
                    params![entry.id],
                )
                .map_err(error_to_string)?;
        }
    }

    Ok(())
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

            CREATE TABLE IF NOT EXISTS book_workspace_registry (
                id TEXT PRIMARY KEY,
                root_path TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            );
            "#,
        )
        .map_err(error_to_string)?;

    ensure_chat_sessions_book_id_column(connection)?;
    cleanup_book_workspace_registry(connection)?;
    run_workspace_migrations(connection)?;
    run_workflow_migrations(connection)?;

    connection
        .execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_chat_sessions_book_id_updated_at
            ON chat_sessions(book_id, updated_at DESC);
            "#,
        )
        .map_err(error_to_string)?;

    Ok(())
}

fn ensure_chat_sessions_book_id_column(connection: &Connection) -> CommandResult<()> {
    let mut statement = connection
        .prepare("PRAGMA table_info(chat_sessions)")
        .map_err(error_to_string)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    if columns.iter().any(|column| column == "book_id") {
        return Ok(());
    }

    connection
        .execute(
            "ALTER TABLE chat_sessions ADD COLUMN book_id TEXT NOT NULL DEFAULT ''",
            [],
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
