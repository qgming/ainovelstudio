// 图书工作区：文件级 CRUD、行操作、重命名/移动/删除。

use crate::workspace::book::data::{
    display_path, ensure_directory_chain, ensure_directory_exists, ensure_entry_record,
    insert_entry, load_book_by_root_path, load_entry_record, load_subtree_records,
    resolve_relative_path, touch_book, WorkspaceLineResult,
};
use crate::workspace::common::{
    bytes_to_text, check_adjacent_context, detect_line_ending, error_to_string, file_extension,
    join_relative_path, line_text_or_empty, now_timestamp, parent_relative_path, split_text_lines,
    validate_line_number, validate_name, validate_optional_context_line, validate_relative_segments,
    validate_single_line_text, CommandResult,
};
use rusqlite::{params, Connection, Transaction};
use std::path::Path;

pub(crate) fn normalize_text_file_name(value: &str) -> CommandResult<String> {
    let validated = validate_name(value)?;
    let next_name = if Path::new(&validated).extension().is_some() {
        validated
    } else {
        format!("{validated}.md")
    };
    let extension = file_extension(&next_name).unwrap_or_default();
    if extension != ".md" && extension != ".txt" && extension != ".json" {
        return Err("只能创建 .md、.txt 或 .json 文件。".into());
    }

    Ok(next_name)
}

pub(crate) fn build_rename_target_name(
    current_name: &str,
    is_directory: bool,
    next_name: &str,
) -> CommandResult<String> {
    let validated = validate_name(next_name)?;
    if is_directory || Path::new(&validated).extension().is_some() {
        return Ok(validated);
    }

    Ok(format!(
        "{validated}{}",
        file_extension(current_name).unwrap_or_default()
    ))
}

pub(crate) fn read_text_file_db(
    connection: &Connection,
    root_path: &str,
    path: &str,
) -> CommandResult<String> {
    let book = load_book_by_root_path(connection, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    let entry = ensure_entry_record(connection, &book.id, &relative_path)?;
    if entry.kind != "file" {
        return Err("只能读取文件内容。".into());
    }
    bytes_to_text(entry.content_bytes)
}

pub(crate) fn read_text_file_line_db(
    connection: &Connection,
    root_path: &str,
    path: &str,
    line_number: usize,
) -> CommandResult<WorkspaceLineResult> {
    let book = load_book_by_root_path(connection, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    let entry = ensure_entry_record(connection, &book.id, &relative_path)?;
    if entry.kind != "file" {
        return Err("只能读取文件中的指定行。".into());
    }

    let contents = bytes_to_text(entry.content_bytes)?;
    let (lines, _) = split_text_lines(&contents);
    let index = validate_line_number(line_number)?;

    Ok(WorkspaceLineResult {
        line_number,
        path: crate::workspace::book::data::display_relative_path(&relative_path),
        text: line_text_or_empty(&lines, index).to_string(),
    })
}

pub(crate) fn write_text_file_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    path: &str,
    contents: &str,
) -> CommandResult<()> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("只能写入文件内容。".into());
    }
    validate_relative_segments(&relative_path)?;
    let timestamp = now_timestamp();

    ensure_directory_chain(
        transaction,
        &book.id,
        &parent_relative_path(&relative_path),
        timestamp,
    )?;

    match load_entry_record(transaction, &book.id, &relative_path)? {
        Some(entry) if entry.kind != "file" => return Err("只能写入文件内容。".into()),
        Some(_) => {
            transaction
                .execute(
                    r#"
                    UPDATE book_workspace_entries
                    SET content_bytes = ?1, updated_at = ?2
                    WHERE book_id = ?3 AND path = ?4
                    "#,
                    params![
                        contents.as_bytes(),
                        timestamp as i64,
                        book.id,
                        relative_path,
                    ],
                )
                .map_err(error_to_string)?;
        }
        None => {
            insert_entry(
                transaction,
                &book.id,
                &relative_path,
                "file",
                file_extension(&relative_path).as_deref(),
                contents.as_bytes(),
                timestamp,
            )?;
        }
    }

    touch_book(transaction, &book.id, timestamp)?;
    Ok(())
}

pub(crate) fn replace_text_file_line_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    path: &str,
    line_number: usize,
    contents: &str,
    previous_line: Option<String>,
    next_line: Option<String>,
) -> CommandResult<WorkspaceLineResult> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    let entry = ensure_entry_record(transaction, &book.id, &relative_path)?;
    if entry.kind != "file" {
        return Err("只能替换文件中的指定行。".into());
    }

    let previous_line = validate_optional_context_line(previous_line)?;
    let next_line = validate_optional_context_line(next_line)?;
    let next_contents = validate_single_line_text(contents)?;
    let current_contents = bytes_to_text(entry.content_bytes)?;
    let line_ending = detect_line_ending(&current_contents);
    let (mut lines, had_trailing_newline) = split_text_lines(&current_contents);
    let index = validate_line_number(line_number)?;
    while lines.len() <= index {
        lines.push(String::new());
    }

    check_adjacent_context(
        &lines,
        index,
        previous_line.as_deref(),
        next_line.as_deref(),
    )?;
    lines[index] = next_contents.clone();

    let mut updated_contents = lines.join(line_ending);
    if had_trailing_newline {
        updated_contents.push_str(line_ending);
    }

    let timestamp = now_timestamp();
    transaction
        .execute(
            r#"
            UPDATE book_workspace_entries
            SET content_bytes = ?1, updated_at = ?2
            WHERE book_id = ?3 AND path = ?4
            "#,
            params![
                updated_contents.as_bytes(),
                timestamp as i64,
                book.id,
                relative_path,
            ],
        )
        .map_err(error_to_string)?;
    touch_book(transaction, &book.id, timestamp)?;

    Ok(WorkspaceLineResult {
        line_number,
        path: crate::workspace::book::data::display_relative_path(&relative_path),
        text: next_contents,
    })
}

pub(crate) fn create_workspace_directory_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    parent_path: &str,
    name: &str,
) -> CommandResult<String> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let parent_relative_path = resolve_relative_path(&book.root_path, parent_path)?;
    ensure_directory_exists(transaction, &book.id, &parent_relative_path)?;
    let directory_name = validate_name(name)?;
    let next_path = join_relative_path(&parent_relative_path, &directory_name);
    if load_entry_record(transaction, &book.id, &next_path)?.is_some() {
        return Err("同名文件或文件夹已存在。".into());
    }

    let timestamp = now_timestamp();
    insert_entry(
        transaction,
        &book.id,
        &next_path,
        "directory",
        None,
        &[],
        timestamp,
    )?;
    touch_book(transaction, &book.id, timestamp)?;
    Ok(display_path(&book.root_path, &next_path))
}

pub(crate) fn create_workspace_text_file_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    parent_path: &str,
    name: &str,
) -> CommandResult<String> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let parent_relative_path = resolve_relative_path(&book.root_path, parent_path)?;
    ensure_directory_exists(transaction, &book.id, &parent_relative_path)?;
    let file_name = normalize_text_file_name(name)?;
    let next_path = join_relative_path(&parent_relative_path, &file_name);
    if load_entry_record(transaction, &book.id, &next_path)?.is_some() {
        return Err("同名文件已存在。".into());
    }

    let timestamp = now_timestamp();
    insert_entry(
        transaction,
        &book.id,
        &next_path,
        "file",
        file_extension(&file_name).as_deref(),
        &[],
        timestamp,
    )?;
    touch_book(transaction, &book.id, timestamp)?;
    Ok(display_path(&book.root_path, &next_path))
}

fn rebase_relative_path(current_path: &str, source_path: &str, target_path: &str) -> String {
    if current_path == source_path {
        target_path.to_string()
    } else {
        format!("{target_path}{}", &current_path[source_path.len()..])
    }
}

fn is_same_or_descendant_relative(path: &str, target: &str) -> bool {
    path == target || path.starts_with(&format!("{target}/"))
}

pub(crate) fn rename_workspace_entry_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    path: &str,
    next_name: &str,
) -> CommandResult<String> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("不能重命名书籍根目录。".into());
    }

    let entry = ensure_entry_record(transaction, &book.id, &relative_path)?;
    let target_name = build_rename_target_name(&entry.name, entry.kind == "directory", next_name)?;
    let target_path = join_relative_path(&parent_relative_path(&relative_path), &target_name);
    if load_entry_record(transaction, &book.id, &target_path)?.is_some() {
        return Err("目标名称已存在。".into());
    }

    let timestamp = now_timestamp();
    for current in load_subtree_records(transaction, &book.id, &relative_path)? {
        let next_path = rebase_relative_path(&current.path, &relative_path, &target_path);
        let next_name = if current.path == relative_path {
            target_name.clone()
        } else {
            current.name.clone()
        };
        let next_extension = if current.path == relative_path && current.kind == "file" {
            file_extension(&next_name)
        } else {
            current.extension.clone()
        };
        transaction
            .execute(
                r#"
                UPDATE book_workspace_entries
                SET path = ?1, parent_path = ?2, name = ?3, extension = ?4, updated_at = ?5
                WHERE book_id = ?6 AND path = ?7
                "#,
                params![
                    next_path,
                    parent_relative_path(&next_path),
                    next_name,
                    next_extension,
                    timestamp as i64,
                    book.id,
                    current.path,
                ],
            )
            .map_err(error_to_string)?;
    }
    touch_book(transaction, &book.id, timestamp)?;
    Ok(display_path(&book.root_path, &target_path))
}

pub(crate) fn move_workspace_entry_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    path: &str,
    target_parent_path: &str,
) -> CommandResult<String> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("不能迁移书籍根目录。".into());
    }

    let entry = ensure_entry_record(transaction, &book.id, &relative_path)?;
    let target_parent_relative_path = resolve_relative_path(&book.root_path, target_parent_path)?;
    ensure_directory_exists(transaction, &book.id, &target_parent_relative_path)?;
    if entry.kind == "directory"
        && is_same_or_descendant_relative(&target_parent_relative_path, &relative_path)
    {
        return Err("不能将文件夹迁移到其自身或子目录中。".into());
    }

    let target_path = join_relative_path(&target_parent_relative_path, &entry.name);
    if target_path == relative_path {
        return Err("目标位置未变化。".into());
    }
    if load_entry_record(transaction, &book.id, &target_path)?.is_some() {
        return Err("目标位置已存在同名文件或文件夹。".into());
    }

    let timestamp = now_timestamp();
    for current in load_subtree_records(transaction, &book.id, &relative_path)? {
        let next_path = rebase_relative_path(&current.path, &relative_path, &target_path);
        transaction
            .execute(
                r#"
                UPDATE book_workspace_entries
                SET path = ?1, parent_path = ?2, updated_at = ?3
                WHERE book_id = ?4 AND path = ?5
                "#,
                params![
                    next_path,
                    parent_relative_path(&next_path),
                    timestamp as i64,
                    book.id,
                    current.path,
                ],
            )
            .map_err(error_to_string)?;
    }
    touch_book(transaction, &book.id, timestamp)?;
    Ok(display_path(&book.root_path, &target_path))
}

pub(crate) fn delete_workspace_entry_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    path: &str,
) -> CommandResult<()> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("不能删除书籍根目录。".into());
    }
    let _ = ensure_entry_record(transaction, &book.id, &relative_path)?;

    let timestamp = now_timestamp();
    transaction
        .execute(
            r#"
            DELETE FROM book_workspace_entries
            WHERE book_id = ?1
              AND (path = ?2 OR substr(path, 1, length(?2) + 1) = ?2 || '/')
            "#,
            params![book.id, relative_path],
        )
        .map_err(error_to_string)?;
    touch_book(transaction, &book.id, timestamp)?;
    Ok(())
}
