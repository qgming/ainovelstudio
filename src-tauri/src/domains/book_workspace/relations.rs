// 图书工作区:文件关联表(无向多对多)的 CRUD 与级联辅助。
//
// 设计要点:
// - CP-A 起,关联表落在 per-book 的 .index.db 里(见 fs_store.rs / index_schema.rs),
//   整库只属于一本书,因此表里不再有 book_id 列,所有 SQL 也不再按 book_id 过滤。
// - 无向语义通过插入前规范化 (entry_a_path < entry_b_path) 保证,避免存出 (A,B) 和 (B,A) 重复。
// - 同一对文件可以拥有多条不同 relationship 标签的关联(UNIQUE 包含 relationship)。
// - 重命名/移动/删除 entry 时,本模块提供配套的级联函数供 ops.rs 在打开 per-book 连接后调用。
// - 底层 CRUD 只接收一个已打开的 per-book &Connection;path 校验(真实文件是否存在)与
//   touch 书元信息都需要 WorkspaceStore,故放在 *_by_root 包装层完成。

use crate::domains::book_workspace::data::{load_book_by_id, resolve_relative_path};
use crate::domains::book_workspace::fs_store::WorkspaceStore;
use crate::infrastructure::workspace_paths::{error_to_string, now_timestamp, CommandResult};
use rusqlite::{params, Connection, OptionalExtension};
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

// SELECT 列顺序固定为:id, entry_a_path, entry_b_path, relationship, note, updated_at(无 book_id)。
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
    entry_path: &str,
) -> CommandResult<Vec<RelationDto>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, entry_a_path, entry_b_path, relationship, note, updated_at
            FROM book_workspace_relations
            WHERE entry_a_path = ?1 OR entry_b_path = ?1
            ORDER BY updated_at DESC, id ASC
            "#,
        )
        .map_err(error_to_string)?;

    let relations = statement
        .query_map(params![entry_path], map_relation_row)
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(relations)
}

// 列出本书全部关联,用于前端一次性载入缓存。
pub(crate) fn list_all_relations(connection: &Connection) -> CommandResult<Vec<RelationDto>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT id, entry_a_path, entry_b_path, relationship, note, updated_at
            FROM book_workspace_relations
            ORDER BY updated_at DESC, id ASC
            "#,
        )
        .map_err(error_to_string)?;

    let relations = statement
        .query_map([], map_relation_row)
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    Ok(relations)
}

fn load_relation_by_id(connection: &Connection, relation_id: &str) -> CommandResult<RelationDto> {
    connection
        .query_row(
            r#"
            SELECT id, entry_a_path, entry_b_path, relationship, note, updated_at
            FROM book_workspace_relations
            WHERE id = ?1
            "#,
            params![relation_id],
            map_relation_row,
        )
        .optional()
        .map_err(error_to_string)?
        .ok_or_else(|| "目标关联不存在。".to_string())
}

// 创建关联;若同一对 (a,b,relationship) 已存在,返回错误而非重复插入。
pub(crate) fn create_relation(
    connection: &Connection,
    path_a: &str,
    path_b: &str,
    relationship: &str,
    note: Option<&str>,
) -> CommandResult<RelationDto> {
    if path_a == path_b {
        return Err("不能给同一个文件建立自关联。".into());
    }

    let (entry_a, entry_b) = normalize_pair(path_a, path_b);

    let trimmed_relationship = relationship.trim();
    let normalized_note = note.map(str::trim).filter(|value| !value.is_empty());

    // 提前查重,给出更友好的错误信息(避免直接抛 UNIQUE 约束失败)。
    let duplicate: Option<i64> = connection
        .query_row(
            r#"
            SELECT 1 FROM book_workspace_relations
            WHERE entry_a_path = ?1
              AND entry_b_path = ?2
              AND relationship = ?3
            "#,
            params![entry_a, entry_b, trimmed_relationship],
            |row| row.get(0),
        )
        .optional()
        .map_err(error_to_string)?;
    if duplicate.is_some() {
        return Err("这两个文件之间已经存在相同标签的关联。".into());
    }

    let timestamp = now_timestamp();
    let relation_id = Uuid::new_v4().to_string();

    connection
        .execute(
            r#"
            INSERT INTO book_workspace_relations (
                id, entry_a_path, entry_b_path, relationship, note,
                created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            "#,
            params![
                relation_id,
                entry_a,
                entry_b,
                trimmed_relationship,
                normalized_note,
                timestamp as i64,
            ],
        )
        .map_err(error_to_string)?;

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
    connection: &Connection,
    relation_id: &str,
    relationship: Option<&str>,
    note: Option<Option<&str>>,
) -> CommandResult<RelationDto> {
    let current = load_relation_by_id(connection, relation_id)?;

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
        let duplicate: Option<i64> = connection
            .query_row(
                r#"
                SELECT 1 FROM book_workspace_relations
                WHERE entry_a_path = ?1
                  AND entry_b_path = ?2
                  AND relationship = ?3
                  AND id <> ?4
                "#,
                params![
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
    connection
        .execute(
            r#"
            UPDATE book_workspace_relations
            SET relationship = ?1, note = ?2, updated_at = ?3
            WHERE id = ?4
            "#,
            params![next_relationship, next_note, timestamp as i64, relation_id,],
        )
        .map_err(error_to_string)?;

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
pub(crate) fn delete_relation(connection: &Connection, relation_id: &str) -> CommandResult<()> {
    let _ = load_relation_by_id(connection, relation_id)?;

    connection
        .execute(
            "DELETE FROM book_workspace_relations WHERE id = ?1",
            params![relation_id],
        )
        .map_err(error_to_string)?;

    Ok(())
}

// 重命名/移动 entry 时,把所有引用旧路径的关联改为新路径,并维持 a<b 规范化。
// old_path 既可以是文件,也可以是目录;目录会带子树的前缀替换。
pub(crate) fn rename_entry_in_relations(
    connection: &Connection,
    old_path: &str,
    new_path: &str,
) -> CommandResult<()> {
    if old_path == new_path {
        return Ok(());
    }

    let timestamp = now_timestamp();
    // 子树前缀用 "old_path/" 做精确前缀比较,避免 LIKE 把路径里的 _ / % 当通配符
    // (本应用模板/文件名常含下划线,如 第001章_章名.md,LIKE 会误伤兄弟节点)。
    let subtree_prefix = format!("{old_path}/");
    // SQLite substr 以"字符"计长,故用字符数而非字节数,保证非 ASCII(中文)路径正确截断。
    let prefix_len = subtree_prefix.chars().count() as i64;

    // 对 a 列和 b 列分别替换;substr 用于在子树命中时拼接出新前缀路径。
    // CASE:精确匹配旧路径 → 替换为新路径;子树前缀命中 → 新前缀 + 旧后缀。
    // 子树判定用 substr(path,1,prefix_len)=subtree_prefix 取代 LIKE。
    let sql = r#"
        UPDATE book_workspace_relations
        SET entry_a_path = CASE
                WHEN entry_a_path = ?1 THEN ?2
                WHEN substr(entry_a_path, 1, ?4) = ?3 THEN ?2 || substr(entry_a_path, ?4)
                ELSE entry_a_path
            END,
            entry_b_path = CASE
                WHEN entry_b_path = ?1 THEN ?2
                WHEN substr(entry_b_path, 1, ?4) = ?3 THEN ?2 || substr(entry_b_path, ?4)
                ELSE entry_b_path
            END,
            updated_at = ?5
        WHERE entry_a_path = ?1 OR substr(entry_a_path, 1, ?4) = ?3
           OR entry_b_path = ?1 OR substr(entry_b_path, 1, ?4) = ?3
    "#;

    connection
        .execute(
            sql,
            params![
                old_path,
                new_path,
                subtree_prefix,
                prefix_len,
                timestamp as i64,
            ],
        )
        .map_err(error_to_string)?;

    // 替换后可能破坏 a<b 规范化;统一交换打破规范化的行。
    let swap_sql = r#"
        UPDATE book_workspace_relations
        SET entry_a_path = entry_b_path,
            entry_b_path = entry_a_path,
            updated_at = ?1
        WHERE entry_a_path > entry_b_path
    "#;
    connection
        .execute(swap_sql, params![timestamp as i64])
        .map_err(error_to_string)?;

    // 交换后可能与已有行产生 UNIQUE 冲突,但 sqlite 在 UPDATE 时会报错;
    // 这种情形极少见(只发生在同时存在 (a,b) 和 (b,a) 等价边时,而无向规范化保证这不会发生)。

    // 自关联(同一文件 a==b)清理:重命名后可能让两边变成同一路径,删除即可。
    connection
        .execute(
            r#"
            DELETE FROM book_workspace_relations
            WHERE entry_a_path = entry_b_path
            "#,
            [],
        )
        .map_err(error_to_string)?;

    Ok(())
}

// 删除某个 entry(或目录子树)对应的所有关联。
pub(crate) fn delete_relations_for_subtree(
    connection: &Connection,
    root_path: &str,
) -> CommandResult<()> {
    // 子树前缀精确比较,避免 LIKE 把路径里的 _ / % 当通配符误删兄弟节点关联。
    let subtree_prefix = format!("{root_path}/");
    let prefix_len = subtree_prefix.chars().count() as i64;
    connection
        .execute(
            r#"
            DELETE FROM book_workspace_relations
            WHERE entry_a_path = ?1 OR substr(entry_a_path, 1, ?3) = ?2
               OR entry_b_path = ?1 OR substr(entry_b_path, 1, ?3) = ?2
            "#,
            params![root_path, subtree_prefix, prefix_len],
        )
        .map_err(error_to_string)?;
    Ok(())
}

// —— 高阶包装:供 commands.rs 使用,封装"按 book_id 取书 + 打开 per-book 库 + 校验路径"。 ——
// 这一层持有 WorkspaceStore,负责:解析 book、打开 .index.db、用真实文件存在性校验 path、
// 操作后 store.touch 更新书元信息时间戳;底层 CRUD 只管纯 SQL。

pub(crate) fn list_entry_relations_by_root(
    store: &WorkspaceStore,
    book_id: &str,
    entry_path: &str,
) -> CommandResult<Vec<RelationDto>> {
    let book = load_book_by_id(store, book_id)?;
    let relative = resolve_relative_path(&book.root_path, entry_path)?;
    let connection = store.open_index(&book.id)?;
    list_relations_for_entry(&connection, &relative)
}

pub(crate) fn list_book_relations_by_root(
    store: &WorkspaceStore,
    book_id: &str,
) -> CommandResult<Vec<RelationDto>> {
    let book = load_book_by_id(store, book_id)?;
    let connection = store.open_index(&book.id)?;
    list_all_relations(&connection)
}

pub(crate) fn create_relation_by_root(
    store: &WorkspaceStore,
    book_id: &str,
    entry_a_path: &str,
    entry_b_path: &str,
    relationship: &str,
    note: Option<&str>,
) -> CommandResult<RelationDto> {
    let book = load_book_by_id(store, book_id)?;
    let relative_a = resolve_relative_path(&book.root_path, entry_a_path)?;
    let relative_b = resolve_relative_path(&book.root_path, entry_b_path)?;

    // 用真实文件存在性校验,避免创建悬空关联(替代旧 book_workspace_entries 查询)。
    if !store.exists(&book.id, &relative_a)? || !store.exists(&book.id, &relative_b)? {
        return Err("目标路径不存在。".into());
    }

    let connection = store.open_index(&book.id)?;
    let relation = create_relation(&connection, &relative_a, &relative_b, relationship, note)?;
    store.touch(&book.id)?;
    Ok(relation)
}

pub(crate) fn update_relation_by_root(
    store: &WorkspaceStore,
    book_id: &str,
    relation_id: &str,
    relationship: Option<&str>,
    note: Option<Option<&str>>,
) -> CommandResult<RelationDto> {
    let book = load_book_by_id(store, book_id)?;
    let connection = store.open_index(&book.id)?;
    let relation = update_relation(&connection, relation_id, relationship, note)?;
    store.touch(&book.id)?;
    Ok(relation)
}

pub(crate) fn delete_relation_by_root(
    store: &WorkspaceStore,
    book_id: &str,
    relation_id: &str,
) -> CommandResult<()> {
    let book = load_book_by_id(store, book_id)?;
    let connection = store.open_index(&book.id)?;
    delete_relation(&connection, relation_id)?;
    store.touch(&book.id)?;
    Ok(())
}
