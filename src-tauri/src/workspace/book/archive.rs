// 图书工作区：ZIP 导入与导出。

use crate::workspace::book::data::{
    ensure_directory_chain, insert_entry, load_book_by_id, load_book_by_root_path,
    load_entry_records, touch_book, BookRecord, BOOK_ROOT_PREFIX,
};
use crate::workspace::book::templates::create_book_workspace_db;
use crate::workspace::common::{
    error_to_string, file_extension, normalize_relative_path, now_timestamp, parent_relative_path,
    validate_name, validate_relative_segments, CommandResult,
};
use rusqlite::{params, Connection, Transaction};
use std::collections::HashSet;
use std::io::{Cursor, Read, Seek, Write};
use std::path::Path;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_BOOK_ARCHIVE_COMPRESSION_RATIO: u64 = 200;
const MAX_BOOK_ARCHIVE_DEPTH: usize = 12;
const MAX_BOOK_ARCHIVE_ENTRIES: usize = 5_000;
const MAX_BOOK_ARCHIVE_FILE_SIZE: u64 = 10 * 1024 * 1024;
const MAX_BOOK_ARCHIVE_TOTAL_SIZE: u64 = 256 * 1024 * 1024;
const REQUIRED_BOOK_WORKSPACE_FILES: [&str; 1] = [".project/AGENTS.md"];

fn is_ignored_book_archive_path(path: &str) -> bool {
    path.split('/')
        .any(|segment| segment == "__MACOSX" || segment == ".DS_Store" || segment == "Thumbs.db")
}

fn path_depth(path: &str) -> usize {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .count()
}

fn preview_archive_paths(paths: &[String]) -> String {
    let preview = paths.iter().take(8).cloned().collect::<Vec<_>>().join("，");
    if preview.is_empty() {
        "无可用文件".into()
    } else {
        preview
    }
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

fn archive_contains_required_book_files(file_set: &HashSet<String>, prefix: &str) -> bool {
    REQUIRED_BOOK_WORKSPACE_FILES.iter().all(|relative_path| {
        let candidate = if prefix.is_empty() {
            (*relative_path).to_string()
        } else {
            format!("{prefix}/{relative_path}")
        };
        file_set.contains(&candidate)
    })
}

fn detect_book_archive_root(file_paths: &[String]) -> CommandResult<String> {
    let file_set = file_paths.iter().cloned().collect::<HashSet<_>>();
    let mut candidates = vec![String::new()];
    let mut seen = HashSet::from([String::new()]);

    for path in file_paths {
        let mut current = parent_relative_path(path);
        while !current.is_empty() {
            if seen.insert(current.clone()) {
                candidates.push(current.clone());
            }
            current = parent_relative_path(&current);
        }
    }

    let matching_roots = candidates
        .into_iter()
        .filter(|prefix| archive_contains_required_book_files(&file_set, prefix))
        .collect::<Vec<_>>();

    if matching_roots.is_empty() {
        return Err(format!(
            "ZIP 中未找到有效书籍工作区。至少需要包含 .project/AGENTS.md。检测到的文件示例：{}",
            preview_archive_paths(file_paths)
        ));
    }
    if matching_roots.len() > 1 {
        return Err(format!(
            "ZIP 中检测到多个书籍工作区，当前仅支持单书导入。检测到：{}",
            matching_roots.join("，")
        ));
    }

    Ok(matching_roots[0].clone())
}

fn derive_imported_book_name(root_prefix: &str, file_name: &str) -> CommandResult<String> {
    let candidate = if !root_prefix.is_empty() {
        crate::workspace::common::entry_name_from_path(root_prefix)?
    } else {
        Path::new(file_name)
            .file_stem()
            .and_then(|name| name.to_str())
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "无法确定导入书籍名称。".to_string())?
            .to_string()
    };

    validate_name(&candidate)
}

pub(crate) fn import_book_zip_db(
    transaction: &Transaction<'_>,
    file_name: &str,
    archive_bytes: Vec<u8>,
) -> CommandResult<BookRecord> {
    let mut archive = ZipArchive::new(Cursor::new(archive_bytes)).map_err(error_to_string)?;
    let file_paths = collect_book_archive_file_paths(&mut archive)?;
    let root_prefix = detect_book_archive_root(&file_paths)?;
    let book_name = derive_imported_book_name(&root_prefix, file_name)?;
    let book = create_book_workspace_db(transaction, &book_name)?;

    transaction
        .execute(
            "DELETE FROM book_workspace_entries WHERE book_id = ?1",
            params![book.id],
        )
        .map_err(error_to_string)?;

    let timestamp = now_timestamp();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error_to_string)?;
        let path = normalize_relative_path(entry.name())?;
        if path.is_empty() || is_ignored_book_archive_path(&path) {
            continue;
        }

        if entry.is_dir() {
            let relative_path = if root_prefix.is_empty() {
                path
            } else if let Some(suffix) = path.strip_prefix(&format!("{root_prefix}/")) {
                suffix.to_string()
            } else {
                continue;
            };

            if relative_path.is_empty() {
                continue;
            }

            validate_relative_segments(&relative_path)?;
            ensure_directory_chain(transaction, &book.id, &relative_path, timestamp)?;
            continue;
        }

        let relative_path = if root_prefix.is_empty() {
            path
        } else if let Some(suffix) = path.strip_prefix(&format!("{root_prefix}/")) {
            suffix.to_string()
        } else {
            continue;
        };

        validate_relative_segments(&relative_path)?;
        ensure_directory_chain(
            transaction,
            &book.id,
            &parent_relative_path(&relative_path),
            timestamp,
        )?;
        let mut content_bytes = Vec::new();
        entry
            .read_to_end(&mut content_bytes)
            .map_err(error_to_string)?;
        insert_entry(
            transaction,
            &book.id,
            &relative_path,
            "file",
            file_extension(&relative_path).as_deref(),
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
