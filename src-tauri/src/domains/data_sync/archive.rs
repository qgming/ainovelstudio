use super::archive_validation::{
    read_archive_entry, validate_archive_entries, validate_restored_database, ARCHIVE_BOOKS_PREFIX,
    ARCHIVE_SKILLS_PREFIX, MAX_ARCHIVE_TOTAL_SIZE, MAX_CLIENT_STATE_SIZE, MAX_MANIFEST_SIZE,
};
use crate::infrastructure::db::open_database;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Manager};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

pub type CommandResult<T> = Result<T, String>;

const ARCHIVE_DB_FILE: &str = "app.db";
const ARCHIVE_MANIFEST_FILE: &str = "manifest.json";
const ARCHIVE_CLIENT_STATE_FILE: &str = "client-state.json";
const ARCHIVE_SCHEMA_VERSION: u32 = 1;

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
    books_entries: Vec<ArchiveFsEntry>,
    client_state: ClientStateSnapshot,
    database_bytes: Vec<u8>,
    manifest: BackupManifest,
    skills_entries: Vec<ArchiveFsEntry>,
}

struct ArchiveFsEntry {
    contents: Vec<u8>,
    is_dir: bool,
    relative_path: String,
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

fn app_root_directory(app: &AppHandle) -> CommandResult<PathBuf> {
    let directory = app.path().app_data_dir().map_err(error_to_string)?;
    fs::create_dir_all(&directory).map_err(error_to_string)?;
    Ok(directory)
}

fn database_file_path(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(app_data_directory(app)?.join("app.db"))
}

fn books_directory(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(app_root_directory(app)?.join("books"))
}

fn skills_directory(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(app_root_directory(app)?.join("skills"))
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
    // 注意:技能(skill_packages)与书籍(book_workspaces/book_workspace_entries)自 CP-A/CP-E
    // 起改为真实文件存储,相关表已从 schema 移除,这里不再查询,否则会 "no such table" 报错。
    let queries = [
        "SELECT MAX(CAST(updated_at AS INTEGER)) FROM app_state",
        "SELECT MAX(updated_at) FROM config_documents",
        "SELECT MAX(CAST(updated_at AS INTEGER)) FROM chat_sessions",
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

fn path_modified_at(path: &Path) -> CommandResult<u64> {
    let metadata = fs::metadata(path).map_err(error_to_string)?;
    let modified = metadata
        .modified()
        .map_err(error_to_string)?
        .duration_since(UNIX_EPOCH)
        .map_err(error_to_string)?
        .as_secs();
    Ok(modified)
}

fn read_directory_updated_at(path: &Path) -> CommandResult<u64> {
    if !path.exists() {
        return Ok(0);
    }
    let mut latest = path_modified_at(path)?;
    for entry in fs::read_dir(path).map_err(error_to_string)? {
        let entry = entry.map_err(error_to_string)?;
        let file_type = entry.file_type().map_err(error_to_string)?;
        if file_type.is_symlink() {
            continue;
        }
        let entry_path = entry.path();
        latest = latest.max(path_modified_at(&entry_path)?);
        if file_type.is_dir() {
            latest = latest.max(read_directory_updated_at(&entry_path)?);
        }
    }
    Ok(latest)
}

fn write_directory_to_archive(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    options: SimpleFileOptions,
    source_root: &Path,
    archive_prefix: &str,
) -> CommandResult<()> {
    writer
        .add_directory(archive_prefix, options)
        .map_err(error_to_string)?;
    if !source_root.exists() {
        return Ok(());
    }
    write_directory_children_to_archive(writer, options, source_root, source_root, archive_prefix)
}

fn write_directory_children_to_archive(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    options: SimpleFileOptions,
    source_root: &Path,
    current: &Path,
    archive_prefix: &str,
) -> CommandResult<()> {
    for entry in fs::read_dir(current).map_err(error_to_string)? {
        let entry = entry.map_err(error_to_string)?;
        let file_type = entry.file_type().map_err(error_to_string)?;
        if file_type.is_symlink() {
            continue;
        }
        let path = entry.path();
        let relative = path
            .strip_prefix(source_root)
            .map_err(error_to_string)?
            .to_string_lossy()
            .replace('\\', "/");
        let archive_path = format!("{archive_prefix}{relative}");
        if file_type.is_dir() {
            writer
                .add_directory(format!("{archive_path}/"), options)
                .map_err(error_to_string)?;
            write_directory_children_to_archive(
                writer,
                options,
                source_root,
                &path,
                archive_prefix,
            )?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let contents = fs::read(&path).map_err(error_to_string)?;
        writer
            .start_file(archive_path, options)
            .map_err(error_to_string)?;
        writer.write_all(&contents).map_err(error_to_string)?;
    }
    Ok(())
}

fn serialize_json<T: Serialize>(value: &T) -> CommandResult<Vec<u8>> {
    serde_json::to_vec_pretty(value).map_err(error_to_string)
}

fn build_archive_bytes(
    manifest: &BackupManifest,
    client_state: &ClientStateSnapshot,
    database_bytes: &[u8],
    books_root: &Path,
    skills_root: &Path,
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

    write_directory_to_archive(&mut writer, options, books_root, ARCHIVE_BOOKS_PREFIX)?;
    write_directory_to_archive(&mut writer, options, skills_root, ARCHIVE_SKILLS_PREFIX)?;

    writer
        .finish()
        .map_err(error_to_string)
        .map(|finished| finished.into_inner())
}

fn read_prefixed_entries(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    prefix: &str,
) -> CommandResult<Vec<ArchiveFsEntry>> {
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error_to_string)?;
        let name = entry.name().replace('\\', "/");
        let Some(relative_path) = name.strip_prefix(prefix) else {
            continue;
        };
        let relative_path = relative_path.trim_matches('/').to_string();
        if relative_path.is_empty() {
            entries.push(ArchiveFsEntry {
                contents: Vec::new(),
                is_dir: true,
                relative_path,
            });
            continue;
        }
        if entry.is_dir() {
            entries.push(ArchiveFsEntry {
                contents: Vec::new(),
                is_dir: true,
                relative_path,
            });
            continue;
        }
        let mut contents = Vec::new();
        entry.read_to_end(&mut contents).map_err(error_to_string)?;
        entries.push(ArchiveFsEntry {
            contents,
            is_dir: false,
            relative_path,
        });
    }
    Ok(entries)
}

fn parse_archive(archive_bytes: &[u8]) -> CommandResult<ParsedBackupArchive> {
    if archive_bytes.is_empty() {
        return Err("备份文件为空。".into());
    }

    let mut archive = ZipArchive::new(Cursor::new(archive_bytes)).map_err(error_to_string)?;
    validate_archive_entries(&mut archive)?;

    let manifest_bytes =
        read_archive_entry(&mut archive, ARCHIVE_MANIFEST_FILE, MAX_MANIFEST_SIZE)?;
    let client_state_bytes = read_archive_entry(
        &mut archive,
        ARCHIVE_CLIENT_STATE_FILE,
        MAX_CLIENT_STATE_SIZE,
    )?;
    let database_bytes = read_archive_entry(&mut archive, ARCHIVE_DB_FILE, MAX_ARCHIVE_TOTAL_SIZE)?;

    if manifest_bytes.len() as u64 + client_state_bytes.len() as u64 + database_bytes.len() as u64
        > MAX_ARCHIVE_TOTAL_SIZE
    {
        return Err("备份文件过大。".into());
    }

    let books_entries = read_prefixed_entries(&mut archive, ARCHIVE_BOOKS_PREFIX)?;
    let skills_entries = read_prefixed_entries(&mut archive, ARCHIVE_SKILLS_PREFIX)?;

    let manifest =
        serde_json::from_slice::<BackupManifest>(&manifest_bytes).map_err(error_to_string)?;
    if manifest.schema_version != ARCHIVE_SCHEMA_VERSION {
        return Err("备份版本不受支持。".into());
    }

    let client_state = serde_json::from_slice::<ClientStateSnapshot>(&client_state_bytes)
        .map_err(error_to_string)?;

    Ok(ParsedBackupArchive {
        books_entries,
        client_state: normalize_client_state(client_state),
        database_bytes,
        manifest,
        skills_entries,
    })
}

fn remove_path_if_exists(path: &Path) -> CommandResult<()> {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if metadata.file_type().is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(error_to_string)
    } else {
        fs::remove_file(path).map_err(error_to_string)
    }
}

fn prepare_directory_entries(
    target: &Path,
    entries: &[ArchiveFsEntry],
) -> CommandResult<Option<PathBuf>> {
    if entries.is_empty() {
        return Ok(None);
    }
    let temp_path = target.with_extension("restore");
    remove_path_if_exists(&temp_path)?;
    fs::create_dir_all(&temp_path).map_err(error_to_string)?;

    for entry in entries {
        if entry.relative_path.is_empty() {
            continue;
        }
        let mut path = temp_path.clone();
        for segment in entry.relative_path.split('/') {
            path.push(segment);
        }
        if entry.is_dir {
            fs::create_dir_all(&path).map_err(error_to_string)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(error_to_string)?;
        }
        fs::write(path, &entry.contents).map_err(error_to_string)?;
    }

    Ok(Some(temp_path))
}

fn replace_directory_with_prepared(target: &Path, temp_path: &Path) -> CommandResult<()> {
    let backup_path = target.with_extension("restore-backup");
    remove_path_if_exists(&backup_path)?;
    let had_target = fs::symlink_metadata(target).is_ok();
    if had_target {
        fs::rename(target, &backup_path).map_err(error_to_string)?;
    }

    let commit_result = match fs::rename(temp_path, target) {
        Ok(_) => Ok(()),
        Err(_) => (|| {
            fs::create_dir_all(target).map_err(error_to_string)?;
            copy_directory_contents(temp_path, target)?;
            remove_path_if_exists(temp_path)
        })(),
    };

    if let Err(error) = commit_result {
        let _ = remove_path_if_exists(target);
        if had_target {
            let _ = fs::rename(&backup_path, target);
        }
        return Err(error);
    }

    if had_target {
        remove_path_if_exists(&backup_path)?;
    }
    Ok(())
}

fn copy_directory_contents(source: &Path, target: &Path) -> CommandResult<()> {
    for entry in fs::read_dir(source).map_err(error_to_string)? {
        let entry = entry.map_err(error_to_string)?;
        let file_type = entry.file_type().map_err(error_to_string)?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if file_type.is_dir() {
            fs::create_dir_all(&target_path).map_err(error_to_string)?;
            copy_directory_contents(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &target_path).map_err(error_to_string)?;
        }
    }
    Ok(())
}

fn prepare_database_restore(app: &AppHandle, database_bytes: &[u8]) -> CommandResult<PathBuf> {
    let db_path = database_file_path(app)?;
    let temp_path = db_path.with_extension("restore");
    remove_path_if_exists(&temp_path)?;
    fs::write(&temp_path, database_bytes).map_err(error_to_string)?;
    let restored_connection = Connection::open(&temp_path).map_err(error_to_string)?;
    validate_restored_database(&restored_connection)?;
    drop(restored_connection);
    Ok(temp_path)
}

fn replace_database_with_prepared(app: &AppHandle, temp_path: &Path) -> CommandResult<()> {
    let db_path = database_file_path(app)?;
    let backup_path = db_path.with_extension("restore-backup");
    remove_path_if_exists(&backup_path)?;
    for sidecar in ["app.db-wal", "app.db-shm"] {
        let path = app_data_directory(app)?.join(sidecar);
        let _ = fs::remove_file(path);
    }

    let had_database = fs::symlink_metadata(&db_path).is_ok();
    if had_database {
        fs::rename(&db_path, &backup_path).map_err(error_to_string)?;
    }

    if let Err(error) = fs::rename(temp_path, &db_path).map_err(error_to_string) {
        let _ = remove_path_if_exists(&db_path);
        if had_database {
            let _ = fs::rename(&backup_path, &db_path);
        }
        return Err(error);
    }

    if had_database {
        remove_path_if_exists(&backup_path)?;
    }
    Ok(())
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
    let books_updated_at = read_directory_updated_at(&books_directory(app)?)?;
    let skills_updated_at = read_directory_updated_at(&skills_directory(app)?)?;
    let storage_updated_at = books_updated_at.max(skills_updated_at);
    let manifest = build_manifest(
        database_updated_at.max(storage_updated_at),
        normalized_client_state.updated_at,
    );
    let bytes = build_archive_bytes(
        &manifest,
        &normalized_client_state,
        &database_bytes,
        &books_directory(app)?,
        &skills_directory(app)?,
    )?;

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
    let books_dir = books_directory(app)?;
    let skills_dir = skills_directory(app)?;
    let database_restore = prepare_database_restore(app, &parsed.database_bytes)?;
    let books_restore = match prepare_directory_entries(&books_dir, &parsed.books_entries) {
        Ok(path) => path,
        Err(error) => {
            let _ = remove_path_if_exists(&database_restore);
            return Err(error);
        }
    };
    let skills_restore = match prepare_directory_entries(&skills_dir, &parsed.skills_entries) {
        Ok(path) => path,
        Err(error) => {
            let _ = remove_path_if_exists(&database_restore);
            if let Some(path) = books_restore.as_deref() {
                let _ = remove_path_if_exists(path);
            }
            return Err(error);
        }
    };

    if let Some(path) = books_restore.as_deref() {
        replace_directory_with_prepared(&books_dir, path)?;
    }
    if let Some(path) = skills_restore.as_deref() {
        replace_directory_with_prepared(&skills_dir, path)?;
    }
    replace_database_with_prepared(app, &database_restore)?;
    Ok(BackupRestoreResult {
        client_state: parsed.client_state,
        restored_at: parsed.manifest.composite_updated_at,
    })
}
