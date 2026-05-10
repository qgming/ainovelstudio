use crate::domains::book_workspace::data::{
    insert_entry, load_book_by_root_path, load_entry_records, touch_book,
};
use crate::infrastructure::workspace_paths::{
    error_to_string, file_extension, now_timestamp, validate_relative_segments, CommandResult,
};
use rusqlite::{params, Connection, Transaction};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MIRROR_ROOT_DIR: &str = "desktop-workspaces";

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

fn collect_mirror_entries(base: &Path, current: &Path, entries: &mut Vec<MirrorEntry>) -> CommandResult<()> {
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

    let mut entries = Vec::new();
    collect_mirror_entries(&mirror_path, &mirror_path, &mut entries)?;
    entries.sort_by_key(|entry| match entry {
        MirrorEntry::Directory(path) | MirrorEntry::File(path, _) => path.matches('/').count(),
    });

    let timestamp = now_timestamp();
    transaction
        .execute(
            "DELETE FROM book_workspace_entries WHERE book_id = ?1",
            params![book.id],
        )
        .map_err(error_to_string)?;

    for entry in entries {
        match entry {
            MirrorEntry::Directory(path) => {
                insert_entry(transaction, &book.id, &path, "directory", None, &[], timestamp)?;
            }
            MirrorEntry::File(path, bytes) => {
                insert_entry(
                    transaction,
                    &book.id,
                    &path,
                    "file",
                    file_extension(&path).as_deref(),
                    &bytes,
                    timestamp,
                )?;
            }
        }
    }
    touch_book(transaction, &book.id, timestamp)?;
    Ok(true)
}
