// 图书工作区：ZIP 导入与导出。

use crate::workspace::book::data::{
    ensure_directory_chain, insert_entry, load_book_by_id, load_book_by_root_path,
    load_entry_record, load_entry_records, touch_book, BookRecord, BOOK_ROOT_PREFIX,
};
use crate::workspace::book::templates::create_book_workspace_db;
use crate::workspace::common::{
    error_to_string, file_extension, normalize_relative_path, now_timestamp, parent_relative_path,
    validate_name, validate_relative_segments, CommandResult,
};
use rusqlite::{params, Connection, Transaction};
use std::io::{Cursor, Read, Seek, Write};
use std::path::Path;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_BOOK_ARCHIVE_COMPRESSION_RATIO: u64 = 200;
const MAX_BOOK_ARCHIVE_DEPTH: usize = 12;
const MAX_BOOK_ARCHIVE_ENTRIES: usize = 5_000;
const MAX_BOOK_ARCHIVE_FILE_SIZE: u64 = 10 * 1024 * 1024;
const MAX_BOOK_ARCHIVE_TOTAL_SIZE: u64 = 256 * 1024 * 1024;
const REQUIRED_BOOK_WORKSPACE_FILE: &str = ".project/AGENTS.md";

fn is_ignored_book_archive_path(path: &str) -> bool {
    path.split('/')
        .any(|segment| segment == "__MACOSX" || segment == ".DS_Store" || segment == "Thumbs.db")
}

fn path_depth(path: &str) -> usize {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .count()
}

fn collect_book_archive_file_paths<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> CommandResult<Vec<String>> {
    if archive.len() == 0 {
        return Err("ZIP 压缩包为空。".into());
    }
    if archive.len() > MAX_BOOK_ARCHIVE_ENTRIES {
        return Err("ZIP 文件条目过多，请拆分后重试。".into());
    }

    let mut file_paths = Vec::new();
    let mut total_uncompressed = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(error_to_string)?;
        let path = normalize_relative_path(entry.name())?;
        if path_depth(&path) > MAX_BOOK_ARCHIVE_DEPTH {
            return Err("ZIP 内目录层级过深。".into());
        }
        if entry.size() > MAX_BOOK_ARCHIVE_FILE_SIZE {
            return Err("ZIP 中包含超出大小限制的文件。".into());
        }
        if entry.compressed_size() > 0
            && entry.size() / entry.compressed_size().max(1) > MAX_BOOK_ARCHIVE_COMPRESSION_RATIO
        {
            return Err("ZIP 中包含压缩比异常的文件。".into());
        }

        total_uncompressed += entry.size();
        if total_uncompressed > MAX_BOOK_ARCHIVE_TOTAL_SIZE {
            return Err("ZIP 解压后体积超过当前限制。".into());
        }
        if entry.is_dir() || path.is_empty() || is_ignored_book_archive_path(&path) {
            continue;
        }
        file_paths.push(path);
    }

    Ok(file_paths)
}

fn detect_book_workspace_root(file_paths: &[String]) -> CommandResult<Option<String>> {
    if file_paths.is_empty() {
        return Err("ZIP 中未找到可导入的文件。".into());
    }
    let mut root_prefix: Option<String> = None;
    for path in file_paths {
        if path == REQUIRED_BOOK_WORKSPACE_FILE {
            let next_prefix = String::new();
            if root_prefix
                .as_ref()
                .is_some_and(|prefix| prefix != &next_prefix)
            {
                return Err("ZIP 中检测到多个书籍工作区，当前仅支持单书导入。".into());
            }
            root_prefix = Some(next_prefix);
            continue;
        }

        let suffix = format!("/{REQUIRED_BOOK_WORKSPACE_FILE}");
        if let Some(prefix) = path.strip_suffix(&suffix) {
            if root_prefix
                .as_ref()
                .is_some_and(|existing| existing != prefix)
            {
                return Err("ZIP 中检测到多个书籍工作区，当前仅支持单书导入。".into());
            }
            root_prefix = Some(prefix.to_string());
        }
    }

    Ok(root_prefix)
}

fn derive_imported_book_name(root_prefix: Option<&str>, file_name: &str) -> CommandResult<String> {
    let archive_stem = Path::new(file_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty());
    let root_name =
        root_prefix.and_then(|prefix| crate::workspace::common::entry_name_from_path(prefix).ok());

    root_name
        .as_deref()
        .into_iter()
        .chain(archive_stem)
        .find_map(|candidate| validate_name(candidate).ok())
        .ok_or_else(|| "无法确定导入书籍名称。".to_string())
}

fn relative_archive_path(path: String, root_prefix: Option<&str>) -> Option<String> {
    match root_prefix {
        Some("") => Some(path),
        Some(prefix) => path
            .strip_prefix(&format!("{prefix}/"))
            .map(|suffix| suffix.to_string()),
        None => Some(path),
    }
}

fn insert_archive_file_entry(
    transaction: &Transaction<'_>,
    book_id: &str,
    relative_path: &str,
    content_bytes: &[u8],
    timestamp: u64,
) -> CommandResult<()> {
    ensure_directory_chain(
        transaction,
        book_id,
        &parent_relative_path(relative_path),
        timestamp,
    )?;
    if let Some(existing) = load_entry_record(transaction, book_id, relative_path)? {
        if existing.kind != "file" {
            return Err("ZIP 内文件路径与已有目录冲突。".into());
        }
        transaction
            .execute(
                r#"
                UPDATE book_workspace_entries
                SET extension = ?1, content_bytes = ?2, updated_at = ?3
                WHERE book_id = ?4 AND path = ?5
                "#,
                params![
                    file_extension(relative_path).as_deref(),
                    content_bytes,
                    timestamp as i64,
                    book_id,
                    relative_path,
                ],
            )
            .map_err(error_to_string)?;
        return Ok(());
    }
    insert_entry(
        transaction,
        book_id,
        relative_path,
        "file",
        file_extension(relative_path).as_deref(),
        content_bytes,
        timestamp,
    )
}

fn remove_non_project_template_entries(
    transaction: &Transaction<'_>,
    book_id: &str,
) -> CommandResult<()> {
    transaction
        .execute(
            r#"
            DELETE FROM book_workspace_entries
            WHERE book_id = ?1
              AND path != '.project'
              AND path NOT LIKE '.project/%'
            "#,
            params![book_id],
        )
        .map_err(error_to_string)?;
    Ok(())
}

pub(crate) fn import_book_zip_db(
    transaction: &Transaction<'_>,
    file_name: &str,
    archive_bytes: Vec<u8>,
) -> CommandResult<BookRecord> {
    let mut archive = ZipArchive::new(Cursor::new(archive_bytes)).map_err(error_to_string)?;
    let file_paths = collect_book_archive_file_paths(&mut archive)?;
    let root_prefix = detect_book_workspace_root(&file_paths)?;
    let book_name = derive_imported_book_name(root_prefix.as_deref(), file_name)?;
    let book = create_book_workspace_db(transaction, &book_name)?;

    if root_prefix.is_some() {
        transaction
            .execute(
                "DELETE FROM book_workspace_entries WHERE book_id = ?1",
                params![book.id],
            )
            .map_err(error_to_string)?;
    } else {
        remove_non_project_template_entries(transaction, &book.id)?;
    }

    let timestamp = now_timestamp();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error_to_string)?;
        let path = normalize_relative_path(entry.name())?;
        if path.is_empty() || is_ignored_book_archive_path(&path) {
            continue;
        }
        let Some(relative_path) = relative_archive_path(path, root_prefix.as_deref()) else {
            continue;
        };
        if relative_path.is_empty() {
            continue;
        }

        if entry.is_dir() {
            validate_relative_segments(&relative_path)?;
            ensure_directory_chain(transaction, &book.id, &relative_path, timestamp)?;
            continue;
        }

        validate_relative_segments(&relative_path)?;
        let mut content_bytes = Vec::new();
        entry
            .read_to_end(&mut content_bytes)
            .map_err(error_to_string)?;
        insert_archive_file_entry(
            transaction,
            &book.id,
            &relative_path,
            &content_bytes,
            timestamp,
        )?;
    }

    touch_book(transaction, &book.id, timestamp)?;
    load_book_by_id(transaction, &book.id)
}

pub(crate) fn export_book_zip_db(
    connection: &Connection,
    root_path: &str,
) -> CommandResult<Vec<u8>> {
    let book = load_book_by_root_path(connection, root_path)?;
    let entries = load_entry_records(connection, &book.id)?;

    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for entry in entries {
        let archive_path = format!("{}/{}", book.name, entry.path);
        if entry.kind == "directory" {
            archive
                .add_directory(format!("{archive_path}/"), options)
                .map_err(error_to_string)?;
            continue;
        }

        archive
            .start_file(archive_path, options)
            .map_err(error_to_string)?;
        archive
            .write_all(&entry.content_bytes)
            .map_err(error_to_string)?;
    }

    archive
        .finish()
        .map_err(error_to_string)
        .map(|cursor| cursor.into_inner())
}

// 抑制对 BOOK_ROOT_PREFIX 未使用的警告（仅在 archive 内部不直接需要，但保留可见以利将来）。
#[allow(dead_code)]
const _: &str = BOOK_ROOT_PREFIX;
