use crate::db::open_database;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Read, Write},
    path::PathBuf,
};
use tauri::{AppHandle, Manager};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

pub type CommandResult<T> = Result<T, String>;

const ARCHIVE_DB_FILE: &str = "app.db";
const ARCHIVE_MANIFEST_FILE: &str = "manifest.json";
const ARCHIVE_CLIENT_STATE_FILE: &str = "client-state.json";
const ARCHIVE_SCHEMA_VERSION: u32 = 1;
const MAX_ARCHIVE_ENTRIES: usize = 8;
const MAX_ARCHIVE_TOTAL_SIZE: usize = 512 * 1024 * 1024;

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientStateSnapshot {
    #[serde(default)]
    pub entries: HashMap<String, String>,
    #[serde(default)]
    pub updated_at: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub schema_version: u32,
    pub exported_at: u64,
    pub database_updated_at: u64,
    pub client_state_updated_at: u64,
    pub composite_updated_at: u64,
}

pub struct BackupBundle {
    pub bytes: Vec<u8>,
    pub manifest: BackupManifest,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRestoreResult {
    pub client_state: ClientStateSnapshot,
    pub restored_at: u64,
}

#[derive(Clone)]
pub struct BackupArchivePreview {
    pub manifest: BackupManifest,
}

struct ParsedBackupArchive {
    client_state: ClientStateSnapshot,
    database_bytes: Vec<u8>,
    manifest: BackupManifest,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn app_data_directory(app: &AppHandle) -> CommandResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(error_to_string)?
        .join("data");
    fs::create_dir_all(&directory).map_err(error_to_string)?;
    Ok(directory)
}

fn database_file_path(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(app_data_directory(app)?.join("app.db"))
}

fn normalize_client_state(snapshot: ClientStateSnapshot) -> ClientStateSnapshot {
    let entries = snapshot
        .entries
        .into_iter()
        .filter(|(key, _)| !key.trim().is_empty())
        .collect::<HashMap<_, _>>();
    ClientStateSnapshot {
        entries,
        updated_at: snapshot.updated_at,
    }
}

fn checkpoint_database(connection: &Connection) -> CommandResult<()> {
    connection
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(error_to_string)?;
    Ok(())
}

fn query_max_timestamp(connection: &Connection, sql: &str) -> CommandResult<u64> {
    let value = connection
        .query_row(sql, [], |row| row.get::<_, Option<i64>>(0))
        .map_err(error_to_string)?;
    Ok(value.unwrap_or(0).max(0) as u64)
}

fn read_database_updated_at(connection: &Connection) -> CommandResult<u64> {
    let queries = [
        "SELECT MAX(CAST(updated_at AS INTEGER)) FROM app_state",
        "SELECT MAX(updated_at) FROM config_documents",
        "SELECT MAX(updated_at) FROM skill_packages",
        "SELECT MAX(updated_at) FROM agent_packages",
        "SELECT MAX(CAST(updated_at AS INTEGER)) FROM chat_sessions",
        "SELECT MAX(updated_at) FROM book_workspaces",
        "SELECT MAX(updated_at) FROM book_workspace_entries",
        "SELECT MAX(updated_at) FROM workflow_packages",
        "SELECT MAX(updated_at) FROM workflows",
        "SELECT MAX(updated_at) FROM workflow_team_members",
        "SELECT MAX(updated_at) FROM workflow_steps",
        "SELECT MAX(COALESCE(finished_at, started_at)) FROM workflow_runs",
        "SELECT MAX(COALESCE(finished_at, started_at)) FROM workflow_step_runs",
    ];
    let mut latest = 0_u64;
    for query in queries {
        latest = latest.max(query_max_timestamp(connection, query)?);
    }
    Ok(latest)
}

fn build_manifest(database_updated_at: u64, client_state_updated_at: u64) -> BackupManifest {
    let exported_at = current_timestamp();
    BackupManifest {
        schema_version: ARCHIVE_SCHEMA_VERSION,
        exported_at,
        database_updated_at,
        client_state_updated_at,
        composite_updated_at: database_updated_at.max(client_state_updated_at),
    }
}

fn serialize_json<T: Serialize>(value: &T) -> CommandResult<Vec<u8>> {
    serde_json::to_vec_pretty(value).map_err(error_to_string)
}

fn build_archive_bytes(
    manifest: &BackupManifest,
    client_state: &ClientStateSnapshot,
    database_bytes: &[u8],
) -> CommandResult<Vec<u8>> {
    let cursor = Cursor::new(Vec::<u8>::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    for (name, contents) in [
        (ARCHIVE_MANIFEST_FILE, serialize_json(manifest)?),
        (ARCHIVE_CLIENT_STATE_FILE, serialize_json(client_state)?),
        (ARCHIVE_DB_FILE, database_bytes.to_vec()),
    ] {
        writer.start_file(name, options).map_err(error_to_string)?;
        writer.write_all(&contents).map_err(error_to_string)?;
    }

    writer
        .finish()
        .map_err(error_to_string)
        .map(|finished| finished.into_inner())
}

fn read_archive_entry(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
) -> CommandResult<Vec<u8>> {
    let mut entry = archive.by_name(name).map_err(error_to_string)?;
    let mut contents = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut contents).map_err(error_to_string)?;
    Ok(contents)
}

fn parse_archive(archive_bytes: &[u8]) -> CommandResult<ParsedBackupArchive> {
    if archive_bytes.is_empty() {
        return Err("备份文件为空。".into());
    }

    let mut archive = ZipArchive::new(Cursor::new(archive_bytes)).map_err(error_to_string)?;
    if archive.len() == 0 || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("备份文件结构不合法。".into());
    }

    let manifest_bytes = read_archive_entry(&mut archive, ARCHIVE_MANIFEST_FILE)?;
    let client_state_bytes = read_archive_entry(&mut archive, ARCHIVE_CLIENT_STATE_FILE)?;
    let database_bytes = read_archive_entry(&mut archive, ARCHIVE_DB_FILE)?;

    if manifest_bytes.len() + client_state_bytes.len() + database_bytes.len()
        > MAX_ARCHIVE_TOTAL_SIZE
    {
        return Err("备份文件过大。".into());
    }

    let manifest =
        serde_json::from_slice::<BackupManifest>(&manifest_bytes).map_err(error_to_string)?;
    if manifest.schema_version != ARCHIVE_SCHEMA_VERSION {
        return Err("备份版本不受支持。".into());
    }

    let client_state = serde_json::from_slice::<ClientStateSnapshot>(&client_state_bytes)
        .map_err(error_to_string)?;

    Ok(ParsedBackupArchive {
        client_state: normalize_client_state(client_state),
        database_bytes,
        manifest,
    })
}

fn replace_database_file(app: &AppHandle, database_bytes: &[u8]) -> CommandResult<()> {
    let db_path = database_file_path(app)?;
    let temp_path = db_path.with_extension("restore");
    fs::write(&temp_path, database_bytes).map_err(error_to_string)?;
    Connection::open(&temp_path).map_err(error_to_string)?;

    for sidecar in ["app.db-wal", "app.db-shm"] {
        let path = app_data_directory(app)?.join(sidecar);
        let _ = fs::remove_file(path);
    }

    if db_path.exists() {
        fs::remove_file(&db_path).map_err(error_to_string)?;
    }

    match fs::rename(&temp_path, &db_path) {
        Ok(_) => Ok(()),
        Err(_) => {
            fs::write(&db_path, database_bytes).map_err(error_to_string)?;
            let _ = fs::remove_file(&temp_path);
            Ok(())
        }
    }
}

pub fn build_backup_bundle(
    app: &AppHandle,
    client_state: ClientStateSnapshot,
) -> CommandResult<BackupBundle> {
    let normalized_client_state = normalize_client_state(client_state);
    let connection = open_database(app)?;
    checkpoint_database(&connection)?;
    let database_updated_at = read_database_updated_at(&connection)?;
    drop(connection);

    let database_bytes = fs::read(database_file_path(app)?).map_err(error_to_string)?;
    let manifest = build_manifest(database_updated_at, normalized_client_state.updated_at);
    let bytes = build_archive_bytes(&manifest, &normalized_client_state, &database_bytes)?;

    Ok(BackupBundle { bytes, manifest })
}

pub fn inspect_backup_archive(archive_bytes: &[u8]) -> CommandResult<BackupArchivePreview> {
    let parsed = parse_archive(archive_bytes)?;
    Ok(BackupArchivePreview {
        manifest: parsed.manifest,
    })
}

pub fn restore_backup_archive(
    app: &AppHandle,
    archive_bytes: &[u8],
) -> CommandResult<BackupRestoreResult> {
    let parsed = parse_archive(archive_bytes)?;
    replace_database_file(app, &parsed.database_bytes)?;
    Ok(BackupRestoreResult {
        client_state: parsed.client_state,
        restored_at: parsed.manifest.composite_updated_at,
    })
}
