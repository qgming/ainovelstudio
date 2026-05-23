// 图书工作区:文件关联表(无向多对多)的 CRUD 与级联辅助。
//
// 设计要点:
// - 无向语义通过插入前规范化 (entry_a_path < entry_b_path) 保证,避免存出 (A,B) 和 (B,A) 重复。
// - 同一对文件可以拥有多条不同 relationship 标签的关联(UNIQUE 包含 relationship)。
// - 重命名/移动/删除 entry 时,本模块提供配套的级联函数供 ops.rs 在同一事务中调用。

use crate::domains::book_workspace::data::{
    load_book_by_root_path, resolve_relative_path, touch_book,
};
use crate::infrastructure::workspace_paths::{error_to_string, now_timestamp, CommandResult};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use uuid::Uuid;

// 关联记录的 DTO,序列化为 camelCase 给前端使用。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationDto {
    pub(crate) id: String,
    pub(crate) entry_a_path: String,
    pub(crate) entry_b_path: String,
    pub(crate) relationship: String,
    pub(crate) note: Option<String>,
    pub(crate) updated_at: u64,
}

// 规范化两个 path 顺序,确保 a <= b(字典序),实现无向语义。
pub(crate) fn normalize_pair(path_a: &str, path_b: &str) -> (String, String) {
    if path_a <= path_b {
        (path_a.to_string(), path_b.to_string())
    } else {
        (path_b.to_string(), path_a.to_string())
    }
}

fn map_relation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RelationDto> {
    Ok(RelationDto {
        id: row.get(0)?,
        entry_a_path: row.get(1)?,
        entry_b_path: row.get(2)?,
        relationship: row.get(3)?,
        note: row.get(4)?,
        updated_at: row.get::<_, i64>(5)? as u64,
    })
}

// 列出某个 entry 涉及的所有关联(无论 entry 在 a 还是 b 侧)。
pub(crate) fn list_relations_for_entry(
    connection: &Connection,
    book_id: &str,
    entry_path: &str,
) -> CommandResult<Vec<RelationDto>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, entry_a_path, entry_b_path, relationship, note, updated_at
            FROM book_workspace_relations
            WHERE book_id = ?1
              AND (entry_a_path = ?2 OR entry_b_path = ?2)
            ORDER BY updated_at DESC, id ASC
            "#,
        )
        .map_err(error_to_string)?;

    let relations = statement
        .query_map(params![book_id, entry_path], map_relation_row)
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(relations)
}

// 列出本书全部关联,用于前端一次性载入缓存。
pub(crate) fn list_all_relations(
    connection: &Connection,
    book_id: &str,
) -> CommandResult<Vec<RelationDto>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, entry_a_path, entry_b_path, relationship, note, updated_at
            FROM book_workspace_relations
            WHERE book_id = ?1
            ORDER BY updated_at DESC, id ASC
            "#,
        )
        .map_err(error_to_string)?;

    let relations = statement
        .query_map(params![book_id], map_relation_row)
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(relations)
}

fn load_relation_by_id(
    connection: &Connection,
    book_id: &str,
    relation_id: &str,
) -> CommandResult<RelationDto> {
    connection
        .query_row(
            r#"
            SELECT id, entry_a_path, entry_b_path, relationship, note, updated_at
            FROM book_workspace_relations
            WHERE book_id = ?1 AND id = ?2
            "#,
            params![book_id, relation_id],
            map_relation_row,
        )
        .optional()
        .map_err(error_to_string)?
        .ok_or_else(|| "目标关联不存在。".to_string())
}

// 校验 entry 确实存在于本书中,避免创建悬空关联。
fn ensure_entry_exists(
    connection: &Connection,
    book_id: &str,
    relative_path: &str,
) -> CommandResult<()> {
    let exists: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM book_workspace_entries WHERE book_id = ?1 AND path = ?2",
            params![book_id, relative_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(error_to_string)?;

    if exists.is_some() {
        Ok(())
    } else {
        Err("目标路径不存在。".into())
    }
}

// 创建关联;若同一对 (a,b,relationship) 已存在,返回错误而非重复插入。
pub(crate) fn create_relation(
    transaction: &Transaction<'_>,
    book_id: &str,
    path_a: &str,
    path_b: &str,
    relationship: &str,
    note: Option<&str>,
) -> CommandResult<RelationDto> {
    if path_a == path_b {
        return Err("不能给同一个文件建立自关联。".into());
    }

    let (entry_a, entry_b) = normalize_pair(path_a, path_b);
    ensure_entry_exists(transaction, book_id, &entry_a)?;
    ensure_entry_exists(transaction, book_id, &entry_b)?;

    let trimmed_relationship = relationship.trim();
    let normalized_note = note.map(str::trim).filter(|value| !value.is_empty());

    // 提前查重,给出更友好的错误信息(避免直接抛 UNIQUE 约束失败)。
    let duplicate: Option<i64> = transaction
        .query_row(
            r#"
            SELECT 1 FROM book_workspace_relations
            WHERE book_id = ?1
              AND entry_a_path = ?2
              AND entry_b_path = ?3
              AND relationship = ?4
            "#,
            params![book_id, entry_a, entry_b, trimmed_relationship],
            |row| row.get(0),
        )
        .optional()
        .map_err(error_to_string)?;
    if duplicate.is_some() {
        return Err("这两个文件之间已经存在相同标签的关联。".into());
    }

    let timestamp = now_timestamp();
    let relation_id = Uuid::new_v4().to_string();

    transaction
        .execute(
            r#"
            INSERT INTO book_workspace_relations (
                id, book_id, entry_a_path, entry_b_path, relationship, note,
                created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
            "#,
            params![
                relation_id,
                book_id,
                entry_a,
                entry_b,
                trimmed_relationship,
                normalized_note,
                timestamp as i64,
            ],
        )
        .map_err(error_to_string)?;

    touch_book(transaction, book_id, timestamp)?;

    Ok(RelationDto {
        id: relation_id,
        entry_a_path: entry_a,
        entry_b_path: entry_b,
        relationship: trimmed_relationship.to_string(),
        note: normalized_note.map(str::to_string),
        updated_at: timestamp,
    })
}

// 更新关联的 relationship 或 note;两个字段都为 None 时视为无操作。
pub(crate) fn update_relation(
    transaction: &Transaction<'_>,
    book_id: &str,
    relation_id: &str,
    relationship: Option<&str>,
    note: Option<Option<&str>>,
) -> CommandResult<RelationDto> {
    let current = load_relation_by_id(transaction, book_id, relation_id)?;

    let next_relationship = relationship
        .map(str::trim)
        .map(str::to_string)
        .unwrap_or_else(|| current.relationship.clone());

    // note 的三态:None=不修改,Some(None)=清空,Some(Some(x))=改为 x。
    let next_note = match note {
        None => current.note.clone(),
        Some(None) => None,
        Some(Some(value)) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
    };

    // 若改后的 (a,b,relationship) 与其它关联冲突,提前报错。
    if next_relationship != current.relationship {
        let duplicate: Option<i64> = transaction
            .query_row(
                r#"
                SELECT 1 FROM book_workspace_relations
                WHERE book_id = ?1
                  AND entry_a_path = ?2
                  AND entry_b_path = ?3
                  AND relationship = ?4
                  AND id <> ?5
                "#,
                params![
                    book_id,
                    current.entry_a_path,
                    current.entry_b_path,
                    next_relationship,
                    relation_id,
                ],
                |row| row.get(0),
            )
            .optional()
            .map_err(error_to_string)?;
        if duplicate.is_some() {
            return Err("这两个文件之间已经存在相同标签的关联。".into());
        }
    }

    let timestamp = now_timestamp();
    transaction
        .execute(
            r#"
            UPDATE book_workspace_relations
            SET relationship = ?1, note = ?2, updated_at = ?3
            WHERE book_id = ?4 AND id = ?5
            "#,
            params![
                next_relationship,
                next_note,
                timestamp as i64,
                book_id,
                relation_id,
            ],
        )
        .map_err(error_to_string)?;

    touch_book(transaction, book_id, timestamp)?;

    Ok(RelationDto {
        id: current.id,
        entry_a_path: current.entry_a_path,
        entry_b_path: current.entry_b_path,
        relationship: next_relationship,
        note: next_note,
        updated_at: timestamp,
    })
}

// 删除单条关联。
pub(crate) fn delete_relation(
    transaction: &Transaction<'_>,
    book_id: &str,
    relation_id: &str,
) -> CommandResult<()> {
    let _ = load_relation_by_id(transaction, book_id, relation_id)?;
    let timestamp = now_timestamp();

    transaction
        .execute(
            "DELETE FROM book_workspace_relations WHERE book_id = ?1 AND id = ?2",
            params![book_id, relation_id],
        )
        .map_err(error_to_string)?;

    touch_book(transaction, book_id, timestamp)?;
    Ok(())
}

// 重命名/移动 entry 时,把所有引用旧路径的关联改为新路径,并维持 a<b 规范化。
// old_path 既可以是文件,也可以是目录;目录会带子树的 LIKE 前缀替换。
pub(crate) fn rename_entry_in_relations(
    transaction: &Transaction<'_>,
    book_id: &str,
    old_path: &str,
    new_path: &str,
) -> CommandResult<()> {
    if old_path == new_path {
        return Ok(());
    }

    let timestamp = now_timestamp();
    let like_pattern = format!("{old_path}/%");
    let old_prefix_len = old_path.len() as i64;

    // 对 a 列和 b 列分别替换;sqlite 的 substr 用于在子树 LIKE 命中时拼接出新前缀路径。
    // CASE:精确匹配旧路径 → 替换为新路径;LIKE 子树 → 新前缀 + 旧后缀。
    let sql = r#"
        UPDATE book_workspace_relations
        SET entry_a_path = CASE
                WHEN entry_a_path = ?1 THEN ?2
                WHEN entry_a_path LIKE ?3 THEN ?2 || substr(entry_a_path, ?4 + 1)
                ELSE entry_a_path
            END,
            entry_b_path = CASE
                WHEN entry_b_path = ?1 THEN ?2
                WHEN entry_b_path LIKE ?3 THEN ?2 || substr(entry_b_path, ?4 + 1)
                ELSE entry_b_path
            END,
            updated_at = ?5
        WHERE book_id = ?6
          AND (
              entry_a_path = ?1 OR entry_a_path LIKE ?3
              OR entry_b_path = ?1 OR entry_b_path LIKE ?3
          )
    "#;

    transaction
        .execute(
            sql,
            params![
                old_path,
                new_path,
                like_pattern,
                old_prefix_len,
                timestamp as i64,
                book_id,
            ],
        )
        .map_err(error_to_string)?;

    // 替换后可能破坏 a<b 规范化;统一交换打破规范化的行。
    let swap_sql = r#"
        UPDATE book_workspace_relations
        SET entry_a_path = entry_b_path,
            entry_b_path = entry_a_path,
            updated_at = ?2
        WHERE book_id = ?1 AND entry_a_path > entry_b_path
    "#;
    transaction
        .execute(swap_sql, params![book_id, timestamp as i64])
        .map_err(error_to_string)?;

    // 交换后可能与已有行产生 UNIQUE 冲突,但 sqlite 在 UPDATE 时会报错;
    // 这种情形极少见(只发生在同时存在 (a,b) 和 (b,a) 等价边时,而无向规范化保证这不会发生)。

    // 自关联(同一文件 a==b)清理:重命名后可能让两边变成同一路径,删除即可。
    transaction
        .execute(
            r#"
            DELETE FROM book_workspace_relations
            WHERE book_id = ?1 AND entry_a_path = entry_b_path
            "#,
            params![book_id],
        )
        .map_err(error_to_string)?;

    Ok(())
}

// 删除某个 entry(或目录子树)对应的所有关联。
pub(crate) fn delete_relations_for_subtree(
    transaction: &Transaction<'_>,
    book_id: &str,
    root_path: &str,
) -> CommandResult<()> {
    let like_pattern = format!("{root_path}/%");
    transaction
        .execute(
            r#"
            DELETE FROM book_workspace_relations
            WHERE book_id = ?1
              AND (
                  entry_a_path = ?2 OR entry_a_path LIKE ?3
                  OR entry_b_path = ?2 OR entry_b_path LIKE ?3
              )
            "#,
            params![book_id, root_path, like_pattern],
        )
        .map_err(error_to_string)?;
    Ok(())
}

// —— 高阶包装:供 commands.rs 使用,封装"按 root_path 取 book_id + 校验路径"。 ——

pub(crate) fn list_entry_relations_by_root(
    connection: &Connection,
    root_path: &str,
    entry_path: &str,
) -> CommandResult<Vec<RelationDto>> {
    let book = load_book_by_root_path(connection, root_path)?;
    let relative = resolve_relative_path(&book.root_path, entry_path)?;
    list_relations_for_entry(connection, &book.id, &relative)
}

pub(crate) fn list_book_relations_by_root(
    connection: &Connection,
    root_path: &str,
) -> CommandResult<Vec<RelationDto>> {
    let book = load_book_by_root_path(connection, root_path)?;
    list_all_relations(connection, &book.id)
}

pub(crate) fn create_relation_by_root(
    transaction: &Transaction<'_>,
    root_path: &str,
    entry_a_path: &str,
    entry_b_path: &str,
    relationship: &str,
    note: Option<&str>,
) -> CommandResult<RelationDto> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_a = resolve_relative_path(&book.root_path, entry_a_path)?;
    let relative_b = resolve_relative_path(&book.root_path, entry_b_path)?;
    create_relation(
        transaction,
        &book.id,
        &relative_a,
        &relative_b,
        relationship,
        note,
    )
}

pub(crate) fn update_relation_by_root(
    transaction: &Transaction<'_>,
    root_path: &str,
    relation_id: &str,
    relationship: Option<&str>,
    note: Option<Option<&str>>,
) -> CommandResult<RelationDto> {
    let book = load_book_by_root_path(transaction, root_path)?;
    update_relation(transaction, &book.id, relation_id, relationship, note)
}

pub(crate) fn delete_relation_by_root(
    transaction: &Transaction<'_>,
    root_path: &str,
    relation_id: &str,
) -> CommandResult<()> {
    let book = load_book_by_root_path(transaction, root_path)?;
    delete_relation(transaction, &book.id, relation_id)
}
