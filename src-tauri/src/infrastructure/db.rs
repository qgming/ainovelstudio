use rusqlite::Connection;
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

type CommandResult<T> = Result<T, String>;
const SQLITE_BUSY_TIMEOUT_MS: u64 = 5000;

static MIGRATED_DATABASES: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

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

            CREATE TABLE IF NOT EXISTS chat_entries (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                seq INTEGER NOT NULL,
                entry_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_entries_session_seq
            ON chat_entries(session_id, seq);

            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS config_documents (
                key TEXT PRIMARY KEY,
                markdown TEXT NOT NULL,
                initialized_from_builtin INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS usage_logs (
                message_id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                session_title TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_name TEXT NOT NULL,
                book_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                recorded_at TEXT NOT NULL,
                provider TEXT NOT NULL,
                model_id TEXT NOT NULL,
                finish_reason TEXT NOT NULL,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                no_cache_tokens INTEGER NOT NULL DEFAULT 0,
                cache_read_tokens INTEGER NOT NULL DEFAULT 0,
                cache_write_tokens INTEGER NOT NULL DEFAULT 0,
                reasoning_tokens INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_usage_logs_recorded_at
            ON usage_logs(CAST(recorded_at AS INTEGER) DESC, CAST(created_at AS INTEGER) DESC);

            DROP TABLE IF EXISTS usage_summary;
            DROP TABLE IF EXISTS usage_daily_stats;

            CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
                date TEXT PRIMARY KEY,
                version TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS leaderboard_snapshot_entries (
                snapshot_date TEXT NOT NULL,
                version TEXT NOT NULL,
                gender INTEGER NOT NULL,
                rank_type INTEGER NOT NULL,
                category_id INTEGER NOT NULL,
                books_json TEXT NOT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (snapshot_date, version, gender, rank_type, category_id),
                FOREIGN KEY(snapshot_date) REFERENCES leaderboard_snapshots(date) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshot_entries_lookup
            ON leaderboard_snapshot_entries(snapshot_date, version, gender, rank_type, category_id);
            "#,
        )
        .map_err(error_to_string)?;

    ensure_chat_sessions_book_id_column(connection)?;

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
    let connection = Connection::open(&db_path).map_err(error_to_string)?;
    connection
        .busy_timeout(Duration::from_millis(SQLITE_BUSY_TIMEOUT_MS))
        .map_err(error_to_string)?;
    run_migrations_once(&connection, db_path)?;
    Ok(connection)
}

fn run_migrations_once(connection: &Connection, db_path: PathBuf) -> CommandResult<()> {
    let migrated = MIGRATED_DATABASES.get_or_init(|| Mutex::new(HashSet::new()));
    let mut migrated_paths = migrated
        .lock()
        .map_err(|_| "数据库迁移状态访问失败。".to_string())?;
    if migrated_paths.contains(&db_path) {
        return Ok(());
    }

    run_migrations(connection)?;
    migrated_paths.insert(db_path);
    Ok(())
}
