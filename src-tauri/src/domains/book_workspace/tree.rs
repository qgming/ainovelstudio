// 图书工作区：目录树构建 + 内容搜索。

use crate::domains::book_workspace::data::{
    load_book_by_root_path, load_entry_records, TreeNode, WorkspaceEntryRecord,
};
use crate::infrastructure::workspace_paths::CommandResult;
use rusqlite::Connection;
use std::collections::HashMap;

#[path = "natural_sort.rs"]
mod natural_sort;
use natural_sort::natural_name_cmp;

fn sort_tree_nodes(nodes: &mut [TreeNode]) {
    nodes.sort_by(|left, right| {
        let left_rank = if left.kind == "directory" { 0 } else { 1 };
        let right_rank = if right.kind == "directory" { 0 } else { 1 };
        left_rank
            .cmp(&right_rank)
            .then_with(|| natural_name_cmp(&left.name, &right.name))
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
        path: crate::domains::book_workspace::data::display_path(book_root, &entry.path),
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
