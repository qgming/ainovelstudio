// 图书工作区：数据库表、记录类型、基础查询/插入辅助。

use crate::infrastructure::workspace_paths::{
    error_to_string, join_relative_path, parent_relative_path, validate_name, CommandResult,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;

pub(crate) const BOOK_ROOT_PREFIX: &str = "books";

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

#[derive(Clone)]
pub(crate) struct BookRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) root_path: String,
    pub(crate) updated_at: u64,
}

#[derive(Clone)]
pub(crate) struct WorkspaceEntryRecord {
    pub(crate) content_bytes: Vec<u8>,
    pub(crate) extension: Option<String>,
    pub(crate) kind: String,
    pub(crate) name: String,
    pub(crate) parent_path: String,
    pub(crate) path: String,
}

pub(crate) fn run_book_migrations(connection: &Connection) -> CommandResult<()> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS book_workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                root_path TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS book_workspace_entries (
                book_id TEXT NOT NULL,
                path TEXT NOT NULL,
                parent_path TEXT NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                extension TEXT,
                content_bytes BLOB NOT NULL DEFAULT X'',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY(book_id, path),
                FOREIGN KEY(book_id) REFERENCES book_workspaces(id) ON DELETE CASCADE,
                CHECK(kind IN ('directory', 'file'))
            );

            CREATE INDEX IF NOT EXISTS idx_book_workspaces_updated_at
            ON book_workspaces(updated_at DESC, name ASC);

            CREATE INDEX IF NOT EXISTS idx_book_workspace_entries_parent
            ON book_workspace_entries(book_id, parent_path);

            CREATE TABLE IF NOT EXISTS workspace_search_chunks (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                path TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                source_kind TEXT NOT NULL,
                section_title TEXT,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                char_start INTEGER NOT NULL,
                char_end INTEGER NOT NULL,
                token_estimate INTEGER NOT NULL,
                content_hash TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(book_id) REFERENCES book_workspaces(id) ON DELETE CASCADE
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_search_chunks_entry
            ON workspace_search_chunks(book_id, path, chunk_index);

            CREATE INDEX IF NOT EXISTS idx_workspace_search_chunks_path
            ON workspace_search_chunks(book_id, path, start_line);

            CREATE VIRTUAL TABLE IF NOT EXISTS workspace_search_chunks_fts
            USING fts5(
                chunk_id UNINDEXED,
                book_id UNINDEXED,
                path,
                source_kind,
                section_title,
                content,
                search_text,
                tokenize = 'unicode61 remove_diacritics 2'
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS workspace_search_paths_fts
            USING fts5(
                book_id UNINDEXED,
                path,
                name,
                source_kind,
                title_text,
                search_text,
                tokenize = 'unicode61 remove_diacritics 2'
            );

            -- 文件关联表:任意两个 entry 之间的无向关系,带自定义标签和备注
            -- 无向语义:始终保证 entry_a_path < entry_b_path(字典序),避免 (A,B) 和 (B,A) 重复
            CREATE TABLE IF NOT EXISTS book_workspace_relations (
                id TEXT PRIMARY KEY,
                book_id TEXT NOT NULL,
                entry_a_path TEXT NOT NULL,
                entry_b_path TEXT NOT NULL,
                relationship TEXT NOT NULL DEFAULT '',
                note TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(book_id) REFERENCES book_workspaces(id) ON DELETE CASCADE,
                UNIQUE(book_id, entry_a_path, entry_b_path, relationship)
            );

            CREATE INDEX IF NOT EXISTS idx_book_workspace_relations_a
            ON book_workspace_relations(book_id, entry_a_path);

            CREATE INDEX IF NOT EXISTS idx_book_workspace_relations_b
            ON book_workspace_relations(book_id, entry_b_path);
            "#,
        )
        .map_err(error_to_string)?;
    Ok(())
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

pub(crate) fn resolve_relative_path(book_root: &str, path: &str) -> CommandResult<String> {
    use crate::infrastructure::workspace_paths::normalize_workspace_path;
    let normalized = normalize_workspace_path(path);
    if normalized.is_empty() || normalized == "." || normalized == book_root {
        return Ok(String::new());
    }

    let root_prefix = format!("{book_root}/");
    if normalized.starts_with(&root_prefix) {
        return crate::infrastructure::workspace_paths::normalize_relative_path(
            &normalized[root_prefix.len()..],
        );
    }

    if normalized.starts_with(&format!("{BOOK_ROOT_PREFIX}/")) {
        return Err("目标路径不在当前书籍目录内。".into());
    }

    crate::infrastructure::workspace_paths::normalize_relative_path(&normalized)
}

pub(crate) fn map_book_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<BookRecord> {
    Ok(BookRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        updated_at: row.get::<_, i64>(3)? as u64,
    })
}

pub(crate) fn build_summary(book: &BookRecord) -> BookWorkspaceSummary {
    BookWorkspaceSummary {
        id: book.id.clone(),
        name: book.name.clone(),
        path: book.root_path.clone(),
        updated_at: book.updated_at,
    }
}

pub(crate) fn load_book_by_root_path(
    connection: &Connection,
    root_path: &str,
) -> CommandResult<BookRecord> {
    connection
        .query_row(
            "SELECT id, name, root_path, updated_at FROM book_workspaces WHERE root_path = ?1",
            params![root_path],
            map_book_record,
        )
        .optional()
        .map_err(error_to_string)?
        .ok_or_else(|| "目标书籍不存在。".to_string())
}

pub(crate) fn load_book_by_id(connection: &Connection, book_id: &str) -> CommandResult<BookRecord> {
    connection
        .query_row(
            "SELECT id, name, root_path, updated_at FROM book_workspaces WHERE id = ?1",
            params![book_id],
            map_book_record,
        )
        .optional()
        .map_err(error_to_string)?
        .ok_or_else(|| "目标书籍不存在。".to_string())
}

pub(crate) fn list_books(connection: &Connection) -> CommandResult<Vec<BookRecord>> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, root_path, updated_at FROM book_workspaces ORDER BY updated_at DESC, name ASC",
        )
        .map_err(error_to_string)?;

    let books = statement
        .query_map([], map_book_record)
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(books)
}

pub(crate) fn load_entry_record(
    connection: &Connection,
    book_id: &str,
    relative_path: &str,
) -> CommandResult<Option<WorkspaceEntryRecord>> {
    connection
        .query_row(
            r#"
            SELECT path, parent_path, name, kind, extension, content_bytes
            FROM book_workspace_entries
            WHERE book_id = ?1 AND path = ?2
            "#,
            params![book_id, relative_path],
            |row| {
                Ok(WorkspaceEntryRecord {
                    path: row.get(0)?,
                    parent_path: row.get(1)?,
                    name: row.get(2)?,
                    kind: row.get(3)?,
                    extension: row.get(4)?,
                    content_bytes: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(error_to_string)
}

pub(crate) fn ensure_entry_record(
    connection: &Connection,
    book_id: &str,
    relative_path: &str,
) -> CommandResult<WorkspaceEntryRecord> {
    load_entry_record(connection, book_id, relative_path)?
        .ok_or_else(|| "目标路径不存在。".to_string())
}

pub(crate) fn load_entry_records(
    connection: &Connection,
    book_id: &str,
) -> CommandResult<Vec<WorkspaceEntryRecord>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT path, parent_path, name, kind, extension, content_bytes
            FROM book_workspace_entries
            WHERE book_id = ?1
            ORDER BY path ASC
            "#,
        )
        .map_err(error_to_string)?;

    let entries = statement
        .query_map(params![book_id], |row| {
            Ok(WorkspaceEntryRecord {
                path: row.get(0)?,
                parent_path: row.get(1)?,
                name: row.get(2)?,
                kind: row.get(3)?,
                extension: row.get(4)?,
                content_bytes: row.get(5)?,
            })
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(entries)
}

pub(crate) fn load_subtree_records(
    connection: &Connection,
    book_id: &str,
    relative_path: &str,
) -> CommandResult<Vec<WorkspaceEntryRecord>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT path, parent_path, name, kind, extension, content_bytes
            FROM book_workspace_entries
            WHERE book_id = ?1
              AND (path = ?2 OR substr(path, 1, length(?2) + 1) = ?2 || '/')
            ORDER BY length(path) ASC, path ASC
            "#,
        )
        .map_err(error_to_string)?;

    let entries = statement
        .query_map(params![book_id, relative_path], |row| {
            Ok(WorkspaceEntryRecord {
                path: row.get(0)?,
                parent_path: row.get(1)?,
                name: row.get(2)?,
                kind: row.get(3)?,
                extension: row.get(4)?,
                content_bytes: row.get(5)?,
            })
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(entries)
}

pub(crate) fn insert_entry(
    transaction: &Transaction<'_>,
    book_id: &str,
    relative_path: &str,
    kind: &str,
    extension: Option<&str>,
    content_bytes: &[u8],
    timestamp: u64,
) -> CommandResult<()> {
    transaction
        .execute(
            r#"
            INSERT INTO book_workspace_entries (
                book_id,
                path,
                parent_path,
                name,
                kind,
                extension,
                content_bytes,
                created_at,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            params![
                book_id,
                relative_path,
                parent_relative_path(relative_path),
                crate::infrastructure::workspace_paths::entry_name_from_path(relative_path)?,
                kind,
                extension,
                content_bytes,
                timestamp as i64,
                timestamp as i64,
            ],
        )
        .map_err(error_to_string)?;
    Ok(())
}

pub(crate) fn ensure_directory_chain(
    transaction: &Transaction<'_>,
    book_id: &str,
    relative_path: &str,
    timestamp: u64,
) -> CommandResult<()> {
    if relative_path.is_empty() {
        return Ok(());
    }

    let mut current = String::new();
    for segment in relative_path
        .split('/')
        .filter(|segment| !segment.is_empty())
    {
        let validated = validate_name(segment)?;
        let next = join_relative_path(&current, &validated);
        match load_entry_record(transaction, book_id, &next)? {
            Some(entry) if entry.kind == "directory" => {}
            Some(_) => return Err("父级目录不存在。".into()),
            None => insert_entry(
                transaction,
                book_id,
                &next,
                "directory",
                None,
                &[],
                timestamp,
            )?,
        }
        current = next;
    }

    Ok(())
}

pub(crate) fn ensure_directory_exists(
    connection: &Connection,
    book_id: &str,
    relative_path: &str,
) -> CommandResult<()> {
    if relative_path.is_empty() {
        return Ok(());
    }

    let entry = ensure_entry_record(connection, book_id, relative_path)?;
    if entry.kind != "directory" {
        return Err("父级目录不存在。".into());
    }

    Ok(())
}

pub(crate) fn touch_book(
    transaction: &Transaction<'_>,
    book_id: &str,
    timestamp: u64,
) -> CommandResult<()> {
    transaction
        .execute(
            "UPDATE book_workspaces SET updated_at = ?1 WHERE id = ?2",
            params![timestamp as i64, book_id],
        )
        .map_err(error_to_string)?;
    Ok(())
}
