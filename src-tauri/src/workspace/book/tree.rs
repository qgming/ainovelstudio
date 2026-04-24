// 图书工作区：目录树构建 + 内容搜索。

use crate::workspace::book::data::{
    load_book_by_root_path, load_entry_records, TreeNode, WorkspaceEntryRecord,
    WorkspaceSearchMatch,
};
use crate::workspace::book::data::display_relative_path;
use crate::workspace::common::{bytes_to_text, check_cancellation, CommandResult};
use crate::ToolCancellationRegistry;
use rusqlite::Connection;
use std::collections::HashMap;

const DEFAULT_SEARCH_LIMIT: usize = 50;
const MAX_SEARCH_LIMIT: usize = 200;

fn sort_tree_nodes(nodes: &mut [TreeNode]) {
    nodes.sort_by(|left, right| {
        let left_rank = if left.kind == "directory" { 0 } else { 1 };
        let right_rank = if right.kind == "directory" { 0 } else { 1 };
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
}

fn build_tree_node(
    book_root: &str,
    entry: &WorkspaceEntryRecord,
    grouped_entries: &HashMap<String, Vec<WorkspaceEntryRecord>>,
) -> TreeNode {
    let mut node = TreeNode {
        children: None,
        extension: entry.extension.clone(),
        kind: entry.kind.clone(),
        name: entry.name.clone(),
        path: crate::workspace::book::data::display_path(book_root, &entry.path),
    };

    if entry.kind == "directory" {
        let mut children = grouped_entries
            .get(&entry.path)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .map(|child| build_tree_node(book_root, &child, grouped_entries))
            .collect::<Vec<_>>();
        sort_tree_nodes(&mut children);
        if !children.is_empty() {
            node.children = Some(children);
        }
    }

    node
}

pub(crate) fn read_workspace_tree_db(
    connection: &Connection,
    root_path: &str,
) -> CommandResult<TreeNode> {
    let book = load_book_by_root_path(connection, root_path)?;
    let entries = load_entry_records(connection, &book.id)?;
    let mut grouped_entries = HashMap::<String, Vec<WorkspaceEntryRecord>>::new();
    for entry in entries {
        grouped_entries
            .entry(entry.parent_path.clone())
            .or_default()
            .push(entry);
    }

    let mut children = grouped_entries
        .get("")
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|entry| build_tree_node(&book.root_path, &entry, &grouped_entries))
        .collect::<Vec<_>>();
    sort_tree_nodes(&mut children);

    Ok(TreeNode {
        children: if children.is_empty() {
            None
        } else {
            Some(children)
        },
        extension: None,
        kind: "directory".into(),
        name: book.name,
        path: book.root_path,
    })
}

fn normalize_search_query(value: &str) -> CommandResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("搜索关键词不能为空。".into());
    }
    Ok(trimmed.to_lowercase())
}

fn normalize_search_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT)
}

fn push_search_match(
    matches: &mut Vec<WorkspaceSearchMatch>,
    match_type: &str,
    path: String,
    line_number: Option<usize>,
    line_text: Option<String>,
    limit: usize,
) -> bool {
    if matches.len() >= limit {
        return true;
    }

    matches.push(WorkspaceSearchMatch {
        line_number,
        line_text,
        match_type: match_type.into(),
        path,
    });

    matches.len() >= limit
}

pub(crate) fn search_workspace_content_db(
    connection: &Connection,
    root_path: &str,
    query: &str,
    limit: Option<usize>,
    registry: &ToolCancellationRegistry,
    request_id: Option<&str>,
) -> CommandResult<Vec<WorkspaceSearchMatch>> {
    let book = load_book_by_root_path(connection, root_path)?;
    let normalized_query = normalize_search_query(query)?;
    let normalized_limit = normalize_search_limit(limit);
    let mut matches = Vec::new();

    for entry in load_entry_records(connection, &book.id)? {
        check_cancellation(registry, request_id)?;
        let normalized_name = entry.name.to_lowercase();
        if entry.kind == "directory" && normalized_name.contains(&normalized_query) {
            if push_search_match(
                &mut matches,
                "directory_name",
                display_relative_path(&entry.path),
                None,
                None,
                normalized_limit,
            ) {
                break;
            }
            continue;
        }

        if entry.kind == "file" && normalized_name.contains(&normalized_query) {
            if push_search_match(
                &mut matches,
                "file_name",
                display_relative_path(&entry.path),
                None,
                None,
                normalized_limit,
            ) {
                break;
            }
        }

        if entry.kind != "file" {
            continue;
        }
        let Ok(contents) = bytes_to_text(entry.content_bytes) else {
            continue;
        };
        for (index, line) in contents.lines().enumerate() {
            check_cancellation(registry, request_id)?;
            if !line.to_lowercase().contains(&normalized_query) {
                continue;
            }
            if push_search_match(
                &mut matches,
                "content",
                display_relative_path(&entry.path),
                Some(index + 1),
                Some(line.to_string()),
                normalized_limit,
            ) {
                return Ok(matches);
            }
        }
    }

    Ok(matches)
}
