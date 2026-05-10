use crate::domains::book_workspace::data::{
    insert_entry, load_book_by_root_path, load_entry_records, touch_book,
};
use crate::infrastructure::workspace_paths::{
    error_to_string, file_extension, now_timestamp, validate_relative_segments, CommandResult,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MIRROR_ROOT_DIR: &str = "desktop-workspaces";
const MIRROR_SIGNATURE_KEY_PREFIX: &str = "book.mirror_signature.";
const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
const FNV_PRIME: u64 = 0x100000001b3;

fn mirror_root(app: &AppHandle) -> CommandResult<PathBuf> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(error_to_string)?
        .join(MIRROR_ROOT_DIR))
}

fn book_mirror_path(app: &AppHandle, book_id: &str, book_name: &str) -> CommandResult<PathBuf> {
    let folder_name = format!("{book_name}_{book_id}");
    Ok(mirror_root(app)?.join(folder_name))
}

fn ensure_removable_mirror_path(app: &AppHandle, path: &Path) -> CommandResult<()> {
    let root = mirror_root(app)?;
    if !path.starts_with(&root) {
        return Err("镜像目录不在应用数据目录内。".into());
    }
    Ok(())
}

fn recreate_directory(app: &AppHandle, path: &Path) -> CommandResult<()> {
    ensure_removable_mirror_path(app, path)?;
    if path.exists() {
        fs::remove_dir_all(path).map_err(error_to_string)?;
    }
    fs::create_dir_all(path).map_err(error_to_string)
}

fn relative_path(base: &Path, path: &Path) -> CommandResult<String> {
    let relative = path.strip_prefix(base).map_err(error_to_string)?;
    let value = relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/");
    validate_relative_segments(&value)?;
    Ok(value)
}

fn collect_mirror_entries(
    base: &Path,
    current: &Path,
    entries: &mut Vec<MirrorEntry>,
) -> CommandResult<()> {
    for item in fs::read_dir(current).map_err(error_to_string)? {
        let item = item.map_err(error_to_string)?;
        let path = item.path();
        let file_type = item.file_type().map_err(error_to_string)?;
        if file_type.is_symlink() {
            return Err("镜像文件夹内暂不支持符号链接。".into());
        }

        if file_type.is_dir() {
            entries.push(MirrorEntry::Directory(relative_path(base, &path)?));
            collect_mirror_entries(base, &path, entries)?;
            continue;
        }

        if file_type.is_file() {
            entries.push(MirrorEntry::File(
                relative_path(base, &path)?,
                fs::read(&path).map_err(error_to_string)?,
            ));
        }
    }
    Ok(())
}

enum MirrorEntry {
    Directory(String),
    File(String, Vec<u8>),
}

fn hash_bytes(mut hash: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn mirror_signature(entries: &[MirrorEntry]) -> String {
    let mut parts = entries.iter().collect::<Vec<_>>();
    parts.sort_by_key(|entry| match entry {
        MirrorEntry::Directory(path) | MirrorEntry::File(path, _) => path.as_str(),
    });

    let mut hash = FNV_OFFSET_BASIS;
    for entry in parts {
        match entry {
            MirrorEntry::Directory(path) => {
                hash = hash_bytes(hash, b"dir\0");
                hash = hash_bytes(hash, path.as_bytes());
            }
            MirrorEntry::File(path, bytes) => {
                hash = hash_bytes(hash, b"file\0");
                hash = hash_bytes(hash, path.as_bytes());
                hash = hash_bytes(hash, b"\0");
                hash = hash_bytes(hash, bytes);
            }
        }
    }
    format!("{hash:016x}")
}

fn mirror_signature_key(book_id: &str) -> String {
    format!("{MIRROR_SIGNATURE_KEY_PREFIX}{book_id}")
}

fn read_mirror_signature(connection: &Connection, book_id: &str) -> CommandResult<Option<String>> {
    let value_json = connection
        .query_row(
            "SELECT value_json FROM app_state WHERE key = ?1",
            params![mirror_signature_key(book_id)],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?;
    value_json
        .map(|value| serde_json::from_str::<String>(&value).map_err(error_to_string))
        .transpose()
}

fn remember_mirror_signature(
    connection: &Connection,
    book_id: &str,
    signature: &str,
) -> CommandResult<()> {
    let value_json = serde_json::to_string(signature).map_err(error_to_string)?;
    let timestamp = now_timestamp().to_string();
    connection
        .execute(
            r#"
            INSERT INTO app_state (key, value_json, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at
            "#,
            params![mirror_signature_key(book_id), value_json, timestamp],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn read_mirror_entries(mirror_path: &Path) -> CommandResult<Vec<MirrorEntry>> {
    let mut entries = Vec::new();
    collect_mirror_entries(mirror_path, mirror_path, &mut entries)?;
    entries.sort_by_key(|entry| match entry {
        MirrorEntry::Directory(path) | MirrorEntry::File(path, _) => path.matches('/').count(),
    });
    Ok(entries)
}

fn replace_book_entries(
    transaction: &Transaction<'_>,
    book_id: &str,
    entries: Vec<MirrorEntry>,
) -> CommandResult<()> {
    let timestamp = now_timestamp();
    transaction
        .execute(
            "DELETE FROM book_workspace_entries WHERE book_id = ?1",
            params![book_id],
        )
        .map_err(error_to_string)?;
    for entry in entries {
        match entry {
            MirrorEntry::Directory(path) => {
                insert_entry(
                    transaction,
                    book_id,
                    &path,
                    "directory",
                    None,
                    &[],
                    timestamp,
                )?;
            }
            MirrorEntry::File(path, bytes) => {
                insert_entry(
                    transaction,
                    book_id,
                    &path,
                    "file",
                    file_extension(&path).as_deref(),
                    &bytes,
                    timestamp,
                )?;
            }
        }
    }
    touch_book(transaction, book_id, timestamp)
}

pub(crate) fn export_book_to_mirror(
    app: &AppHandle,
    connection: &Connection,
    root_path: &str,
) -> CommandResult<PathBuf> {
    let book = load_book_by_root_path(connection, root_path)?;
    let mirror_path = book_mirror_path(app, &book.id, &book.name)?;
    recreate_directory(app, &mirror_path)?;

    for entry in load_entry_records(connection, &book.id)? {
        let entry_path = mirror_path.join(entry.path.replace('/', std::path::MAIN_SEPARATOR_STR));
        if entry.kind == "directory" {
            fs::create_dir_all(entry_path).map_err(error_to_string)?;
        } else {
            if let Some(parent) = entry_path.parent() {
                fs::create_dir_all(parent).map_err(error_to_string)?;
            }
            fs::write(entry_path, entry.content_bytes).map_err(error_to_string)?;
        }
    }

    let entries = read_mirror_entries(&mirror_path)?;
    remember_mirror_signature(connection, &book.id, &mirror_signature(&entries))?;
    Ok(mirror_path)
}

pub(crate) fn import_mirror_to_book(
    app: &AppHandle,
    transaction: &Transaction<'_>,
    root_path: &str,
) -> CommandResult<bool> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let mirror_path = book_mirror_path(app, &book.id, &book.name)?;
    if !mirror_path.exists() {
        return Ok(false);
    }

    let entries = read_mirror_entries(&mirror_path)?;
    let signature = mirror_signature(&entries);
    replace_book_entries(transaction, &book.id, entries)?;
    remember_mirror_signature(transaction, &book.id, &signature)?;
    Ok(true)
}

pub(crate) fn import_changed_mirror_to_book(
    app: &AppHandle,
    transaction: &Transaction<'_>,
    root_path: &str,
) -> CommandResult<bool> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let mirror_path = book_mirror_path(app, &book.id, &book.name)?;
    if !mirror_path.exists() {
        return Ok(false);
    }

    let entries = read_mirror_entries(&mirror_path)?;
    let signature = mirror_signature(&entries);
    let previous_signature = read_mirror_signature(transaction, &book.id)?;
    if previous_signature.as_deref() == Some(signature.as_str()) {
        return Ok(false);
    }
    if previous_signature.is_none() {
        remember_mirror_signature(transaction, &book.id, &signature)?;
        return Ok(false);
    }

    replace_book_entries(transaction, &book.id, entries)?;
    remember_mirror_signature(transaction, &book.id, &signature)?;
    Ok(true)
}
