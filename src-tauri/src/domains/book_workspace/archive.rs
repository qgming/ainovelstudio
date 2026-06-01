// 图书工作区：ZIP 导入与导出（基于真实文件）。

use crate::domains::book_workspace::data::{load_book_by_id, BookRecord};
use crate::domains::book_workspace::fs_store::WorkspaceStore;
use crate::domains::book_workspace::search::rebuild_book_search_index;
use crate::domains::book_workspace::templates::create_book_workspace_db;
use crate::infrastructure::workspace_paths::{
    error_to_string, normalize_relative_path, validate_name, validate_relative_segments,
    CommandResult,
};
use std::io::{Cursor, Read, Seek, Write};
use std::path::Path;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

const MAX_BOOK_ARCHIVE_COMPRESSION_RATIO: u64 = 200;
const MAX_BOOK_ARCHIVE_DEPTH: usize = 12;
const MAX_BOOK_ARCHIVE_ENTRIES: usize = 5_000;
const MAX_BOOK_ARCHIVE_FILE_SIZE: u64 = 10 * 1024 * 1024;
const MAX_BOOK_ARCHIVE_TOTAL_SIZE: u64 = 256 * 1024 * 1024;
const REQUIRED_BOOK_WORKSPACE_FILE: &str = ".project/README.md";

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
    if archive.is_empty() {
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
    let root_name = root_prefix.and_then(|prefix| {
        crate::infrastructure::workspace_paths::entry_name_from_path(prefix).ok()
    });

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

/// 删除书内除 .project 外的所有顶层条目（导入无 .project 的纯资料 zip 时保留模板）。
fn remove_non_project_template_entries(store: &WorkspaceStore, book_id: &str) -> CommandResult<()> {
    for entry in store.list_dir(book_id, "")? {
        if entry.path == ".project" {
            continue;
        }
        store.remove(book_id, &entry.path)?;
    }
    Ok(())
}

/// 清空书内全部内容（导入带 .project 的完整工作区 zip 时整体替换）。
fn remove_all_entries(store: &WorkspaceStore, book_id: &str) -> CommandResult<()> {
    for entry in store.list_dir(book_id, "")? {
        store.remove(book_id, &entry.path)?;
    }
    Ok(())
}

pub(crate) fn import_book_zip_db(
    store: &WorkspaceStore,
    file_name: &str,
    archive_bytes: Vec<u8>,
) -> CommandResult<BookRecord> {
    let mut archive = ZipArchive::new(Cursor::new(archive_bytes)).map_err(error_to_string)?;
    let file_paths = collect_book_archive_file_paths(&mut archive)?;
    let root_prefix = detect_book_workspace_root(&file_paths)?;
    let book_name = derive_imported_book_name(root_prefix.as_deref(), file_name)?;
    let book = create_book_workspace_db(store, &book_name)?;

    // 解压写盘是非原子的多步操作：一旦中途失败(损坏条目/磁盘满/越界路径),
    // 需回滚已创建的半成品书目录,否则会残留一本"名字被占、内容残缺"的书,
    // 用户重导同一 zip 还会撞"同名书籍已存在"而无法清理。
    let result = import_book_zip_into(store, &book.id, &mut archive, root_prefix.as_deref());
    if let Err(error) = result {
        // 回滚已创建的半成品书目录;尽力清理,不掩盖原始导入错误。
        let _ = store.delete_book(&book.id);
        return Err(error);
    }

    store.touch(&book.id)?;
    load_book_by_id(store, &book.id)
}

/// 把 zip 条目写入指定书目录并重建索引。失败时由调用方负责回滚书目录。
fn import_book_zip_into<R: Read + Seek>(
    store: &WorkspaceStore,
    book_id: &str,
    archive: &mut ZipArchive<R>,
    root_prefix: Option<&str>,
) -> CommandResult<()> {
    if root_prefix.is_some() {
        remove_all_entries(store, book_id)?;
    } else {
        remove_non_project_template_entries(store, book_id)?;
    }

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error_to_string)?;
        let path = normalize_relative_path(entry.name())?;
        if path.is_empty() || is_ignored_book_archive_path(&path) {
            continue;
        }
        let Some(relative_path) = relative_archive_path(path, root_prefix) else {
            continue;
        };
        if relative_path.is_empty() {
            continue;
        }

        if entry.is_dir() {
            validate_relative_segments(&relative_path)?;
            store.create_dir(book_id, &relative_path)?;
            continue;
        }

        validate_relative_segments(&relative_path)?;
        let mut content_bytes = Vec::new();
        entry
            .read_to_end(&mut content_bytes)
            .map_err(error_to_string)?;
        store.write_bytes(book_id, &relative_path, &content_bytes)?;
    }

    rebuild_book_search_index(store, book_id)?;
    Ok(())
}

pub(crate) fn export_book_zip_db(store: &WorkspaceStore, book_id: &str) -> CommandResult<Vec<u8>> {
    let book = load_book_by_id(store, book_id)?;
    let entries = store.collect_all_entries(&book.id)?;

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
        let bytes = store.read_bytes(&book.id, &entry.path)?;
        archive.write_all(&bytes).map_err(error_to_string)?;
    }

    archive
        .finish()
        .map_err(error_to_string)
        .map(|cursor| cursor.into_inner())
}
