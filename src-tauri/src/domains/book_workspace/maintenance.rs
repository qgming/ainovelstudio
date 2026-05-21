// 图书工作区：打开旧书籍时补齐缺失的内置初始化模板。

use crate::domains::book_workspace::data::{
    ensure_directory_chain, insert_entry, load_book_by_root_path, load_entry_record, touch_book,
};
use crate::domains::book_workspace::search::rebuild_book_search_index;
use crate::domains::book_workspace::templates::build_book_template;
use crate::infrastructure::workspace_paths::{
    file_extension, now_timestamp, parent_relative_path, CommandResult,
};
use rusqlite::Transaction;

fn ensure_template_directory(
    transaction: &Transaction<'_>,
    book_id: &str,
    relative_path: &str,
    timestamp: u64,
) -> CommandResult<bool> {
    match load_entry_record(transaction, book_id, relative_path)? {
        Some(entry) if entry.kind == "directory" => Ok(false),
        Some(_) => Err(format!("初始化目录路径已被文件占用：{relative_path}")),
        None => {
            ensure_directory_chain(transaction, book_id, relative_path, timestamp)?;
            Ok(true)
        }
    }
}

fn ensure_template_file(
    transaction: &Transaction<'_>,
    book_id: &str,
    relative_path: &str,
    contents: &str,
    timestamp: u64,
) -> CommandResult<bool> {
    match load_entry_record(transaction, book_id, relative_path)? {
        Some(entry) if entry.kind == "file" => Ok(false),
        Some(_) => Err(format!("初始化文件路径已被目录占用：{relative_path}")),
        None => {
            ensure_directory_chain(
                transaction,
                book_id,
                &parent_relative_path(relative_path),
                timestamp,
            )?;
            insert_entry(
                transaction,
                book_id,
                relative_path,
                "file",
                file_extension(relative_path).as_deref(),
                contents.as_bytes(),
                timestamp,
            )?;
            Ok(true)
        }
    }
}

pub(crate) fn ensure_book_workspace_template_db(
    transaction: &Transaction<'_>,
    root_path: &str,
) -> CommandResult<Vec<String>> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let timestamp = now_timestamp();
    let (directories, files) = build_book_template(&book.name);
    let mut created_paths = Vec::new();

    for directory in directories {
        if ensure_template_directory(transaction, &book.id, directory, timestamp)? {
            created_paths.push(directory.to_string());
        }
    }

    for (relative_path, contents) in files {
        if ensure_template_file(transaction, &book.id, relative_path, &contents, timestamp)? {
            created_paths.push(relative_path.to_string());
        }
    }

    if !created_paths.is_empty() {
        touch_book(transaction, &book.id, timestamp)?;
        rebuild_book_search_index(transaction, &book.id)?;
    }

    Ok(created_paths)
}
