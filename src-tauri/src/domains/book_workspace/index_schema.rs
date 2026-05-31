// 图书工作区：per-book 索引库（.index.db）的表结构。
//
// 每本书自带一个独立的 .index.db，存放：
//   - FTS5 全文检索索引（chunks + paths）
//   - 文件关联图谱（无向多对多）
// 因为整库只属于一本书，所有表都不再带 book_id 列（与旧全局 app.db schema 的区别）。

use crate::infrastructure::workspace_paths::{error_to_string, CommandResult};
use rusqlite::Connection;

pub(crate) fn ensure_index_schema(connection: &Connection) -> CommandResult<()> {
    connection
        .execute_batch(
            r#"
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS workspace_search_chunks (
                id TEXT PRIMARY KEY,
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
                updated_at INTEGER NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_search_chunks_entry
            ON workspace_search_chunks(path, chunk_index);

            CREATE INDEX IF NOT EXISTS idx_workspace_search_chunks_path
            ON workspace_search_chunks(path, start_line);

            CREATE VIRTUAL TABLE IF NOT EXISTS workspace_search_chunks_fts
            USING fts5(
                chunk_id UNINDEXED,
                path,
                source_kind,
                section_title,
                content,
                search_text,
                tokenize = 'unicode61 remove_diacritics 2'
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS workspace_search_paths_fts
            USING fts5(
                path,
                name,
                source_kind,
                title_text,
                search_text,
                tokenize = 'unicode61 remove_diacritics 2'
            );

            -- 文件关联表（无向多对多），保证 entry_a_path < entry_b_path（字典序）。
            CREATE TABLE IF NOT EXISTS book_workspace_relations (
                id TEXT PRIMARY KEY,
                entry_a_path TEXT NOT NULL,
                entry_b_path TEXT NOT NULL,
                relationship TEXT NOT NULL DEFAULT '',
                note TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(entry_a_path, entry_b_path, relationship)
            );

            CREATE INDEX IF NOT EXISTS idx_book_workspace_relations_a
            ON book_workspace_relations(entry_a_path);

            CREATE INDEX IF NOT EXISTS idx_book_workspace_relations_b
            ON book_workspace_relations(entry_b_path);
            "#,
        )
        .map_err(error_to_string)?;
    Ok(())
}
