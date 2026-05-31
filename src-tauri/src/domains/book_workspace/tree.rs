// 图书工作区：目录树构建（遍历真实文件目录）。

use crate::domains::book_workspace::data::{load_book_by_id, TreeNode};
use crate::domains::book_workspace::fs_store::{WorkspaceEntry, WorkspaceStore};
use crate::infrastructure::workspace_paths::CommandResult;

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

/// 递归构建一个条目的树节点；目录会继续向下遍历真实子目录。
fn build_tree_node(
    store: &WorkspaceStore,
    book_id: &str,
    book_root: &str,
    entry: &WorkspaceEntry,
) -> CommandResult<TreeNode> {
    let mut node = TreeNode {
        children: None,
        extension: entry.extension.clone(),
        kind: entry.kind.clone(),
        name: entry.name.clone(),
        path: crate::domains::book_workspace::data::display_path(book_root, &entry.path),
    };

    if entry.kind == "directory" {
        let mut children = Vec::new();
        for child in store.list_dir(book_id, &entry.path)? {
            children.push(build_tree_node(store, book_id, book_root, &child)?);
        }
        sort_tree_nodes(&mut children);
        if !children.is_empty() {
            node.children = Some(children);
        }
    }

    Ok(node)
}

pub(crate) fn read_workspace_tree_db(
    store: &WorkspaceStore,
    book_id: &str,
) -> CommandResult<TreeNode> {
    let book = load_book_by_id(store, book_id)?;

    let mut children = Vec::new();
    for entry in store.list_dir(&book.id, "")? {
        children.push(build_tree_node(store, &book.id, &book.root_path, &entry)?);
    }
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
