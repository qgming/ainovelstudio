use crate::{db::open_database, ToolCancellationRegistry};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Read, Seek, Write},
    path::Path,
};
use tauri::{AppHandle, State};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

type CommandResult<T> = Result<T, String>;

const BOOK_ROOT_PREFIX: &str = "books";
const DEFAULT_SEARCH_LIMIT: usize = 50;
const INVALID_NAME_CHARS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const MAX_BOOK_ARCHIVE_COMPRESSION_RATIO: u64 = 200;
const MAX_BOOK_ARCHIVE_DEPTH: usize = 12;
const MAX_BOOK_ARCHIVE_ENTRIES: usize = 5_000;
const MAX_BOOK_ARCHIVE_FILE_SIZE: u64 = 10 * 1024 * 1024;
const MAX_BOOK_ARCHIVE_TOTAL_SIZE: u64 = 256 * 1024 * 1024;
const MAX_SEARCH_LIMIT: usize = 200;
const REQUIRED_BOOK_WORKSPACE_FILES: [&str; 1] = ["README.md"];

#[derive(Clone, Serialize)]
pub struct TreeNode {
    #[serde(skip_serializing_if = "Option::is_none")]
    children: Option<Vec<TreeNode>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    extension: Option<String>,
    kind: String,
    name: String,
    path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookWorkspaceSummary {
    id: String,
    name: String,
    path: String,
    updated_at: u64,
}

#[derive(Serialize)]
pub struct WorkspaceSearchMatch {
    #[serde(rename = "lineNumber", skip_serializing_if = "Option::is_none")]
    line_number: Option<usize>,
    #[serde(rename = "lineText", skip_serializing_if = "Option::is_none")]
    line_text: Option<String>,
    #[serde(rename = "matchType")]
    match_type: String,
    path: String,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceLineResult {
    #[serde(rename = "lineNumber")]
    line_number: usize,
    path: String,
    text: String,
}

#[derive(Clone)]
struct BookRecord {
    id: String,
    name: String,
    root_path: String,
    updated_at: u64,
}

#[derive(Clone)]
struct WorkspaceEntryRecord {
    content_bytes: Vec<u8>,
    extension: Option<String>,
    kind: String,
    name: String,
    parent_path: String,
    path: String,
}

pub(crate) fn run_workspace_migrations(connection: &Connection) -> CommandResult<()> {
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
            "#,
        )
        .map_err(error_to_string)?;
    Ok(())
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

fn normalize_workspace_path(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn normalize_relative_path(value: &str) -> CommandResult<String> {
    let normalized = normalize_workspace_path(value);
    if normalized.is_empty() || normalized == "." {
        return Ok(String::new());
    }

    let mut segments = Vec::new();
    for segment in normalized.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Err("目标路径不在当前书籍目录内。".into());
                }
            }
            _ => segments.push(segment.to_string()),
        }
    }

    Ok(segments.join("/"))
}

fn resolve_relative_path(book_root: &str, path: &str) -> CommandResult<String> {
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

fn join_relative_path(parent_path: &str, name: &str) -> String {
    if parent_path.is_empty() {
        name.to_string()
    } else {
        format!("{parent_path}/{name}")
    }
}

fn parent_relative_path(path: &str) -> String {
    let mut parts = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let _ = parts.pop();
    parts.join("/")
}

fn display_path(book_root: &str, relative_path: &str) -> String {
    if relative_path.is_empty() {
        book_root.to_string()
    } else {
        format!("{book_root}/{relative_path}")
    }
}

fn display_relative_path(relative_path: &str) -> String {
    if relative_path.is_empty() {
        ".".into()
    } else {
        relative_path.to_string()
    }
}

fn build_book_root_path(book_name: &str) -> String {
    format!("{BOOK_ROOT_PREFIX}/{book_name}")
}

fn file_extension(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .map(|extension| format!(".{}", extension.to_string_lossy().to_lowercase()))
}

fn entry_name_from_path(path: &str) -> CommandResult<String> {
    path.rsplit('/')
        .find(|segment| !segment.is_empty())
        .map(|segment| segment.to_string())
        .ok_or_else(|| "无法解析当前路径名称。".to_string())
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

fn validate_relative_segments(relative_path: &str) -> CommandResult<()> {
    for segment in relative_path
        .split('/')
        .filter(|segment| !segment.is_empty())
    {
        let _ = validate_name(segment)?;
    }
    Ok(())
}

fn normalize_text_file_name(value: &str) -> CommandResult<String> {
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

fn build_rename_target_name(
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

fn check_cancellation(
    registry: &ToolCancellationRegistry,
    request_id: Option<&str>,
) -> CommandResult<()> {
    registry.check(request_id)
}

fn with_cancellable_request<T, F>(
    registry: &ToolCancellationRegistry,
    request_id: Option<&str>,
    operation: F,
) -> CommandResult<T>
where
    F: FnOnce() -> CommandResult<T>,
{
    registry.begin(request_id);
    let result = operation();
    registry.finish(request_id);
    result
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

fn detect_line_ending(contents: &str) -> &'static str {
    if contents.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn split_text_lines(contents: &str) -> (Vec<String>, bool) {
    let normalized = contents.replace("\r\n", "\n");
    let had_trailing_newline = normalized.ends_with('\n');
    let mut lines = normalized
        .split('\n')
        .map(|line| line.to_string())
        .collect::<Vec<_>>();

    if had_trailing_newline {
        let _ = lines.pop();
    }
    if lines.is_empty() {
        lines.push(String::new());
    }

    (lines, had_trailing_newline)
}

fn validate_single_line_text(value: &str) -> CommandResult<String> {
    if value.contains('\n') || value.contains('\r') {
        return Err("替换行内容时不能包含换行符。".into());
    }
    Ok(value.to_string())
}

fn validate_line_number(line_number: usize) -> CommandResult<usize> {
    if line_number == 0 {
        return Err("行号必须从 1 开始。".into());
    }
    Ok(line_number - 1)
}

fn line_text_or_empty(lines: &[String], index: usize) -> &str {
    lines.get(index).map(String::as_str).unwrap_or("")
}

fn validate_optional_context_line(value: Option<String>) -> CommandResult<Option<String>> {
    match value {
        Some(line) => validate_single_line_text(&line).map(Some),
        None => Ok(None),
    }
}

fn check_adjacent_context(
    lines: &[String],
    target_index: usize,
    previous_line: Option<&str>,
    next_line: Option<&str>,
) -> CommandResult<()> {
    if let Some(expected_previous) = previous_line {
        let actual_previous = if target_index == 0 {
            ""
        } else {
            line_text_or_empty(lines, target_index - 1)
        };
        if actual_previous != expected_previous {
            return Err(format!(
                "前一行校验失败。预期“{}”，实际“{}”。",
                expected_previous, actual_previous
            ));
        }
    }

    if let Some(expected_next) = next_line {
        let actual_next = line_text_or_empty(lines, target_index + 1);
        if actual_next != expected_next {
            return Err(format!(
                "后一行校验失败。预期“{}”，实际“{}”。",
                expected_next, actual_next
            ));
        }
    }

    Ok(())
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

fn bytes_to_text(bytes: Vec<u8>) -> CommandResult<String> {
    String::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 文本，无法按文本方式读取。".into())
}

fn create_book_readme_template(book_name: &str) -> String {
    format!(
        "# {book_name}\n\n你正在处理一本小说项目工作区。\n\n## 书名\n- `{book_name}`\n\n## 工作区结构\n- `README.md`：本项目的 AI 协作说明书。\n- `项目状态.json`：当前项目状态、目录用途、写作约束与协作约定。\n- `01_设定/`：人物设定、世界观、题材规则、故事方案。\n- `02_正文/`：章节正文、番外、修订稿、最终稿。\n- `03_素材/`：资料、灵感、截图、命名备忘、参考片段。\n\n## AI 协作通用说明\n1. 开始写作前，优先读取 `README.md` 和 `项目状态.json`。\n2. 新建内容时，优先复用现有目录，不主动扩展无关目录层级。\n3. 设定类内容写入 `01_设定/`，正文类内容写入 `02_正文/`，资料类内容写入 `03_素材/`。\n4. 生成正文时保持章节命名清晰，文件名建议包含章序号和标题。\n5. 修改故事方向、篇幅、阶段进度后，同步更新 `项目状态.json`。\n6. 临时分析、批注、提纲应优先落盘到工作区文件，避免只停留在对话里。\n\n## 默认写作约束\n- 保持目录简洁，优先在现有结构内推进。\n- 文件命名保持稳定、可检索、可批量处理。\n- 设定、正文、素材分区明确，避免混放。\n"
    )
}

fn create_project_status_template(book_name: &str) -> String {
    format!(
        "{{\n  \"bookName\": \"{book_name}\",\n  \"projectStage\": \"构思中\",\n  \"workspaceVersion\": 1,\n  \"primaryLanguage\": \"zh-CN\",\n  \"targetWordCount\": null,\n  \"currentWordCount\": 0,\n  \"writingMode\": \"长篇/短篇待定\",\n  \"directories\": {{\n    \"setting\": \"01_设定\",\n    \"draft\": \"02_正文\",\n    \"assets\": \"03_素材\"\n  }},\n  \"defaultFiles\": {{\n    \"guide\": \"README.md\",\n    \"projectState\": \"项目状态.json\"\n  }},\n  \"aiInstructions\": [\n    \"开始任务前先读取 README.md 和 项目状态.json。\",\n    \"设定写入 01_设定，正文写入 02_正文，素材写入 03_素材。\",\n    \"不要擅自重命名顶层目录。\",\n    \"新增章节时优先使用清晰且稳定的文件名。\",\n    \"项目阶段、字数目标、结构调整后要同步回写本文件。\"\n  ],\n  \"status\": {{\n    \"currentFocus\": \"待明确题材、核心设定与写作目标\",\n    \"nextAction\": \"在 01_设定 中建立基础设定文件\",\n    \"lastUpdated\": null\n  }}\n}}\n"
    )
}

fn build_book_template(book_name: &str) -> (Vec<&'static str>, Vec<(&'static str, String)>) {
    (
        vec!["01_设定", "02_正文", "03_素材"],
        vec![
            ("README.md", create_book_readme_template(book_name)),
            ("项目状态.json", create_project_status_template(book_name)),
        ],
    )
}

fn map_book_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<BookRecord> {
    Ok(BookRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        updated_at: row.get::<_, i64>(3)? as u64,
    })
}

fn build_summary(book: &BookRecord) -> BookWorkspaceSummary {
    BookWorkspaceSummary {
        id: book.id.clone(),
        name: book.name.clone(),
        path: book.root_path.clone(),
        updated_at: book.updated_at,
    }
}

fn load_book_by_root_path(connection: &Connection, root_path: &str) -> CommandResult<BookRecord> {
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

fn load_book_by_id(connection: &Connection, book_id: &str) -> CommandResult<BookRecord> {
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

fn list_books(connection: &Connection) -> CommandResult<Vec<BookRecord>> {
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

fn load_entry_record(
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

fn ensure_entry_record(
    connection: &Connection,
    book_id: &str,
    relative_path: &str,
) -> CommandResult<WorkspaceEntryRecord> {
    load_entry_record(connection, book_id, relative_path)?
        .ok_or_else(|| "目标路径不存在。".to_string())
}

fn load_entry_records(
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
        path: display_path(book_root, &entry.path),
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

fn read_workspace_tree_db(connection: &Connection, root_path: &str) -> CommandResult<TreeNode> {
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

fn ensure_directory_exists(
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

fn insert_entry(
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
                entry_name_from_path(relative_path)?,
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

fn ensure_directory_chain(
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

fn touch_book(transaction: &Transaction<'_>, book_id: &str, timestamp: u64) -> CommandResult<()> {
    transaction
        .execute(
            "UPDATE book_workspaces SET updated_at = ?1 WHERE id = ?2",
            params![timestamp as i64, book_id],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn create_book_workspace_db(
    transaction: &Transaction<'_>,
    book_name: &str,
) -> CommandResult<BookRecord> {
    let validated_name = validate_name(book_name)?;
    let root_path = build_book_root_path(&validated_name);
    let existing = transaction
        .query_row(
            "SELECT id FROM book_workspaces WHERE name = ?1 OR root_path = ?2",
            params![validated_name, root_path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?;
    if existing.is_some() {
        return Err("同名书籍已存在。".into());
    }

    let timestamp = now_timestamp();
    let book = BookRecord {
        id: Uuid::new_v4().to_string(),
        name: validated_name.clone(),
        root_path,
        updated_at: timestamp,
    };
    transaction
        .execute(
            r#"
            INSERT INTO book_workspaces (id, name, root_path, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![
                book.id,
                book.name,
                book.root_path,
                timestamp as i64,
                timestamp as i64,
            ],
        )
        .map_err(error_to_string)?;

    let (directories, files) = build_book_template(&validated_name);
    for directory in directories {
        insert_entry(
            transaction,
            &book.id,
            directory,
            "directory",
            None,
            &[],
            timestamp,
        )?;
    }
    for (relative_path, contents) in files {
        ensure_directory_chain(
            transaction,
            &book.id,
            &parent_relative_path(relative_path),
            timestamp,
        )?;
        insert_entry(
            transaction,
            &book.id,
            relative_path,
            "file",
            file_extension(relative_path).as_deref(),
            contents.as_bytes(),
            timestamp,
        )?;
    }

    Ok(book)
}

fn load_subtree_records(
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

fn read_text_file_db(
    connection: &Connection,
    root_path: &str,
    path: &str,
) -> CommandResult<String> {
    let book = load_book_by_root_path(connection, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    let entry = ensure_entry_record(connection, &book.id, &relative_path)?;
    if entry.kind != "file" {
        return Err("只能读取文件内容。".into());
    }
    bytes_to_text(entry.content_bytes)
}

fn read_text_file_line_db(
    connection: &Connection,
    root_path: &str,
    path: &str,
    line_number: usize,
) -> CommandResult<WorkspaceLineResult> {
    let book = load_book_by_root_path(connection, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    let entry = ensure_entry_record(connection, &book.id, &relative_path)?;
    if entry.kind != "file" {
        return Err("只能读取文件中的指定行。".into());
    }

    let contents = bytes_to_text(entry.content_bytes)?;
    let (lines, _) = split_text_lines(&contents);
    let index = validate_line_number(line_number)?;

    Ok(WorkspaceLineResult {
        line_number,
        path: display_relative_path(&relative_path),
        text: line_text_or_empty(&lines, index).to_string(),
    })
}

fn write_text_file_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    path: &str,
    contents: &str,
) -> CommandResult<()> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("只能写入文件内容。".into());
    }
    validate_relative_segments(&relative_path)?;
    let timestamp = now_timestamp();

    ensure_directory_chain(
        transaction,
        &book.id,
        &parent_relative_path(&relative_path),
        timestamp,
    )?;

    match load_entry_record(transaction, &book.id, &relative_path)? {
        Some(entry) if entry.kind != "file" => return Err("只能写入文件内容。".into()),
        Some(_) => {
            transaction
                .execute(
                    r#"
                    UPDATE book_workspace_entries
                    SET content_bytes = ?1, updated_at = ?2
                    WHERE book_id = ?3 AND path = ?4
                    "#,
                    params![
                        contents.as_bytes(),
                        timestamp as i64,
                        book.id,
                        relative_path,
                    ],
                )
                .map_err(error_to_string)?;
        }
        None => {
            insert_entry(
                transaction,
                &book.id,
                &relative_path,
                "file",
                file_extension(&relative_path).as_deref(),
                contents.as_bytes(),
                timestamp,
            )?;
        }
    }

    touch_book(transaction, &book.id, timestamp)?;
    Ok(())
}

fn replace_text_file_line_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    path: &str,
    line_number: usize,
    contents: &str,
    previous_line: Option<String>,
    next_line: Option<String>,
) -> CommandResult<WorkspaceLineResult> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    let entry = ensure_entry_record(transaction, &book.id, &relative_path)?;
    if entry.kind != "file" {
        return Err("只能替换文件中的指定行。".into());
    }

    let previous_line = validate_optional_context_line(previous_line)?;
    let next_line = validate_optional_context_line(next_line)?;
    let next_contents = validate_single_line_text(contents)?;
    let current_contents = bytes_to_text(entry.content_bytes)?;
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

    let timestamp = now_timestamp();
    transaction
        .execute(
            r#"
            UPDATE book_workspace_entries
            SET content_bytes = ?1, updated_at = ?2
            WHERE book_id = ?3 AND path = ?4
            "#,
            params![
                updated_contents.as_bytes(),
                timestamp as i64,
                book.id,
                relative_path,
            ],
        )
        .map_err(error_to_string)?;
    touch_book(transaction, &book.id, timestamp)?;

    Ok(WorkspaceLineResult {
        line_number,
        path: display_relative_path(&relative_path),
        text: next_contents,
    })
}

fn create_workspace_directory_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    parent_path: &str,
    name: &str,
) -> CommandResult<String> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let parent_relative_path = resolve_relative_path(&book.root_path, parent_path)?;
    ensure_directory_exists(transaction, &book.id, &parent_relative_path)?;
    let directory_name = validate_name(name)?;
    let next_path = join_relative_path(&parent_relative_path, &directory_name);
    if load_entry_record(transaction, &book.id, &next_path)?.is_some() {
        return Err("同名文件或文件夹已存在。".into());
    }

    let timestamp = now_timestamp();
    insert_entry(
        transaction,
        &book.id,
        &next_path,
        "directory",
        None,
        &[],
        timestamp,
    )?;
    touch_book(transaction, &book.id, timestamp)?;
    Ok(display_path(&book.root_path, &next_path))
}

fn create_workspace_text_file_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    parent_path: &str,
    name: &str,
) -> CommandResult<String> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let parent_relative_path = resolve_relative_path(&book.root_path, parent_path)?;
    ensure_directory_exists(transaction, &book.id, &parent_relative_path)?;
    let file_name = normalize_text_file_name(name)?;
    let next_path = join_relative_path(&parent_relative_path, &file_name);
    if load_entry_record(transaction, &book.id, &next_path)?.is_some() {
        return Err("同名文件已存在。".into());
    }

    let timestamp = now_timestamp();
    insert_entry(
        transaction,
        &book.id,
        &next_path,
        "file",
        file_extension(&file_name).as_deref(),
        &[],
        timestamp,
    )?;
    touch_book(transaction, &book.id, timestamp)?;
    Ok(display_path(&book.root_path, &next_path))
}

fn rebase_relative_path(current_path: &str, source_path: &str, target_path: &str) -> String {
    if current_path == source_path {
        target_path.to_string()
    } else {
        format!("{target_path}{}", &current_path[source_path.len()..])
    }
}

fn is_same_or_descendant_relative(path: &str, target: &str) -> bool {
    path == target || path.starts_with(&format!("{target}/"))
}

fn rename_workspace_entry_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    path: &str,
    next_name: &str,
) -> CommandResult<String> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("不能重命名书籍根目录。".into());
    }

    let entry = ensure_entry_record(transaction, &book.id, &relative_path)?;
    let target_name = build_rename_target_name(&entry.name, entry.kind == "directory", next_name)?;
    let target_path = join_relative_path(&parent_relative_path(&relative_path), &target_name);
    if load_entry_record(transaction, &book.id, &target_path)?.is_some() {
        return Err("目标名称已存在。".into());
    }

    let timestamp = now_timestamp();
    for current in load_subtree_records(transaction, &book.id, &relative_path)? {
        let next_path = rebase_relative_path(&current.path, &relative_path, &target_path);
        let next_name = if current.path == relative_path {
            target_name.clone()
        } else {
            current.name.clone()
        };
        let next_extension = if current.path == relative_path && current.kind == "file" {
            file_extension(&next_name)
        } else {
            current.extension.clone()
        };
        transaction
            .execute(
                r#"
                UPDATE book_workspace_entries
                SET path = ?1, parent_path = ?2, name = ?3, extension = ?4, updated_at = ?5
                WHERE book_id = ?6 AND path = ?7
                "#,
                params![
                    next_path,
                    parent_relative_path(&next_path),
                    next_name,
                    next_extension,
                    timestamp as i64,
                    book.id,
                    current.path,
                ],
            )
            .map_err(error_to_string)?;
    }
    touch_book(transaction, &book.id, timestamp)?;
    Ok(display_path(&book.root_path, &target_path))
}

fn move_workspace_entry_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    path: &str,
    target_parent_path: &str,
) -> CommandResult<String> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("不能迁移书籍根目录。".into());
    }

    let entry = ensure_entry_record(transaction, &book.id, &relative_path)?;
    let target_parent_relative_path = resolve_relative_path(&book.root_path, target_parent_path)?;
    ensure_directory_exists(transaction, &book.id, &target_parent_relative_path)?;
    if entry.kind == "directory"
        && is_same_or_descendant_relative(&target_parent_relative_path, &relative_path)
    {
        return Err("不能将文件夹迁移到其自身或子目录中。".into());
    }

    let target_path = join_relative_path(&target_parent_relative_path, &entry.name);
    if target_path == relative_path {
        return Err("目标位置未变化。".into());
    }
    if load_entry_record(transaction, &book.id, &target_path)?.is_some() {
        return Err("目标位置已存在同名文件或文件夹。".into());
    }

    let timestamp = now_timestamp();
    for current in load_subtree_records(transaction, &book.id, &relative_path)? {
        let next_path = rebase_relative_path(&current.path, &relative_path, &target_path);
        transaction
            .execute(
                r#"
                UPDATE book_workspace_entries
                SET path = ?1, parent_path = ?2, updated_at = ?3
                WHERE book_id = ?4 AND path = ?5
                "#,
                params![
                    next_path,
                    parent_relative_path(&next_path),
                    timestamp as i64,
                    book.id,
                    current.path,
                ],
            )
            .map_err(error_to_string)?;
    }
    touch_book(transaction, &book.id, timestamp)?;
    Ok(display_path(&book.root_path, &target_path))
}

fn delete_workspace_entry_db(
    transaction: &Transaction<'_>,
    root_path: &str,
    path: &str,
) -> CommandResult<()> {
    let book = load_book_by_root_path(transaction, root_path)?;
    let relative_path = resolve_relative_path(&book.root_path, path)?;
    if relative_path.is_empty() {
        return Err("不能删除书籍根目录。".into());
    }
    let _ = ensure_entry_record(transaction, &book.id, &relative_path)?;

    let timestamp = now_timestamp();
    transaction
        .execute(
            r#"
            DELETE FROM book_workspace_entries
            WHERE book_id = ?1
              AND (path = ?2 OR substr(path, 1, length(?2) + 1) = ?2 || '/')
            "#,
            params![book.id, relative_path],
        )
        .map_err(error_to_string)?;
    touch_book(transaction, &book.id, timestamp)?;
    Ok(())
}

fn search_workspace_content_db(
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

fn is_ignored_book_archive_path(path: &str) -> bool {
    path.split('/')
        .any(|segment| segment == "__MACOSX" || segment == ".DS_Store" || segment == "Thumbs.db")
}

fn path_depth(path: &str) -> usize {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .count()
}

fn preview_archive_paths(paths: &[String]) -> String {
    let preview = paths.iter().take(8).cloned().collect::<Vec<_>>().join("，");
    if preview.is_empty() {
        "无可用文件".into()
    } else {
        preview
    }
}

fn collect_book_archive_file_paths<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> CommandResult<Vec<String>> {
    if archive.len() == 0 {
        return Err("ZIP 压缩包为空。".into());
    }
    if archive.len() > MAX_BOOK_ARCHIVE_ENTRIES {
        return Err("ZIP 文件条目过多，请拆分后重试。".into());
    }

    let mut file_paths = Vec::new();
    let mut total_uncompressed = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(error_to_string)?;
        let path = normalize_relative_path(entry.name())?;
        if path_depth(&path) > MAX_BOOK_ARCHIVE_DEPTH {
            return Err("ZIP 内目录层级过深。".into());
        }
        if entry.size() > MAX_BOOK_ARCHIVE_FILE_SIZE {
            return Err("ZIP 中包含超出大小限制的文件。".into());
        }
        if entry.compressed_size() > 0
            && entry.size() / entry.compressed_size().max(1) > MAX_BOOK_ARCHIVE_COMPRESSION_RATIO
        {
            return Err("ZIP 中包含压缩比异常的文件。".into());
        }

        total_uncompressed += entry.size();
        if total_uncompressed > MAX_BOOK_ARCHIVE_TOTAL_SIZE {
            return Err("ZIP 解压后体积超过当前限制。".into());
        }
        if entry.is_dir() || path.is_empty() || is_ignored_book_archive_path(&path) {
            continue;
        }
        file_paths.push(path);
    }

    Ok(file_paths)
}

fn archive_contains_required_book_files(file_set: &HashSet<String>, prefix: &str) -> bool {
    REQUIRED_BOOK_WORKSPACE_FILES.iter().all(|relative_path| {
        let candidate = if prefix.is_empty() {
            (*relative_path).to_string()
        } else {
            format!("{prefix}/{relative_path}")
        };
        file_set.contains(&candidate)
    })
}

fn detect_book_archive_root(file_paths: &[String]) -> CommandResult<String> {
    let file_set = file_paths.iter().cloned().collect::<HashSet<_>>();
    let mut candidates = vec![String::new()];
    let mut seen = HashSet::from([String::new()]);

    for path in file_paths {
        let mut current = parent_relative_path(path);
        while !current.is_empty() {
            if seen.insert(current.clone()) {
                candidates.push(current.clone());
            }
            current = parent_relative_path(&current);
        }
    }

    let matching_roots = candidates
        .into_iter()
        .filter(|prefix| archive_contains_required_book_files(&file_set, prefix))
        .collect::<Vec<_>>();

    if matching_roots.is_empty() {
        return Err(format!(
            "ZIP 中未找到有效书籍工作区。至少需要包含 README.md。检测到的文件示例：{}",
            preview_archive_paths(file_paths)
        ));
    }
    if matching_roots.len() > 1 {
        return Err(format!(
            "ZIP 中检测到多个书籍工作区，当前仅支持单书导入。检测到：{}",
            matching_roots.join("，")
        ));
    }

    Ok(matching_roots[0].clone())
}

fn derive_imported_book_name(root_prefix: &str, file_name: &str) -> CommandResult<String> {
    let candidate = if !root_prefix.is_empty() {
        entry_name_from_path(root_prefix)?
    } else {
        Path::new(file_name)
            .file_stem()
            .and_then(|name| name.to_str())
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .ok_or_else(|| "无法确定导入书籍名称。".to_string())?
            .to_string()
    };

    validate_name(&candidate)
}

fn import_book_zip_db(
    transaction: &Transaction<'_>,
    file_name: &str,
    archive_bytes: Vec<u8>,
) -> CommandResult<BookRecord> {
    let mut archive = ZipArchive::new(Cursor::new(archive_bytes)).map_err(error_to_string)?;
    let file_paths = collect_book_archive_file_paths(&mut archive)?;
    let root_prefix = detect_book_archive_root(&file_paths)?;
    let book_name = derive_imported_book_name(&root_prefix, file_name)?;
    let book = create_book_workspace_db(transaction, &book_name)?;

    transaction
        .execute(
            "DELETE FROM book_workspace_entries WHERE book_id = ?1",
            params![book.id],
        )
        .map_err(error_to_string)?;

    let timestamp = now_timestamp();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error_to_string)?;
        let path = normalize_relative_path(entry.name())?;
        if path.is_empty() || is_ignored_book_archive_path(&path) {
            continue;
        }

        if entry.is_dir() {
            let relative_path = if root_prefix.is_empty() {
                path
            } else if let Some(suffix) = path.strip_prefix(&format!("{root_prefix}/")) {
                suffix.to_string()
            } else {
                continue;
            };

            if relative_path.is_empty() {
                continue;
            }

            validate_relative_segments(&relative_path)?;
            ensure_directory_chain(transaction, &book.id, &relative_path, timestamp)?;
            continue;
        }

        let relative_path = if root_prefix.is_empty() {
            path
        } else if let Some(suffix) = path.strip_prefix(&format!("{root_prefix}/")) {
            suffix.to_string()
        } else {
            continue;
        };

        validate_relative_segments(&relative_path)?;
        ensure_directory_chain(
            transaction,
            &book.id,
            &parent_relative_path(&relative_path),
            timestamp,
        )?;
        let mut content_bytes = Vec::new();
        entry
            .read_to_end(&mut content_bytes)
            .map_err(error_to_string)?;
        insert_entry(
            transaction,
            &book.id,
            &relative_path,
            "file",
            file_extension(&relative_path).as_deref(),
            &content_bytes,
            timestamp,
        )?;
    }

    touch_book(transaction, &book.id, timestamp)?;
    load_book_by_id(transaction, &book.id)
}

fn export_book_zip_db(connection: &Connection, root_path: &str) -> CommandResult<Vec<u8>> {
    let book = load_book_by_root_path(connection, root_path)?;
    let entries = load_entry_records(connection, &book.id)?;

    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for entry in entries {
        let archive_path = format!("{}/{}", book.name, entry.path);
        if entry.kind == "directory" {
            archive
                .add_directory(format!("{archive_path}/"), options)
                .map_err(error_to_string)?;
            continue;
        }

        archive
            .start_file(archive_path, options)
            .map_err(error_to_string)?;
        archive
            .write_all(&entry.content_bytes)
            .map_err(error_to_string)?;
    }

    archive
        .finish()
        .map_err(error_to_string)
        .map(|cursor| cursor.into_inner())
}

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

#[tauri::command]
#[allow(non_snake_case)]
pub fn cancel_tool_request(
    requestId: String,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    registry.cancel(&requestId);
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn cancel_tool_requests(
    requestIds: Vec<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    for request_id in requestIds {
        registry.cancel(&request_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn pick_book_directory(app: AppHandle) -> CommandResult<Option<String>> {
    #[cfg(desktop)]
    {
        return Ok(app
            .dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|path| path.into_path().ok())
            .map(|path| path.to_string_lossy().replace('\\', "/")));
    }

    #[cfg(mobile)]
    {
        let _ = app;
        Ok(None)
    }
}

#[tauri::command]
pub fn list_book_workspaces(app: AppHandle) -> CommandResult<Vec<BookWorkspaceSummary>> {
    let connection = open_database(&app)?;
    Ok(list_books(&connection)?
        .into_iter()
        .map(|book| build_summary(&book))
        .collect())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_book_workspace_summary(
    app: AppHandle,
    rootPath: String,
) -> CommandResult<BookWorkspaceSummary> {
    let connection = open_database(&app)?;
    load_book_by_root_path(&connection, &rootPath).map(|book| build_summary(&book))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_book_workspace_summary_by_id(
    app: AppHandle,
    bookId: String,
) -> CommandResult<BookWorkspaceSummary> {
    let connection = open_database(&app)?;
    load_book_by_id(&connection, &bookId).map(|book| build_summary(&book))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_book_workspace(
    app: AppHandle,
    parentPath: Option<String>,
    bookName: String,
) -> CommandResult<BookWorkspaceSummary> {
    if parentPath
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
    {
        return Err("当前版本仅支持写入 SQLite 内置书库。".into());
    }

    with_transaction(&app, |transaction| {
        create_book_workspace_db(transaction, &bookName).map(|book| build_summary(&book))
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn import_book_zip(
    app: AppHandle,
    fileName: String,
    archiveBytes: Vec<u8>,
) -> CommandResult<BookWorkspaceSummary> {
    if Path::new(&fileName)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("zip"))
        != Some(true)
    {
        return Err("仅支持导入 .zip 书籍包。".into());
    }
    if archiveBytes.is_empty() {
        return Err("ZIP 压缩包为空。".into());
    }

    with_transaction(&app, |transaction| {
        import_book_zip_db(transaction, &fileName, archiveBytes).map(|book| build_summary(&book))
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn export_book_zip(app: AppHandle, rootPath: String) -> CommandResult<Option<String>> {
    let archive_bytes = {
        let connection = open_database(&app)?;
        export_book_zip_db(&connection, &rootPath)?
    };

    #[cfg(desktop)]
    {
        let connection = open_database(&app)?;
        let default_file_name = format!(
            "{}.zip",
            load_book_by_root_path(&connection, &rootPath)?.name
        );
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
        Err("当前平台暂不支持导出 ZIP 书籍包。".into())
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_book_workspace(app: AppHandle, rootPath: String) -> CommandResult<()> {
    with_transaction(&app, |transaction| {
        let book = load_book_by_root_path(transaction, &rootPath)?;
        transaction
            .execute(
                "DELETE FROM book_workspaces WHERE id = ?1",
                params![book.id],
            )
            .map_err(error_to_string)?;
        Ok(())
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_workspace_tree(
    app: AppHandle,
    rootPath: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<TreeNode> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let connection = open_database(&app)?;
        read_workspace_tree_db(&connection, &rootPath)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_text_file(
    app: AppHandle,
    rootPath: String,
    path: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let connection = open_database(&app)?;
        read_text_file_db(&connection, &rootPath, &path)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_text_file(
    app: AppHandle,
    rootPath: String,
    path: String,
    contents: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            write_text_file_db(transaction, &rootPath, &path, &contents)
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn search_workspace_content(
    app: AppHandle,
    rootPath: String,
    query: String,
    limit: Option<usize>,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<Vec<WorkspaceSearchMatch>> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        let connection = open_database(&app)?;
        search_workspace_content_db(
            &connection,
            &rootPath,
            &query,
            limit,
            &registry,
            requestId.as_deref(),
        )
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_text_file_line(
    app: AppHandle,
    rootPath: String,
    path: String,
    lineNumber: usize,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<WorkspaceLineResult> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        let connection = open_database(&app)?;
        read_text_file_line_db(&connection, &rootPath, &path, lineNumber)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn replace_text_file_line(
    app: AppHandle,
    rootPath: String,
    path: String,
    lineNumber: usize,
    contents: String,
    previousLine: Option<String>,
    nextLine: Option<String>,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<WorkspaceLineResult> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            replace_text_file_line_db(
                transaction,
                &rootPath,
                &path,
                lineNumber,
                &contents,
                previousLine,
                nextLine,
            )
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workspace_directory(
    app: AppHandle,
    rootPath: String,
    parentPath: String,
    name: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            create_workspace_directory_db(transaction, &rootPath, &parentPath, &name)
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workspace_text_file(
    app: AppHandle,
    rootPath: String,
    parentPath: String,
    name: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            create_workspace_text_file_db(transaction, &rootPath, &parentPath, &name)
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn rename_workspace_entry(
    app: AppHandle,
    rootPath: String,
    path: String,
    nextName: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            rename_workspace_entry_db(transaction, &rootPath, &path, &nextName)
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn move_workspace_entry(
    app: AppHandle,
    rootPath: String,
    path: String,
    targetParentPath: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            move_workspace_entry_db(transaction, &rootPath, &path, &targetParentPath)
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_workspace_entry(
    app: AppHandle,
    rootPath: String,
    path: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    with_cancellable_request(&registry, requestId.as_deref(), || {
        check_cancellation(&registry, requestId.as_deref())?;
        with_transaction(&app, |transaction| {
            delete_workspace_entry_db(transaction, &rootPath, &path)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory db should open");
        run_workspace_migrations(&connection).expect("workspace tables should migrate");
        connection
    }

    fn create_book(connection: &mut Connection, name: &str) -> BookRecord {
        let transaction = connection.transaction().expect("transaction should open");
        let book = create_book_workspace_db(&transaction, name).expect("book should be created");
        transaction.commit().expect("transaction should commit");
        book
    }

    #[test]
    fn create_book_workspace_db_builds_template_tree() {
        let mut connection = create_connection();
        let book = create_book(&mut connection, "北境余烬");
        let tree = read_workspace_tree_db(&connection, &book.root_path).expect("tree should load");

        assert_eq!(tree.name, "北境余烬");
        assert_eq!(tree.path, "books/北境余烬");
        let readme = read_text_file_db(
            &connection,
            &book.root_path,
            "books/北境余烬/README.md",
        )
        .expect("README should load");
        assert!(readme.contains("# 北境余烬"));
        assert!(readme.contains("项目状态.json"));

        let project_status = read_text_file_db(
            &connection,
            &book.root_path,
            "books/北境余烬/项目状态.json",
        )
        .expect("project status should load");
        assert!(project_status.contains("\"bookName\": \"北境余烬\""));

        let child_names = tree
            .children
            .expect("tree should contain children")
            .into_iter()
            .map(|child| child.name)
            .collect::<Vec<_>>();
        assert_eq!(
            child_names,
            vec!["01_设定", "02_正文", "03_素材", "README.md", "项目状态.json"]
        );
    }

    #[test]
    fn workspace_operations_use_sqlite_storage() {
        let mut connection = create_connection();
        let book = create_book(&mut connection, "星河回声");
        let transaction = connection.transaction().expect("transaction should open");

        write_text_file_db(
            &transaction,
            &book.root_path,
            "books/星河回声/草稿/第001章.md",
            "第一行\n第二行",
        )
        .expect("file should be written");
        let moved_path = rename_workspace_entry_db(
            &transaction,
            &book.root_path,
            "books/星河回声/草稿/第001章.md",
            "序章.md",
        )
        .expect("file should rename");
        assert_eq!(moved_path, "books/星河回声/草稿/序章.md");

        let final_path = move_workspace_entry_db(
            &transaction,
            &book.root_path,
            "books/星河回声/草稿/序章.md",
            "books/星河回声/正文",
        )
        .expect("file should move");
        assert_eq!(final_path, "books/星河回声/正文/序章.md");

        delete_workspace_entry_db(&transaction, &book.root_path, "books/星河回声/草稿")
            .expect("empty draft directory should delete");
        transaction.commit().expect("transaction should commit");

        let contents =
            read_text_file_db(&connection, &book.root_path, "books/星河回声/正文/序章.md")
                .expect("moved file should be readable");
        assert_eq!(contents, "第一行\n第二行");
    }

    #[test]
    fn import_and_export_zip_roundtrip() {
        let mut source_connection = create_connection();
        let original = create_book(&mut source_connection, "北境余烬");
        let exported =
            export_book_zip_db(&source_connection, &original.root_path).expect("zip should export");

        let mut target_connection = create_connection();
        let transaction = target_connection
            .transaction()
            .expect("transaction should open");
        let book = import_book_zip_db(&transaction, "北境余烬.zip", exported)
            .expect("zip should import");
        transaction.commit().expect("transaction should commit");

        let tree =
            read_workspace_tree_db(&target_connection, &book.root_path).expect("tree should load");
        let child_names = tree
            .children
            .expect("tree should contain children")
            .into_iter()
            .map(|child| child.name)
            .collect::<Vec<_>>();
        assert_eq!(
            child_names,
            vec!["01_设定", "02_正文", "03_素材", "README.md", "项目状态.json"]
        );
    }
}
