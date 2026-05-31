// 图书工作区：文件级 CRUD、行操作、字符串替换、重命名/移动/删除（基于真实文件）。

use crate::domains::book_workspace::data::{
    display_path, display_relative_path, load_book_by_id, resolve_relative_path,
    WorkspaceLineResult,
};
use crate::domains::book_workspace::fs_store::WorkspaceStore;
use crate::domains::book_workspace::relations::{
    delete_relations_for_subtree, rename_entry_in_relations,
};
use crate::domains::book_workspace::search::{
    rebuild_book_search_index, reindex_subtree_after_delete, reindex_subtree_after_rename,
    reindex_workspace_entry,
};
use crate::infrastructure::workspace_paths::{
    check_adjacent_context, detect_line_ending, file_extension, join_relative_path,
    line_text_or_empty, parent_relative_path, split_text_lines, validate_line_number,
    validate_name, validate_optional_context_line, validate_relative_segments,
    validate_single_line_text, CommandResult,
};
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
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
) -> CommandResult<String> {
    let book = load_book_by_id(store, book_id)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    store.read_text(&book.id, &relative_path)
}

pub(crate) fn read_text_file_line_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
    line_number: usize,
) -> CommandResult<WorkspaceLineResult> {
    let book = load_book_by_id(store, book_id)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    let contents = store.read_text(&book.id, &relative_path)?;
    let (lines, _) = split_text_lines(&contents);
    let index = validate_line_number(line_number)?;

    Ok(WorkspaceLineResult {
        line_number,
        path: display_relative_path(&relative_path),
        text: line_text_or_empty(&lines, index).to_string(),
    })
}

pub(crate) fn write_text_file_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
    contents: &str,
) -> CommandResult<()> {
    let book = load_book_by_id(store, book_id)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("只能写入文件内容。".into());
    }
    validate_relative_segments(&relative_path)?;

    store.write_text(&book.id, &relative_path, contents)?;
    reindex_workspace_entry(store, &book.id, &relative_path)?;
    store.touch(&book.id)?;
    Ok(())
}

/// 字符串替换编辑：把文件中唯一出现的 old_string 替换为 new_string。
/// old_string 为空表示创建新文件（要求文件不存在）。匹配次数必须恰好为 1。
pub(crate) fn edit_text_file_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
    old_string: &str,
    new_string: &str,
) -> CommandResult<()> {
    let book = load_book_by_id(store, book_id)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("只能编辑文件内容。".into());
    }
    validate_relative_segments(&relative_path)?;

    // old_string 为空：当作创建新文件。
    if old_string.is_empty() {
        if store.exists(&book.id, &relative_path)? {
            return Err("目标文件已存在，创建模式要求文件不存在。".into());
        }
        store.write_text(&book.id, &relative_path, new_string)?;
        reindex_workspace_entry(store, &book.id, &relative_path)?;
        store.touch(&book.id)?;
        return Ok(());
    }

    if old_string == new_string {
        return Err("替换前后的内容相同，无需编辑。".into());
    }

    let current = store.read_text(&book.id, &relative_path)?;
    let occurrences = current.matches(old_string).count();
    if occurrences == 0 {
        return Err("未在文件中找到要替换的内容。".into());
    }
    if occurrences > 1 {
        return Err(format!(
            "要替换的内容在文件中出现了 {occurrences} 次，请提供更长的唯一上下文。"
        ));
    }

    let updated = current.replacen(old_string, new_string, 1);
    store.write_text(&book.id, &relative_path, &updated)?;
    reindex_workspace_entry(store, &book.id, &relative_path)?;
    store.touch(&book.id)?;
    Ok(())
}

pub(crate) fn replace_text_file_line_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
    line_number: usize,
    contents: &str,
    previous_line: Option<String>,
    next_line: Option<String>,
) -> CommandResult<WorkspaceLineResult> {
    let book = load_book_by_id(store, book_id)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if !store.is_file(&book.id, &relative_path)? {
        return Err("只能替换文件中的指定行。".into());
    }

    let previous_line = validate_optional_context_line(previous_line)?;
    let next_line = validate_optional_context_line(next_line)?;
    let next_contents = validate_single_line_text(contents)?;
    let current_contents = store.read_text(&book.id, &relative_path)?;
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

    store.write_text(&book.id, &relative_path, &updated_contents)?;
    reindex_workspace_entry(store, &book.id, &relative_path)?;
    store.touch(&book.id)?;

    Ok(WorkspaceLineResult {
        line_number,
        path: display_relative_path(&relative_path),
        text: next_contents,
    })
}

pub(crate) fn create_workspace_directory_db(
    store: &WorkspaceStore,
    book_id: &str,
    parent_path: &str,
    name: &str,
) -> CommandResult<String> {
    let book = load_book_by_id(store, book_id)?;
    let parent_relative_path = resolve_relative_path(&book.root_path, parent_path)?;
    if !parent_relative_path.is_empty() && !store.is_dir(&book.id, &parent_relative_path)? {
        return Err("父级目录不存在。".into());
    }
    let directory_name = validate_name(name)?;
    let next_path = join_relative_path(&parent_relative_path, &directory_name);
    if store.exists(&book.id, &next_path)? {
        return Err("同名文件或文件夹已存在。".into());
    }

    store.create_dir(&book.id, &next_path)?;
    reindex_workspace_entry(store, &book.id, &next_path)?;
    store.touch(&book.id)?;
    Ok(display_path(&book.root_path, &next_path))
}

pub(crate) fn create_workspace_text_file_db(
    store: &WorkspaceStore,
    book_id: &str,
    parent_path: &str,
    name: &str,
) -> CommandResult<String> {
    let book = load_book_by_id(store, book_id)?;
    let parent_relative_path = resolve_relative_path(&book.root_path, parent_path)?;
    if !parent_relative_path.is_empty() && !store.is_dir(&book.id, &parent_relative_path)? {
        return Err("父级目录不存在。".into());
    }
    let file_name = normalize_text_file_name(name)?;
    let next_path = join_relative_path(&parent_relative_path, &file_name);
    if store.exists(&book.id, &next_path)? {
        return Err("同名文件已存在。".into());
    }

    store.write_text(&book.id, &next_path, "")?;
    reindex_workspace_entry(store, &book.id, &next_path)?;
    store.touch(&book.id)?;
    Ok(display_path(&book.root_path, &next_path))
}

fn is_same_or_descendant_relative(path: &str, target: &str) -> bool {
    path == target || path.starts_with(&format!("{target}/"))
}

// —— 文件操作后的索引/关系维护（自愈）——
//
// 真实文件改动（rename/remove）是不可逆的、且先于索引与关系更新发生；这三步无法跨
// SQLite 事务原子化（fs 与 db 天然非事务）。为避免某一步失败后索引/关系与磁盘长期漂移，
// 这里在维护步骤失败时回退到「按当前磁盘状态全量重建索引」——文件系统是唯一事实源，
// 索引随时可由它重建。关系表无法从磁盘重建，故其更新失败时连同索引一起重建以恢复一致的
// 已知状态，并把原始错误返回给调用方（操作已生效，但需告知维护未完全成功）。

/// 重命名/移动后维护索引与关系；任一步失败则全量重建索引兜底。
fn maintain_after_rename(
    store: &WorkspaceStore,
    book_id: &str,
    old_path: &str,
    new_path: &str,
) -> CommandResult<()> {
    let outcome = (|| {
        reindex_subtree_after_rename(store, book_id, old_path, new_path)?;
        let connection = store.open_index(book_id)?;
        rename_entry_in_relations(&connection, old_path, new_path)
    })();
    if outcome.is_err() {
        // 兜底：以磁盘现状全量重建搜索索引,消除可能的漂移。关系表此时可能未完成迁移,
        // 但索引已与磁盘对齐;返回原始错误让上层感知维护未完全成功。
        let _ = rebuild_book_search_index(store, book_id);
    }
    outcome
}

/// 删除后维护索引与关系；任一步失败则全量重建索引兜底。
fn maintain_after_delete(
    store: &WorkspaceStore,
    book_id: &str,
    removed_path: &str,
) -> CommandResult<()> {
    let outcome = (|| {
        reindex_subtree_after_delete(store, book_id, removed_path)?;
        let connection = store.open_index(book_id)?;
        delete_relations_for_subtree(&connection, removed_path)
    })();
    if outcome.is_err() {
        let _ = rebuild_book_search_index(store, book_id);
    }
    outcome
}

pub(crate) fn rename_workspace_entry_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
    next_name: &str,
) -> CommandResult<String> {
    let book = load_book_by_id(store, book_id)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("不能重命名书籍根目录。".into());
    }
    let entry = store
        .entry_record(&book.id, &relative_path)?
        .ok_or_else(|| "目标路径不存在。".to_string())?;

    let target_name = build_rename_target_name(&entry.name, entry.kind == "directory", next_name)?;
    let target_path = join_relative_path(&parent_relative_path(&relative_path), &target_name);
    if target_path == relative_path {
        return Ok(display_path(&book.root_path, &target_path));
    }
    if store.exists(&book.id, &target_path)? {
        return Err("目标名称已存在。".into());
    }

    store.rename(&book.id, &relative_path, &target_path)?;
    maintain_after_rename(store, &book.id, &relative_path, &target_path)?;
    store.touch(&book.id)?;
    Ok(display_path(&book.root_path, &target_path))
}

pub(crate) fn move_workspace_entry_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
    target_parent_path: &str,
) -> CommandResult<String> {
    let book = load_book_by_id(store, book_id)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("不能迁移书籍根目录。".into());
    }
    let entry = store
        .entry_record(&book.id, &relative_path)?
        .ok_or_else(|| "目标路径不存在。".to_string())?;

    let target_parent_relative_path = resolve_relative_path(&book.root_path, target_parent_path)?;
    if !target_parent_relative_path.is_empty()
        && !store.is_dir(&book.id, &target_parent_relative_path)?
    {
        return Err("目标父级目录不存在。".into());
    }
    if entry.kind == "directory"
        && is_same_or_descendant_relative(&target_parent_relative_path, &relative_path)
    {
        return Err("不能将文件夹迁移到其自身或子目录中。".into());
    }

    let target_path = join_relative_path(&target_parent_relative_path, &entry.name);
    if target_path == relative_path {
        return Err("目标位置未变化。".into());
    }
    if store.exists(&book.id, &target_path)? {
        return Err("目标位置已存在同名文件或文件夹。".into());
    }

    store.rename(&book.id, &relative_path, &target_path)?;
    maintain_after_rename(store, &book.id, &relative_path, &target_path)?;
    store.touch(&book.id)?;
    Ok(display_path(&book.root_path, &target_path))
}

pub(crate) fn delete_workspace_entry_db(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
) -> CommandResult<()> {
    let book = load_book_by_id(store, book_id)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("不能删除书籍根目录。".into());
    }

    store.remove(&book.id, &relative_path)?;
    maintain_after_delete(store, &book.id, &relative_path)?;
    store.touch(&book.id)?;
    Ok(())
}
