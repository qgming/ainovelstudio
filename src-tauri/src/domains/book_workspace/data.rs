// 图书工作区：记录类型、root_path 解析、book 元信息查询（基于真实文件存储）。
//
// CP-A 起，文件内容存真实磁盘（见 fs_store.rs），本文件只保留：
//   - 对外 DTO/记录类型（TreeNode / BookWorkspaceSummary / WorkspaceLineResult / BookRecord）
//   - root_path（books/<书名>）↔ book_id 的解析（经 WorkspaceStore 扫描 .meta.json）
//   - 相对路径解析辅助

use crate::domains::book_workspace::fs_store::{BookMeta, WorkspaceStore, BOOK_ROOT_PREFIX};
use crate::infrastructure::workspace_paths::CommandResult;
use serde::Serialize;

#[derive(Clone, Serialize)]
pub struct TreeNode {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) children: Option<Vec<TreeNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) extension: Option<String>,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookWorkspaceSummary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) updated_at: u64,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceLineResult {
    #[serde(rename = "lineNumber")]
    pub(crate) line_number: usize,
    pub(crate) path: String,
    pub(crate) text: String,
}

/// 书的逻辑记录：id + 名称 + 虚拟根路径（books/<名称>）+ 更新时间。
#[derive(Clone)]
pub(crate) struct BookRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) root_path: String,
    pub(crate) updated_at: u64,
}

impl BookRecord {
    pub(crate) fn from_meta(meta: BookMeta) -> Self {
        let root_path = build_book_root_path(&meta.name);
        Self {
            id: meta.id,
            name: meta.name,
            root_path,
            updated_at: meta.updated_at,
        }
    }
}

pub(crate) fn display_path(book_root: &str, relative_path: &str) -> String {
    if relative_path.is_empty() {
        book_root.to_string()
    } else {
        format!("{book_root}/{relative_path}")
    }
}

pub(crate) fn display_relative_path(relative_path: &str) -> String {
    if relative_path.is_empty() {
        ".".into()
    } else {
        relative_path.to_string()
    }
}

pub(crate) fn build_book_root_path(book_name: &str) -> String {
    format!("{BOOK_ROOT_PREFIX}/{book_name}")
}

/// 把传入路径（可能是 books/<书名>/相对、绝对虚拟路径、或纯相对）解析为书内相对路径。
pub(crate) fn resolve_relative_path(book_root: &str, path: &str) -> CommandResult<String> {
    use crate::infrastructure::workspace_paths::{
        normalize_relative_path, normalize_workspace_path,
    };
    let normalized = normalize_workspace_path(path);
    if normalized.is_empty() || normalized == "." || normalized == book_root {
        return Ok(String::new());
    }

    let root_prefix = format!("{book_root}/");
    if normalized.starts_with(&root_prefix) {
        return normalize_relative_path(&normalized[root_prefix.len()..]);
    }

    if normalized.starts_with(&format!("{BOOK_ROOT_PREFIX}/")) {
        return Err("目标路径不在当前书籍目录内。".into());
    }

    normalize_relative_path(&normalized)
}

pub(crate) fn build_summary(book: &BookRecord) -> BookWorkspaceSummary {
    BookWorkspaceSummary {
        id: book.id.clone(),
        name: book.name.clone(),
        path: book.root_path.clone(),
        updated_at: book.updated_at,
    }
}

pub(crate) fn load_book_by_id(store: &WorkspaceStore, book_id: &str) -> CommandResult<BookRecord> {
    store.read_meta(book_id).map(BookRecord::from_meta)
}

pub(crate) fn list_books(store: &WorkspaceStore) -> CommandResult<Vec<BookRecord>> {
    Ok(store
        .list_books()?
        .into_iter()
        .map(BookRecord::from_meta)
        .collect())
}
