// 扩写模式（expansion）后端：独立于图书工作区，同库不同表。
// 结构：每本"扩写书籍"固定三段
//   project/   -> AGENTS.md、README.md、outline.md（Markdown 文本）
//   settings/  -> 多个设定 JSON
//   chapters/  -> 多个章节 JSON
// 数据落地到 expansion_workspaces + expansion_entries 两张表。

use crate::db::open_database;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    io::{Cursor, Read, Write},
    path::Path,
};
use tauri::AppHandle;
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

type CommandResult<T> = Result<T, String>;

const INVALID_NAME_CHARS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const SECTIONS: [&str; 3] = ["project", "settings", "chapters"];
const DEFAULT_SETTING_CATEGORIES: [&str; 6] = ["人物", "势力", "地点", "世界观", "道具", "其他"];
const DEFAULT_SETTING_CATEGORY: &str = "其他";
const MAX_ARCHIVE_ENTRIES: usize = 5_000;
const MAX_ARCHIVE_FILE_SIZE: u64 = 10 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_SIZE: u64 = 256 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpansionWorkspaceSummary {
    id: String,
    name: String,
    updated_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpansionEntryItem {
    section: String,
    name: String,
    // 对 project 段是文件相对路径（如 "AGENTS.md"）
    // 对 settings 段是 <编号>-<名称>
    // 对 chapters 段是 <名称>（导出时会写成 <名称>.json）
    path: String,
    entry_id: Option<String>,
    updated_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpansionWorkspaceDetail {
    id: String,
    name: String,
    updated_at: u64,
    project_entries: Vec<ExpansionEntryItem>,
    setting_entries: Vec<ExpansionEntryItem>,
    chapter_entries: Vec<ExpansionEntryItem>,
}

#[derive(Clone)]
struct ExpansionRecord {
    id: String,
    name: String,
    updated_at: u64,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn now_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn validate_name(value: &str) -> CommandResult<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空。".into());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("名称不能是 . 或 ..。".into());
    }
    if trimmed
        .chars()
        .any(|character| INVALID_NAME_CHARS.contains(&character))
    {
        return Err("名称不能包含 < > : \" / \\ | ? *。".into());
    }
    Ok(trimmed.to_string())
}

fn validate_section(section: &str) -> CommandResult<()> {
    if SECTIONS.contains(&section) {
        Ok(())
    } else {
        Err("非法的分区。".into())
    }
}

pub(crate) fn run_expansion_migrations(connection: &Connection) -> CommandResult<()> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS expansion_workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS expansion_entries (
                workspace_id TEXT NOT NULL,
                section TEXT NOT NULL,
                path TEXT NOT NULL,
                name TEXT NOT NULL,
                content_bytes BLOB NOT NULL DEFAULT X'',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY(workspace_id, section, path),
                FOREIGN KEY(workspace_id) REFERENCES expansion_workspaces(id) ON DELETE CASCADE,
                CHECK(section IN ('project', 'settings', 'chapters'))
            );

            CREATE INDEX IF NOT EXISTS idx_expansion_workspaces_updated_at
            ON expansion_workspaces(updated_at DESC, name ASC);

            CREATE INDEX IF NOT EXISTS idx_expansion_entries_section
            ON expansion_entries(workspace_id, section);
            "#,
        )
        .map_err(error_to_string)?;
    Ok(())
}

// ---- project 默认模板 ----

fn create_agents_template(book_name: &str) -> String {
    format!(
        "# {book_name} · 扩写项目 AGENTS\n\n本文件用于说明扩写工作区的结构、工具约定、读写规则和回写要求。作品本身的题材、卖点、人物、风格、阶段目标和当前推进状态，统一写在 `README.md`；全书剧情大纲写在 `outline.md`。\n\n## 建议起手读取顺序\n1. `AGENTS.md`：理解扩写工作区结构、工具边界和写回规则。\n2. `README.md`：理解作品定位、核心卖点、人物关系、风格和当前重点。\n3. `outline.md`：理解全书主线、阶段划分、冲突升级和结局方向。\n4. 相关设定 JSON、章节细纲、章节正文：进入具体生成或修改。\n\n## 工作区说明\n- `project/AGENTS.md`：操作规则、工具约定、字段边界、回写要求。\n- `project/README.md`：作品说明；记录题材、卖点、风格、人物关系、当前阶段和推进重点。\n- `project/outline.md`：全书总纲；用于拆分分卷、章节细纲和校准剧情方向。\n- `settings/<分类>/*.json`：设定真值层；用于人物、地点、势力、世界观、道具等资料沉淀。\n- `chapters/<分卷>/*.json`：章节真值层；每章包含 `id`、`name`、`outline`、`content`。\n\n## AI 协作约定\n1. 进入任务后，先读取本文件，再按需读取 `README.md`、`outline.md` 和相关 JSON。\n2. 写细纲前先读取本章关联的设定 JSON、README 和 outline。\n3. 写正文前先读取本章细纲、相关设定和必要前文。\n4. `settings.content`、`chapters.outline`、`chapters.content` 都使用 Markdown 文本。\n5. 所有生成内容回写对应 JSON 字段，不直接修改编号与名称，也不要把 Markdown 内容包在代码块里。\n6. 作品定位、风格、人物关系、阶段重点变化后，主动更新 `README.md`；设定和剧情事实变化后，同步回写对应 JSON。\n"
    )
}

fn create_readme_template(book_name: &str) -> String {
    format!(
        "# {book_name} · 扩写项目 README\n\n本文件用于记录这部作品本身的信息。扩写模式下，AI 会默认读取本文件来理解题材方向、剧情目标、人物关系、写作风格和当前推进重点。工作区规则查看 `AGENTS.md`，全书剧情总纲查看 `outline.md`。\n\n## 作品定位\n- 书名：`{book_name}`\n- 题材：待补充\n- 细分赛道：待补充\n- 目标读者：待补充\n- 目标篇幅：待补充\n- 核心卖点：待补充\n- 一句话 premise：待补充\n\n## 故事总览\n- 主角：待补充\n- 主角目标：待补充\n- 核心冲突：待补充\n- 主要对手 / 阻力：待补充\n- 阶段升级路径：待补充\n- 结局方向：待补充\n\n## 角色与风格\n- 关键人物关系：待补充\n- 叙事视角：待补充\n- 写作风格：待补充\n- 节奏要求：待补充\n- 禁写约束：待补充\n\n## 当前推进重点\n- 当前阶段：构思中\n- 当前卷 / 当前章节：待补充\n- 本轮优先事项：先补齐作品定位和全书大纲，再批量生成设定与细纲\n- 当前风险：待补充\n\n## 维护提醒\n- 题材方向、角色关系、风格基线和阶段目标变化后，及时更新本文件。\n- 更细的剧情拆分写入 `outline.md`，更细的设定与连续性事实写入 `settings/` 和 `chapters/` JSON。\n"
    )
}

fn create_outline_template(book_name: &str) -> String {
    format!(
        "# {book_name} · 全书分卷大纲\n\n本文件用于给扩写模式提供可拆分的分卷式总纲。建议先补齐全书主线，再按卷填写每卷目标、核心冲突、阶段推进和章节拆分。批量生成细纲前，优先把每卷的章节列表补到可直接拆章的程度。\n\n## 全书总览\n- 主线：待补充\n- 主角目标：待补充\n- 核心冲突：待补充\n- 长线悬念：待补充\n- 力量 / 关系 / 阵营升级主轴：待补充\n- 结局方向：待补充\n\n## 分卷规划总表\n- 预计卷数：3 卷起步，可按实际扩展\n- 第一卷定位：开局立钩子，完成主角起势和核心矛盾引爆\n- 第二卷定位：扩大冲突面，抬升对手层级和代价\n- 第三卷定位：进入阶段高潮，兑现前期伏笔并打开新局面\n\n## 第一卷：待补充卷名\n- 卷定位：开篇立世界规则、主角处境和第一阶段目标\n- 卷目标：待补充\n- 卷核心冲突：待补充\n- 卷内升级点：待补充\n- 卷末钩子 / 卷末爆点：待补充\n- 关键出场人物 / 势力 / 道具：待补充\n\n### 第一卷章节拆分\n- 第1章：待补充\n- 第2章：待补充\n- 第3章：待补充\n- 第4章：待补充\n- 第5章：待补充\n\n## 第二卷：待补充卷名\n- 卷定位：扩大地图、对手和资源争夺，推动主线进入中段\n- 卷目标：待补充\n- 卷核心冲突：待补充\n- 卷内升级点：待补充\n- 卷末钩子 / 卷末爆点：待补充\n- 关键新增人物 / 势力 / 设定：待补充\n\n### 第二卷章节拆分\n- 第1章：待补充\n- 第2章：待补充\n- 第3章：待补充\n- 第4章：待补充\n- 第5章：待补充\n\n## 第三卷：待补充卷名\n- 卷定位：进入阶段高潮，兑现旧伏笔并抬升后续主线天花板\n- 卷目标：待补充\n- 卷核心冲突：待补充\n- 卷内升级点：待补充\n- 卷末钩子 / 卷末爆点：待补充\n- 关键回收伏笔：待补充\n\n### 第三卷章节拆分\n- 第1章：待补充\n- 第2章：待补充\n- 第3章：待补充\n- 第4章：待补充\n- 第5章：待补充\n"
    )
}

fn create_chapter_meta_template() -> String {
    "{\n  \"volumes\": []\n}\n".to_string()
}

fn create_setting_meta_template() -> String {
    let categories = DEFAULT_SETTING_CATEGORIES
        .iter()
        .map(|item| format!("    \"{item}\""))
        .collect::<Vec<_>>()
        .join(",\n");
    format!("{{\n  \"categories\": [\n{categories}\n  ]\n}}\n")
}

fn build_project_template(book_name: &str) -> Vec<(&'static str, String)> {
    vec![
        ("AGENTS.md", create_agents_template(book_name)),
        ("README.md", create_readme_template(book_name)),
        ("outline.md", create_outline_template(book_name)),
        ("chapters.meta.json", create_chapter_meta_template()),
        ("settings.meta.json", create_setting_meta_template()),
    ]
}

// ---- 查询 ----

fn map_workspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExpansionRecord> {
    Ok(ExpansionRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        updated_at: row.get::<_, i64>(2)? as u64,
    })
}

fn load_workspace_by_id(connection: &Connection, id: &str) -> CommandResult<ExpansionRecord> {
    connection
        .query_row(
            "SELECT id, name, updated_at FROM expansion_workspaces WHERE id = ?1",
            params![id],
            map_workspace,
        )
        .optional()
        .map_err(error_to_string)?
        .ok_or_else(|| "目标扩写书籍不存在。".to_string())
}

fn list_workspaces(connection: &Connection) -> CommandResult<Vec<ExpansionRecord>> {
    let mut statement = connection
        .prepare(
            "SELECT id, name, updated_at FROM expansion_workspaces ORDER BY updated_at DESC, name ASC",
        )
        .map_err(error_to_string)?;
    let rows = statement
        .query_map([], map_workspace)
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;
    Ok(rows)
}

fn list_entries(
    connection: &Connection,
    workspace_id: &str,
    section: &str,
) -> CommandResult<Vec<ExpansionEntryItem>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT section, name, path, updated_at, content_bytes
            FROM expansion_entries
            WHERE workspace_id = ?1 AND section = ?2
            ORDER BY path ASC
            "#,
        )
        .map_err(error_to_string)?;

    let mut rows = statement
        .query_map(params![workspace_id, section], |row| {
            let path = row.get::<_, String>(2)?;
            let content_bytes = row.get::<_, Vec<u8>>(4)?;
            Ok(ExpansionEntryItem {
                section: row.get(0)?,
                name: row.get(1)?,
                path: path.clone(),
                entry_id: extract_entry_id(section, &path, &content_bytes),
                updated_at: row.get::<_, i64>(3)? as u64,
            })
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;
    if section == "settings" {
        rows.sort_by(|left, right| {
            let left_category = get_setting_category_from_path(&left.path);
            let right_category = get_setting_category_from_path(&right.path);
            let left_id = left
                .entry_id
                .as_deref()
                .and_then(parse_numeric_id)
                .unwrap_or(u32::MAX);
            let right_id = right
                .entry_id
                .as_deref()
                .and_then(parse_numeric_id)
                .unwrap_or(u32::MAX);
            left_category
                .cmp(&right_category)
                .then_with(|| left_id.cmp(&right_id))
                .then_with(|| left.name.cmp(&right.name))
                .then_with(|| left.path.cmp(&right.path))
        });
    }
    if section == "chapters" {
        rows.sort_by(|left, right| {
            let left_id = left
                .entry_id
                .as_deref()
                .and_then(parse_numeric_id)
                .unwrap_or(u32::MAX);
            let right_id = right
                .entry_id
                .as_deref()
                .and_then(parse_numeric_id)
                .unwrap_or(u32::MAX);
            left_id
                .cmp(&right_id)
                .then_with(|| left.name.cmp(&right.name))
                .then_with(|| left.path.cmp(&right.path))
        });
    }
    Ok(rows)
}

// ---- 增删改 ----

fn insert_entry(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    section: &str,
    path: &str,
    name: &str,
    content: &[u8],
    timestamp: u64,
) -> CommandResult<()> {
    transaction
        .execute(
            r#"
            INSERT INTO expansion_entries
            (workspace_id, section, path, name, content_bytes, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                workspace_id,
                section,
                path,
                name,
                content,
                timestamp as i64,
                timestamp as i64,
            ],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn touch_workspace(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    timestamp: u64,
) -> CommandResult<()> {
    transaction
        .execute(
            "UPDATE expansion_workspaces SET updated_at = ?1 WHERE id = ?2",
            params![timestamp as i64, workspace_id],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn create_workspace_internal(
    transaction: &Transaction<'_>,
    book_name: &str,
) -> CommandResult<ExpansionRecord> {
    let validated = validate_name(book_name)?;
    let existing = transaction
        .query_row(
            "SELECT id FROM expansion_workspaces WHERE name = ?1",
            params![validated],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?;
    if existing.is_some() {
        return Err("同名扩写书籍已存在。".into());
    }

    let timestamp = now_timestamp();
    let record = ExpansionRecord {
        id: Uuid::new_v4().to_string(),
        name: validated.clone(),
        updated_at: timestamp,
    };
    transaction
        .execute(
            "INSERT INTO expansion_workspaces (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                record.id,
                record.name,
                timestamp as i64,
                timestamp as i64,
            ],
        )
        .map_err(error_to_string)?;

    for (path, content) in build_project_template(&validated) {
        insert_entry(
            transaction,
            &record.id,
            "project",
            path,
            path,
            content.as_bytes(),
            timestamp,
        )?;
    }

    Ok(record)
}

fn load_entry_content(
    connection: &Connection,
    workspace_id: &str,
    section: &str,
    path: &str,
) -> CommandResult<Vec<u8>> {
    connection
        .query_row(
            "SELECT content_bytes FROM expansion_entries WHERE workspace_id = ?1 AND section = ?2 AND path = ?3",
            params![workspace_id, section, path],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(error_to_string)?
        .ok_or_else(|| "目标条目不存在。".into())
}

fn write_entry_content(
    transaction: &Transaction<'_>,
    workspace_id: &str,
    section: &str,
    path: &str,
    content: &[u8],
    name_override: Option<&str>,
) -> CommandResult<()> {
    let timestamp = now_timestamp();
    let affected = match name_override {
        Some(name) => transaction
            .execute(
                r#"
                UPDATE expansion_entries
                SET content_bytes = ?1, name = ?2, updated_at = ?3
                WHERE workspace_id = ?4 AND section = ?5 AND path = ?6
                "#,
                params![content, name, timestamp as i64, workspace_id, section, path],
            )
            .map_err(error_to_string)?,
        None => transaction
            .execute(
                r#"
                UPDATE expansion_entries
                SET content_bytes = ?1, updated_at = ?2
                WHERE workspace_id = ?3 AND section = ?4 AND path = ?5
                "#,
                params![content, timestamp as i64, workspace_id, section, path],
            )
            .map_err(error_to_string)?,
    };
    if affected == 0
        && section == "project"
        && (path == "chapters.meta.json" || path == "settings.meta.json")
    {
        insert_entry(
            transaction,
            workspace_id,
            section,
            path,
            name_override.unwrap_or(path),
            content,
            timestamp,
        )?;
        touch_workspace(transaction, workspace_id, timestamp)?;
        return Ok(());
    }
    if affected == 0 {
        return Err("目标条目不存在。".into());
    }
    touch_workspace(transaction, workspace_id, timestamp)?;
    Ok(())
}

fn allocate_next_numeric_id(
    connection: &Connection,
    workspace_id: &str,
    section: &str,
) -> CommandResult<String> {
    let mut statement = connection
        .prepare(
            "SELECT path, content_bytes FROM expansion_entries WHERE workspace_id = ?1 AND section = ?2",
        )
        .map_err(error_to_string)?;
    let entries = statement
        .query_map(params![workspace_id, section], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    let mut used = HashSet::<u32>::new();
    for (path, content) in entries {
        if let Some(value) = extract_entry_id(section, &path, &content)
            .as_deref()
            .and_then(parse_numeric_id)
        {
            used.insert(value);
        }
    }
    let mut next = 1u32;
    while used.contains(&next) {
        next += 1;
    }
    Ok(next.to_string())
}

fn parse_numeric_id(value: &str) -> Option<u32> {
    value.trim().parse::<u32>().ok().or_else(|| {
        let head: String = value.chars().take_while(|c| c.is_ascii_digit()).collect();
        head.parse::<u32>().ok()
    })
}

fn get_setting_category_from_path(path: &str) -> String {
    path.split_once('/')
        .map(|(category, _)| category.trim().to_string())
        .filter(|category| !category.is_empty())
        .unwrap_or_else(|| DEFAULT_SETTING_CATEGORY.to_string())
}

fn normalize_setting_category(value: &str) -> CommandResult<String> {
    let validated = validate_name(value)?;
    if DEFAULT_SETTING_CATEGORIES
        .iter()
        .any(|item| *item == validated.as_str())
    {
        Ok(validated)
    } else {
        Err("设定分类不受支持。".into())
    }
}

fn extract_json_string_field(content: &[u8], field: &str) -> Option<String> {
    let value = serde_json::from_slice::<Value>(content).ok()?;
    let text = value.get(field)?.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.to_string())
}

fn extract_entry_id(section: &str, path: &str, content: &[u8]) -> Option<String> {
    extract_json_string_field(content, "id")
        .filter(|value| value.chars().all(|character| character.is_ascii_digit()))
        .or_else(|| {
            if section == "settings" {
                let file_name = path.rsplit('/').next().unwrap_or(path);
                let head: String = file_name.chars().take_while(|c| c.is_ascii_digit()).collect();
                if head.is_empty() {
                    None
                } else {
                    Some(head)
                }
            } else {
                None
            }
        })
}

fn rewrite_json_name_field(content: &[u8], next_name: &str) -> Option<Vec<u8>> {
    let mut value = serde_json::from_slice::<Value>(content).ok()?;
    let object = value.as_object_mut()?;
    object.insert("name".to_string(), Value::String(next_name.to_string()));
    let mut bytes = serde_json::to_vec_pretty(&value).ok()?;
    bytes.push(b'\n');
    Some(bytes)
}

fn default_setting_template(id: &str, name: &str) -> String {
    format!(
        "{{\n  \"id\": \"{id}\",\n  \"name\": \"{name}\",\n  \"content\": \"\"\n}}\n"
    )
}

fn default_chapter_template(id: &str, name: &str) -> String {
    format!(
        "{{\n  \"id\": \"{id}\",\n  \"name\": \"{name}\",\n  \"outline\": \"\",\n  \"content\": \"\"\n}}\n"
    )
}

fn build_setting_entry_path(parent_path: Option<&str>, numeric_id: &str, name: &str) -> String {
    let category = parent_path
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_SETTING_CATEGORY);
    format!("{category}/{numeric_id}-{name}")
}

fn build_chapter_entry_path(parent_path: Option<&str>, name: &str) -> String {
    match parent_path {
        Some(parent) if !parent.trim().is_empty() => {
            format!("{}/{}", parent.trim_matches('/'), name)
        }
        _ => name.to_string(),
    }
}

// ---- 命令入口 ----

fn with_transaction<T, F>(app: &AppHandle, operation: F) -> CommandResult<T>
where
    F: FnOnce(&Transaction<'_>) -> CommandResult<T>,
{
    let mut connection = open_database(app)?;
    let transaction = connection.transaction().map_err(error_to_string)?;
    let result = operation(&transaction)?;
    transaction.commit().map_err(error_to_string)?;
    Ok(result)
}

fn build_summary(record: &ExpansionRecord) -> ExpansionWorkspaceSummary {
    ExpansionWorkspaceSummary {
        id: record.id.clone(),
        name: record.name.clone(),
        updated_at: record.updated_at,
    }
}

#[tauri::command]
pub fn list_expansion_workspaces(app: AppHandle) -> CommandResult<Vec<ExpansionWorkspaceSummary>> {
    let connection = open_database(&app)?;
    Ok(list_workspaces(&connection)?
        .into_iter()
        .map(|record| build_summary(&record))
        .collect())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_expansion_workspace(
    app: AppHandle,
    bookName: String,
) -> CommandResult<ExpansionWorkspaceSummary> {
    with_transaction(&app, |transaction| {
        create_workspace_internal(transaction, &bookName).map(|record| build_summary(&record))
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_expansion_workspace(app: AppHandle, workspaceId: String) -> CommandResult<()> {
    with_transaction(&app, |transaction| {
        transaction
            .execute(
                "DELETE FROM expansion_workspaces WHERE id = ?1",
                params![workspaceId],
            )
            .map_err(error_to_string)?;
        Ok(())
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_expansion_workspace_detail(
    app: AppHandle,
    workspaceId: String,
) -> CommandResult<ExpansionWorkspaceDetail> {
    let connection = open_database(&app)?;
    let record = load_workspace_by_id(&connection, &workspaceId)?;
    Ok(ExpansionWorkspaceDetail {
        id: record.id.clone(),
        name: record.name.clone(),
        updated_at: record.updated_at,
        project_entries: list_entries(&connection, &record.id, "project")?,
        setting_entries: list_entries(&connection, &record.id, "settings")?,
        chapter_entries: list_entries(&connection, &record.id, "chapters")?,
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_expansion_entry(
    app: AppHandle,
    workspaceId: String,
    section: String,
    path: String,
) -> CommandResult<String> {
    validate_section(&section)?;
    let connection = open_database(&app)?;
    let bytes = load_entry_content(&connection, &workspaceId, &section, &path)?;
    String::from_utf8(bytes).map_err(|_| "条目不是 UTF-8 文本。".into())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_expansion_entry(
    app: AppHandle,
    workspaceId: String,
    section: String,
    path: String,
    contents: String,
) -> CommandResult<()> {
    validate_section(&section)?;
    with_transaction(&app, |transaction| {
        write_entry_content(
            transaction,
            &workspaceId,
            &section,
            &path,
            contents.as_bytes(),
            None,
        )
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_expansion_entry(
    app: AppHandle,
    workspaceId: String,
    section: String,
    name: String,
    parentPath: Option<String>,
) -> CommandResult<ExpansionEntryItem> {
    validate_section(&section)?;
    if section == "project" {
        return Err("project 分区的条目为固定模板，不能新建。".into());
    }
    let validated_name = validate_name(&name)?;
    let setting_parent = if section == "settings" {
        parentPath
            .as_deref()
            .map(normalize_setting_category)
            .transpose()?
    } else {
        None
    };
    let chapter_parent = if section == "chapters" {
        parentPath
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(|value| {
                if value.chars().all(|character| character.is_ascii_digit()) {
                    Ok(value)
                } else {
                    Err("分卷目录只能使用纯数字名称。".to_string())
                }
            })
            .transpose()?
    } else {
        None
    };

    with_transaction(&app, |transaction| {
        let _ = load_workspace_by_id(transaction, &workspaceId)?;
        let numeric_id = allocate_next_numeric_id(transaction, &workspaceId, &section)?;
        let path = if section == "settings" {
            build_setting_entry_path(setting_parent.as_deref(), &numeric_id, &validated_name)
        } else {
            build_chapter_entry_path(chapter_parent.as_deref(), &validated_name)
        };
        let timestamp = now_timestamp();
        let content = if section == "settings" {
            default_setting_template(&numeric_id, &validated_name)
        } else {
            default_chapter_template(&numeric_id, &validated_name)
        };

        insert_entry(
            transaction,
            &workspaceId,
            &section,
            &path,
            &validated_name,
            content.as_bytes(),
            timestamp,
        )?;
        touch_workspace(transaction, &workspaceId, timestamp)?;

        Ok(ExpansionEntryItem {
            section: section.clone(),
            name: validated_name,
            path,
            entry_id: Some(numeric_id),
            updated_at: timestamp,
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_expansion_entry(
    app: AppHandle,
    workspaceId: String,
    section: String,
    path: String,
) -> CommandResult<()> {
    validate_section(&section)?;
    if section == "project" {
        return Err("project 分区的条目为固定模板，不能删除。".into());
    }
    with_transaction(&app, |transaction| {
        let affected = transaction
            .execute(
                "DELETE FROM expansion_entries WHERE workspace_id = ?1 AND section = ?2 AND path = ?3",
                params![workspaceId, section, path],
            )
            .map_err(error_to_string)?;
        if affected == 0 {
            return Err("目标条目不存在。".into());
        }
        touch_workspace(transaction, &workspaceId, now_timestamp())?;
        Ok(())
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn rename_expansion_entry(
    app: AppHandle,
    workspaceId: String,
    section: String,
    path: String,
    nextName: String,
) -> CommandResult<ExpansionEntryItem> {
    validate_section(&section)?;
    if section == "project" {
        return Err("project 分区的条目不能重命名。".into());
    }
    let validated = validate_name(&nextName)?;
    with_transaction(&app, |transaction| {
        let existing_content = load_entry_content(transaction, &workspaceId, &section, &path)?;
        let entry_id = extract_entry_id(&section, &path, &existing_content);
        let new_path = if section == "settings" {
            let numeric_id = entry_id
                .clone()
                .ok_or_else(|| "路径格式异常，无法解析编号。".to_string())?;
            let parent = path.split_once('/').map(|(prefix, _)| prefix.to_string());
            build_setting_entry_path(parent.as_deref(), &numeric_id, &validated)
        } else {
            let parent = path.rsplit_once('/').map(|(prefix, _)| prefix.to_string());
            build_chapter_entry_path(parent.as_deref(), &validated)
        };
        if new_path != path {
            // 检查冲突
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM expansion_entries WHERE workspace_id = ?1 AND section = ?2 AND path = ?3",
                    params![workspaceId, section, new_path],
                    |_| Ok(()),
                )
                .optional()
                .map_err(error_to_string)?;
            if exists.is_some() {
                return Err("同名条目已存在。".into());
            }
        }

        let timestamp = now_timestamp();
        let rewritten_content =
            rewrite_json_name_field(&existing_content, &validated).unwrap_or(existing_content);
        transaction
            .execute(
                r#"
                UPDATE expansion_entries
                SET path = ?1, name = ?2, content_bytes = ?3, updated_at = ?4
                WHERE workspace_id = ?5 AND section = ?6 AND path = ?7
                "#,
                params![
                    new_path,
                    validated,
                    rewritten_content,
                    timestamp as i64,
                    workspaceId,
                    section,
                    path
                ],
            )
            .map_err(error_to_string)?;
        touch_workspace(transaction, &workspaceId, timestamp)?;

        Ok(ExpansionEntryItem {
            section: section.clone(),
            name: validated,
            path: new_path,
            entry_id: entry_id.clone(),
            updated_at: timestamp,
        })
    })
}

// ---- ZIP 导入导出 ----

fn is_ignored_archive_path(path: &str) -> bool {
    path.split('/')
        .any(|segment| segment == "__MACOSX" || segment == ".DS_Store" || segment == "Thumbs.db")
}

fn normalize_archive_path(value: &str) -> String {
    value.replace('\\', "/").trim_end_matches('/').to_string()
}

fn collect_volume_directories(all_entries: &[(String, String, Vec<u8>)]) -> Vec<String> {
    let mut volumes = HashSet::<String>::new();
    for (section, path, content) in all_entries {
        if section == "chapters" {
            if let Some((volume, _)) = path.split_once('/') {
                if !volume.trim().is_empty() {
                    volumes.insert(volume.trim().to_string());
                }
            }
            continue;
        }
        if section == "project" && path == "chapters.meta.json" {
            if let Ok(value) = serde_json::from_slice::<Value>(content) {
                if let Some(items) = value.get("volumes").and_then(|volumes| volumes.as_array()) {
                    for item in items {
                        if let Some(volume) = item.as_str() {
                            let trimmed = volume.trim();
                            if !trimmed.is_empty() {
                                volumes.insert(trimmed.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    let mut result = volumes.into_iter().collect::<Vec<_>>();
    result.sort();
    result
}

fn collect_setting_directories(all_entries: &[(String, String, Vec<u8>)]) -> Vec<String> {
    let mut categories = HashSet::<String>::new();
    for (section, path, content) in all_entries {
        if section == "settings" {
            if let Some((category, _)) = path.split_once('/') {
                if !category.trim().is_empty() {
                    categories.insert(category.trim().to_string());
                }
            }
            continue;
        }
        if section == "project" && path == "settings.meta.json" {
            if let Ok(value) = serde_json::from_slice::<Value>(content) {
                if let Some(items) = value.get("categories").and_then(|categories| categories.as_array()) {
                    for item in items {
                        if let Some(category) = item.as_str() {
                            let trimmed = category.trim();
                            if !trimmed.is_empty() {
                                categories.insert(trimmed.to_string());
                            }
                        }
                    }
                }
            }
        }
    }
    let mut result = categories.into_iter().collect::<Vec<_>>();
    result.sort();
    result
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn export_expansion_zip(
    app: AppHandle,
    workspaceId: String,
) -> CommandResult<Option<String>> {
    let (archive_bytes, book_name) = {
        let connection = open_database(&app)?;
        let record = load_workspace_by_id(&connection, &workspaceId)?;
        let mut all_entries = Vec::new();
        for section in SECTIONS.iter() {
            let mut statement = connection
                .prepare(
                    "SELECT section, path, content_bytes FROM expansion_entries WHERE workspace_id = ?1 AND section = ?2 ORDER BY path ASC",
                )
                .map_err(error_to_string)?;
            let rows = statement
                .query_map(params![record.id, section], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Vec<u8>>(2)?,
                    ))
                })
                .map_err(error_to_string)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(error_to_string)?;
            all_entries.extend(rows);
        }

        let cursor = Cursor::new(Vec::<u8>::new());
        let mut archive = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for section in SECTIONS.iter() {
            archive
                .add_directory(format!("{}/{}/", record.name, section), options)
                .map_err(error_to_string)?;
        }
        for volume_id in collect_volume_directories(&all_entries) {
            archive
                .add_directory(format!("{}/chapters/{}/", record.name, volume_id), options)
                .map_err(error_to_string)?;
        }
        for category in collect_setting_directories(&all_entries) {
            archive
                .add_directory(format!("{}/settings/{}/", record.name, category), options)
                .map_err(error_to_string)?;
        }
        for (section, path, content) in all_entries {
            let file_path = if section == "project" {
                format!("{}/{}/{}", record.name, section, path)
            } else {
                format!("{}/{}/{}.json", record.name, section, path)
            };
            archive
                .start_file(file_path, options)
                .map_err(error_to_string)?;
            archive.write_all(&content).map_err(error_to_string)?;
        }
        let bytes = archive
            .finish()
            .map_err(error_to_string)?
            .into_inner();
        (bytes, record.name)
    };

    #[cfg(desktop)]
    {
        let default_file_name = format!("{}.expansion.zip", book_name);
        let save_path = app
            .dialog()
            .file()
            .set_file_name(&default_file_name)
            .add_filter("ZIP 压缩包", &["zip"])
            .blocking_save_file()
            .and_then(|path| path.into_path().ok());
        let Some(save_path) = save_path else {
            return Ok(None);
        };
        let final_path = if save_path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.eq_ignore_ascii_case("zip"))
            == Some(true)
        {
            save_path
        } else {
            save_path.with_extension("zip")
        };
        std::fs::write(&final_path, archive_bytes).map_err(error_to_string)?;
        return Ok(Some(final_path.to_string_lossy().replace('\\', "/")));
    }

    #[cfg(mobile)]
    {
        let _ = app;
        let _ = archive_bytes;
        let _ = book_name;
        Err("当前平台暂不支持导出扩写 ZIP。".into())
    }
}

fn derive_imported_name(file_name: &str) -> CommandResult<String> {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .trim()
        .trim_end_matches(".expansion");
    let candidate = if stem.is_empty() { "未命名扩写" } else { stem };
    validate_name(candidate)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn import_expansion_zip(
    app: AppHandle,
    fileName: String,
    archiveBytes: Vec<u8>,
) -> CommandResult<ExpansionWorkspaceSummary> {
    if Path::new(&fileName)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("zip"))
        != Some(true)
    {
        return Err("仅支持导入 .zip 文件。".into());
    }
    if archiveBytes.is_empty() {
        return Err("ZIP 压缩包为空。".into());
    }

    let mut archive = ZipArchive::new(Cursor::new(archiveBytes)).map_err(error_to_string)?;
    if archive.len() == 0 {
        return Err("ZIP 压缩包为空。".into());
    }
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("ZIP 文件条目过多。".into());
    }

    // 计算总大小
    let mut total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(error_to_string)?;
        if entry.size() > MAX_ARCHIVE_FILE_SIZE {
            return Err("ZIP 中包含超大文件。".into());
        }
        total += entry.size();
        if total > MAX_ARCHIVE_TOTAL_SIZE {
            return Err("ZIP 解压体积过大。".into());
        }
    }

    let imported_name = derive_imported_name(&fileName)?;

    with_transaction(&app, |transaction| {
        // 先创建空壳（会插入默认 project 模板）
        let record = create_workspace_internal(transaction, &imported_name)?;
        // 清掉默认 project 模板，用 zip 内容覆盖
        transaction
            .execute(
                "DELETE FROM expansion_entries WHERE workspace_id = ?1",
                params![record.id],
            )
            .map_err(error_to_string)?;

        let timestamp = now_timestamp();
        let mut inserted_project = HashSet::<String>::new();
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(error_to_string)?;
            if entry.is_dir() {
                continue;
            }
            let raw = normalize_archive_path(entry.name());
            if raw.is_empty() || is_ignored_archive_path(&raw) {
                continue;
            }

            // 期望格式：<root>/<section>/<rest...>
            let parts: Vec<&str> = raw.split('/').collect();
            if parts.len() < 3 {
                continue;
            }
            let section = parts[1];
            if !SECTIONS.contains(&section) {
                continue;
            }
            let relative_parts = &parts[2..];
            if relative_parts.is_empty() {
                continue;
            }
            let file_name = relative_parts[relative_parts.len() - 1];

            let mut buffer = Vec::new();
            entry.read_to_end(&mut buffer).map_err(error_to_string)?;

            if section == "project" {
                // 只接受固定 project 文件
                if file_name != "AGENTS.md"
                    && file_name != "README.md"
                    && file_name != "outline.md"
                    && file_name != "chapters.meta.json"
                    && file_name != "settings.meta.json"
                {
                    continue;
                }
                insert_entry(
                    transaction,
                    &record.id,
                    "project",
                    file_name,
                    file_name,
                    &buffer,
                    timestamp,
                )?;
                inserted_project.insert(file_name.to_string());
            } else {
                // settings/chapters：保留原 path（去掉 .json 扩展）
                let stem = Path::new(file_name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(file_name);
                let relative_parent = if relative_parts.len() > 1 {
                    relative_parts[..relative_parts.len() - 1].join("/")
                } else {
                    String::new()
                };
                let entry_path = if relative_parent.is_empty() {
                    stem.to_string()
                } else {
                    format!("{relative_parent}/{stem}")
                };
                let name_part = if section == "settings" {
                    stem.splitn(2, '-').nth(1).unwrap_or(stem).to_string()
                } else {
                    stem.to_string()
                };
                insert_entry(
                    transaction,
                    &record.id,
                    section,
                    &entry_path,
                    &name_part,
                    &buffer,
                    timestamp,
                )?;
            }
        }

        // 补齐缺失的 project 模板
        for (path, content) in build_project_template(&record.name) {
            if inserted_project.contains(path) {
                continue;
            }
            insert_entry(
                transaction,
                &record.id,
                "project",
                path,
                path,
                content.as_bytes(),
                timestamp,
            )?;
        }

        touch_workspace(transaction, &record.id, timestamp)?;
        Ok(build_summary(&record))
    })
}

#[cfg(test)]
mod tests {
    use super::{
        create_workspace_internal, load_entry_content, run_expansion_migrations,
    };
    use rusqlite::Connection;

    #[test]
    fn create_workspace_internal_builds_volume_outline_template() {
        let mut connection = Connection::open_in_memory().expect("in-memory db should open");
        run_expansion_migrations(&connection).expect("expansion tables should migrate");

        let transaction = connection.transaction().expect("transaction should open");
        let workspace = create_workspace_internal(&transaction, "北境余烬")
            .expect("workspace should create");
        transaction.commit().expect("transaction should commit");

        let outline = String::from_utf8(
            load_entry_content(&connection, &workspace.id, "project", "outline.md")
                .expect("outline should load"),
        )
        .expect("outline should be utf-8");

        assert!(outline.contains("# 北境余烬 · 全书分卷大纲"));
        assert!(outline.contains("## 分卷规划总表"));
        assert!(outline.contains("## 第一卷：待补充卷名"));
        assert!(outline.contains("### 第一卷章节拆分"));
        assert!(outline.contains("## 第二卷：待补充卷名"));
        assert!(outline.contains("## 第三卷：待补充卷名"));
        assert!(outline.contains("- 第1章：待补充"));
    }
}
