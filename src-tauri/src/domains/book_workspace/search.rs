// 图书工作区：面向 AI Agent 的 FTS 上下文检索索引。

use crate::app::ToolCancellationRegistry;
use crate::domains::book_workspace::data::{display_relative_path, load_book_by_id};
use crate::domains::book_workspace::fs_store::{WorkspaceEntry, WorkspaceStore};
use crate::infrastructure::workspace_paths::{
    check_cancellation, error_to_string, split_text_lines, CommandResult,
};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{HashMap, HashSet};

const DEFAULT_SEARCH_LIMIT: usize = 8;
const MAX_SEARCH_LIMIT: usize = 30;
const DEFAULT_TOKEN_BUDGET: usize = 4_000;
const MAX_TOKEN_BUDGET: usize = 12_000;
const MIN_TOKEN_BUDGET: usize = 800;
const DEFAULT_CHUNK_TARGET_CHARS: usize = 1_200;
const CHAPTER_CHUNK_TARGET_CHARS: usize = 1_800;
const JSON_CHUNK_TARGET_CHARS: usize = 1_600;
const MAX_CHUNK_CHARS: usize = 2_400;
const MAX_SEARCH_TERMS: usize = 16;
const MAX_PREVIEW_CHARS: usize = 1_600;

#[derive(Clone, Debug)]
struct SearchChunk {
    char_end: usize,
    char_start: usize,
    content: String,
    end_line: usize,
    section_title: Option<String>,
    start_line: usize,
}

#[derive(Debug)]
struct RawHit {
    content: String,
    end_line: usize,
    id: String,
    path: String,
    score: f64,
    section_title: Option<String>,
    source_kind: String,
    start_line: usize,
    token_estimate: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceContextHit {
    pub(crate) adjacent_available: bool,
    pub(crate) end_line: usize,
    pub(crate) id: String,
    pub(crate) matched_terms: Vec<String>,
    pub(crate) path: String,
    pub(crate) preview: String,
    pub(crate) reason: String,
    pub(crate) score: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) section_title: Option<String>,
    pub(crate) source_kind: String,
    pub(crate) start_line: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReadSuggestion {
    pub(crate) end_line: usize,
    pub(crate) path: String,
    pub(crate) reason: String,
    pub(crate) start_line: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    pub(crate) intent: String,
    pub(crate) query: String,
    pub(crate) results: Vec<WorkspaceContextHit>,
    pub(crate) strategy: String,
    pub(crate) suggested_reads: Vec<WorkspaceReadSuggestion>,
    pub(crate) token_budget: usize,
    pub(crate) truncated: bool,
}

fn normalize_search_query(value: &str) -> CommandResult<String> {
    let trimmed = value.trim();
    if trimmed.chars().count() < 2 {
        return Err("检索关键词至少需要 2 个字符。".into());
    }
    Ok(trimmed.to_string())
}

fn normalize_search_limit(limit: Option<usize>) -> usize {
    limit
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT)
}

fn normalize_token_budget(token_budget: Option<usize>) -> usize {
    token_budget
        .unwrap_or(DEFAULT_TOKEN_BUDGET)
        .clamp(MIN_TOKEN_BUDGET, MAX_TOKEN_BUDGET)
}

fn normalize_intent(value: Option<&str>) -> String {
    match value.unwrap_or("auto").trim() {
        "fact" | "character" | "plot" | "chapter" | "path" | "status" | "conflict" => {
            value.unwrap_or("auto").trim().to_string()
        }
        _ => "auto".into(),
    }
}

fn normalize_scope(scope: Option<Vec<String>>) -> Vec<String> {
    scope
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.trim().replace('\\', "/").trim_matches('/').to_string())
        .filter(|path| !path.is_empty() && path != ".")
        .collect()
}

fn is_path_in_scope(path: &str, scope: &[String]) -> bool {
    scope.is_empty()
        || scope
            .iter()
            .any(|prefix| path == prefix || path.starts_with(&format!("{prefix}/")))
}

fn classify_source_kind(path: &str, kind: &str, extension: Option<&str>) -> String {
    let normalized = path.replace('\\', "/");
    let lowered = normalized.to_lowercase();
    if normalized.starts_with(".project/status/") {
        return "project_status".into();
    }
    if normalized.starts_with(".project/") {
        return "project".into();
    }
    if lowered.contains("角色") || lowered.contains("人物") || lowered.contains("character") {
        return "character".into();
    }
    if lowered.contains("设定") || lowered.contains("世界观") || lowered.contains("world") {
        return "worldbuilding".into();
    }
    if lowered.contains("大纲") || lowered.contains("细纲") || lowered.contains("outline") {
        return "outline".into();
    }
    if lowered.contains("正文") || lowered.contains("章节") || lowered.contains("chapter") {
        return "chapter".into();
    }
    if lowered.contains("草稿") || lowered.contains("draft") {
        return "draft".into();
    }
    if lowered.contains("笔记") || lowered.contains("notes") {
        return "notes".into();
    }
    if extension == Some(".json") {
        return "json".into();
    }
    if kind == "directory" {
        return "directory".into();
    }
    "unknown".into()
}

fn source_kind_boost(source_kind: &str) -> f64 {
    match source_kind {
        "project_status" => 5.0,
        "character" | "worldbuilding" => 4.0,
        "outline" | "project" => 3.0,
        "json" | "notes" => 2.0,
        "chapter" => 1.0,
        "draft" => -2.0,
        _ => 0.0,
    }
}

fn intent_boost(intent: &str, source_kind: &str) -> f64 {
    match (intent, source_kind) {
        ("status", "project_status") => 6.0,
        ("character", "character") => 6.0,
        ("fact", "character" | "worldbuilding" | "outline" | "project_status") => 3.0,
        ("plot" | "conflict", "outline" | "project_status") => 3.0,
        ("chapter", "chapter") => 4.0,
        ("path", "directory") => 3.0,
        _ => 0.0,
    }
}

fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2A6DF
            | 0x2A700..=0x2B73F
            | 0x2B740..=0x2B81F
            | 0x2B820..=0x2CEAF
    )
}

fn is_term_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_' || character == '-' || is_cjk(character)
}

fn is_all_cjk(value: &str) -> bool {
    value.chars().all(is_cjk)
}

fn push_segment_terms(segment: &str, terms: &mut Vec<String>) {
    if segment.is_empty() {
        return;
    }
    let lowered = segment.to_lowercase();
    if lowered.chars().count() <= 64 {
        terms.push(lowered.clone());
    }
    for part in lowered
        .split(['_', '-'])
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        terms.push(part.to_string());
    }

    let chars = lowered.chars().collect::<Vec<_>>();
    if chars.iter().any(|character| is_cjk(*character)) {
        for window in 2..=3 {
            if chars.len() < window {
                continue;
            }
            for gram in chars.windows(window) {
                if gram.iter().all(|character| is_cjk(*character)) {
                    terms.push(gram.iter().collect());
                }
            }
        }
    }
}

fn collect_search_terms(source: &str) -> Vec<String> {
    let mut terms = Vec::new();
    let mut current = String::new();
    for character in source.chars() {
        if is_term_character(character) {
            current.push(character);
            continue;
        }
        push_segment_terms(&current, &mut terms);
        current.clear();
    }
    push_segment_terms(&current, &mut terms);

    let mut seen = HashSet::new();
    terms
        .into_iter()
        .filter(|term| {
            term.chars().count() >= 2 || term.chars().any(|character| character.is_ascii_digit())
        })
        .filter(|term| seen.insert(term.clone()))
        .collect()
}

fn build_search_text(parts: &[&str]) -> String {
    let joined = parts.join("\n");
    collect_search_terms(&joined).join(" ")
}

fn quote_fts_term(term: &str) -> String {
    format!("\"{}\"", term.replace('"', "\"\""))
}

fn build_match_query(query: &str) -> CommandResult<(String, Vec<String>)> {
    let terms = collect_search_terms(query)
        .into_iter()
        .filter(|term| !(is_all_cjk(term) && term.chars().count() > 3))
        .take(MAX_SEARCH_TERMS)
        .collect::<Vec<_>>();
    if terms.is_empty() {
        return Err("检索关键词过短或缺少可索引文本。".into());
    }
    let match_query = terms
        .iter()
        .map(|term| quote_fts_term(term))
        .collect::<Vec<_>>()
        .join(" OR ");
    Ok((match_query, terms))
}

fn token_estimate(value: &str) -> usize {
    (value.chars().count() / 2).clamp(1, 4_000)
}

fn content_hash(value: &str) -> String {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let mut hash = FNV_OFFSET_BASIS;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{hash:016x}")
}

fn line_char_offsets(lines: &[String]) -> Vec<usize> {
    let mut offsets = Vec::with_capacity(lines.len());
    let mut current = 0;
    for line in lines {
        offsets.push(current);
        current += line.chars().count() + 1;
    }
    offsets
}

fn heading_title(line: &str) -> Option<String> {
    let trimmed = line.trim_start();
    if !trimmed.starts_with('#') {
        return None;
    }
    let title = trimmed.trim_start_matches('#').trim();
    if title.is_empty() {
        None
    } else {
        Some(title.to_string())
    }
}

fn chunk_target_chars(source_kind: &str, extension: Option<&str>) -> usize {
    if source_kind == "chapter" {
        CHAPTER_CHUNK_TARGET_CHARS
    } else if extension == Some(".json") || source_kind == "project_status" {
        JSON_CHUNK_TARGET_CHARS
    } else {
        DEFAULT_CHUNK_TARGET_CHARS
    }
}

fn split_into_chunks(
    contents: &str,
    source_kind: &str,
    extension: Option<&str>,
) -> Vec<SearchChunk> {
    let (lines, _) = split_text_lines(contents);
    let offsets = line_char_offsets(&lines);
    let target_chars = chunk_target_chars(source_kind, extension);
    let mut chunks = Vec::new();
    let mut start_index = 0_usize;
    let mut current_chars = 0_usize;
    let mut current_heading: Option<String> = None;

    for (index, line) in lines.iter().enumerate() {
        let next_heading = heading_title(line);
        if next_heading.is_some() && index > start_index {
            chunks.push(build_chunk(
                &lines,
                &offsets,
                start_index,
                index - 1,
                current_heading.clone(),
            ));
            start_index = index;
            current_chars = 0;
        }
        if let Some(title) = next_heading {
            current_heading = Some(title);
        }

        current_chars += line.chars().count() + 1;
        let should_split = current_chars >= target_chars && line.trim().is_empty();
        let must_split = current_chars >= MAX_CHUNK_CHARS;
        if (should_split || must_split) && index >= start_index {
            chunks.push(build_chunk(
                &lines,
                &offsets,
                start_index,
                index,
                current_heading.clone(),
            ));
            start_index = index + 1;
            current_chars = 0;
        }
    }

    if start_index < lines.len() {
        chunks.push(build_chunk(
            &lines,
            &offsets,
            start_index,
            lines.len() - 1,
            current_heading,
        ));
    }

    chunks
        .into_iter()
        .filter(|chunk| !chunk.content.trim().is_empty())
        .collect()
}

fn build_chunk(
    lines: &[String],
    offsets: &[usize],
    start_index: usize,
    end_index: usize,
    section_title: Option<String>,
) -> SearchChunk {
    let content = lines[start_index..=end_index].join("\n");
    let char_start = offsets.get(start_index).copied().unwrap_or(0);
    let char_end =
        offsets.get(end_index).copied().unwrap_or(char_start) + lines[end_index].chars().count();
    SearchChunk {
        char_end,
        char_start,
        content,
        end_line: end_index + 1,
        section_title,
        start_line: start_index + 1,
    }
}

/// 清空整库索引（.index.db 只属于一本书，故等价于删除该书全部索引）。
fn delete_all_chunk_fts(connection: &Connection) -> CommandResult<()> {
    connection
        .execute("DELETE FROM workspace_search_chunks_fts", [])
        .map_err(error_to_string)?;
    Ok(())
}

fn delete_all_path_fts(connection: &Connection) -> CommandResult<()> {
    connection
        .execute("DELETE FROM workspace_search_paths_fts", [])
        .map_err(error_to_string)?;
    Ok(())
}

/// 清空整库索引：内部接收已打开的 per-book 连接。
fn delete_all_search_index(connection: &Connection) -> CommandResult<()> {
    delete_all_chunk_fts(connection)?;
    delete_all_path_fts(connection)?;
    connection
        .execute("DELETE FROM workspace_search_chunks", [])
        .map_err(error_to_string)?;
    Ok(())
}

/// 删除指定路径（含其子路径）的索引；接收 per-book 连接。
fn delete_path_search_index(connection: &Connection, path: &str) -> CommandResult<()> {
    connection
        .execute(
            r#"
            DELETE FROM workspace_search_chunks_fts
            WHERE (path = ?1 OR substr(path, 1, length(?1) + 1) = ?1 || '/')
            "#,
            params![path],
        )
        .map_err(error_to_string)?;
    connection
        .execute(
            r#"
            DELETE FROM workspace_search_paths_fts
            WHERE (path = ?1 OR substr(path, 1, length(?1) + 1) = ?1 || '/')
            "#,
            params![path],
        )
        .map_err(error_to_string)?;
    connection
        .execute(
            r#"
            DELETE FROM workspace_search_chunks
            WHERE (path = ?1 OR substr(path, 1, length(?1) + 1) = ?1 || '/')
            "#,
            params![path],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn index_path_entry(
    connection: &Connection,
    entry: &WorkspaceEntry,
    source_kind: &str,
) -> CommandResult<()> {
    let title_text = entry.name.clone();
    let search_text = build_search_text(&[
        &entry.path,
        &entry.name,
        source_kind,
        entry.extension.as_deref().unwrap_or(""),
        &title_text,
    ]);
    connection
        .execute(
            r#"
            INSERT INTO workspace_search_paths_fts (
                path, name, source_kind, title_text, search_text
            ) VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            params![entry.path, entry.name, source_kind, title_text, search_text],
        )
        .map_err(error_to_string)?;
    Ok(())
}

/// 索引文件分块：内容从真实文件现读（store.read_text 已解码，无需 bytes_to_text）。
fn index_file_chunks(
    connection: &Connection,
    store: &WorkspaceStore,
    book_id: &str,
    entry: &WorkspaceEntry,
    source_kind: &str,
    timestamp: u64,
) -> CommandResult<()> {
    // 读不到（如二进制/不存在）则跳过，不阻断整体索引。
    let Ok(contents) = store.read_text(book_id, &entry.path) else {
        return Ok(());
    };
    for (index, chunk) in split_into_chunks(&contents, source_kind, entry.extension.as_deref())
        .into_iter()
        .enumerate()
    {
        // chunk_id 仅需在本书索引库内唯一，故用 path:index 即可。
        let chunk_id = format!("{}:{index}", entry.path);
        let section_title = chunk.section_title.unwrap_or_else(|| entry.name.clone());
        let search_text = build_search_text(&[
            &entry.path,
            &entry.name,
            source_kind,
            &section_title,
            &chunk.content,
        ]);
        connection
            .execute(
                r#"
                INSERT INTO workspace_search_chunks (
                    id, path, chunk_index, source_kind, section_title,
                    start_line, end_line, char_start, char_end, token_estimate,
                    content_hash, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                "#,
                params![
                    chunk_id,
                    entry.path,
                    index as i64,
                    source_kind,
                    section_title,
                    chunk.start_line as i64,
                    chunk.end_line as i64,
                    chunk.char_start as i64,
                    chunk.char_end as i64,
                    token_estimate(&chunk.content) as i64,
                    content_hash(&chunk.content),
                    timestamp as i64,
                ],
            )
            .map_err(error_to_string)?;
        connection
            .execute(
                r#"
                INSERT INTO workspace_search_chunks_fts (
                    chunk_id, path, source_kind, section_title, content, search_text
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                "#,
                params![
                    chunk_id,
                    entry.path,
                    source_kind,
                    section_title,
                    chunk.content,
                    search_text,
                ],
            )
            .map_err(error_to_string)?;
    }
    Ok(())
}

/// 索引单个条目：路径索引始终写入，文件类型再追加分块索引。
fn index_entry(
    connection: &Connection,
    store: &WorkspaceStore,
    book_id: &str,
    entry: &WorkspaceEntry,
) -> CommandResult<()> {
    let timestamp = crate::infrastructure::workspace_paths::now_timestamp();
    let source_kind = classify_source_kind(&entry.path, &entry.kind, entry.extension.as_deref());
    index_path_entry(connection, entry, &source_kind)?;
    if entry.kind == "file" {
        index_file_chunks(connection, store, book_id, entry, &source_kind, timestamp)?;
    }
    Ok(())
}

/// 对外入口：增量重建某条路径的索引（删旧 + 现读重建）。
pub(crate) fn reindex_workspace_entry(
    store: &WorkspaceStore,
    book_id: &str,
    path: &str,
) -> CommandResult<()> {
    let connection = store.open_index(book_id)?;
    delete_path_search_index(&connection, path)?;
    if let Some(entry) = store.entry_record(book_id, path)? {
        index_entry(&connection, store, book_id, &entry)?;
    }
    Ok(())
}

/// 对外入口：重命名/移动后子树增量重建索引。
/// 删旧路径子树索引（含全部子项），再只读新路径子树真实文件重建——不触碰其余文件。
pub(crate) fn reindex_subtree_after_rename(
    store: &WorkspaceStore,
    book_id: &str,
    old_path: &str,
    new_path: &str,
) -> CommandResult<()> {
    let connection = store.open_index(book_id)?;
    delete_path_search_index(&connection, old_path)?;
    // 防御：new_path 落在 old_path 子树内时（理论上不会发生），上面已连带删除，重建即可补回。
    delete_path_search_index(&connection, new_path)?;
    for entry in store.collect_subtree_entries(book_id, new_path)? {
        index_entry(&connection, store, book_id, &entry)?;
    }
    Ok(())
}

/// 对外入口：删除后子树增量清理索引（文件已不存在，只删不重建）。
pub(crate) fn reindex_subtree_after_delete(
    store: &WorkspaceStore,
    book_id: &str,
    removed_path: &str,
) -> CommandResult<()> {
    let connection = store.open_index(book_id)?;
    delete_path_search_index(&connection, removed_path)?;
    Ok(())
}

/// 对外入口：全量重建某本书的索引（清空 + 遍历真实文件树）。
pub(crate) fn rebuild_book_search_index(
    store: &WorkspaceStore,
    book_id: &str,
) -> CommandResult<()> {
    let connection = store.open_index(book_id)?;
    delete_all_search_index(&connection)?;
    for entry in store.collect_all_entries(book_id)? {
        index_entry(&connection, store, book_id, &entry)?;
    }
    Ok(())
}

/// 确保索引已就绪并与真实文件树一致：
/// 真实文件数与已索引 path 数不一致（含为空、或因某次操作中途失败导致的漂移）时全量重建。
/// 文件系统是唯一事实源，索引随时可由它重建，故以文件数为基准对账。
fn ensure_book_search_index(
    connection: &Connection,
    store: &WorkspaceStore,
    book_id: &str,
) -> CommandResult<()> {
    let entries = store.collect_all_entries(book_id)?;
    if entries.is_empty() {
        // 真实文件树为空：若索引残留（上次删除后对账未跑）也一并清空,保持一致。
        let indexed_count = connection
            .query_row(
                "SELECT COUNT(*) FROM workspace_search_paths_fts",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(error_to_string)?;
        if indexed_count != 0 {
            delete_all_search_index(connection)?;
        }
        return Ok(());
    }
    let indexed_count = connection
        .query_row(
            "SELECT COUNT(*) FROM workspace_search_paths_fts",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(error_to_string)?;
    // path 索引每条目一行,行数应等于真实文件树条目数。不一致即说明索引漂移
    // （首建为 0,或某次 reindex/relations 在文件操作后中途失败留下陈旧/缺失项）→ 全量重建。
    if indexed_count != entries.len() as i64 {
        delete_all_search_index(connection)?;
        for entry in &entries {
            index_entry(connection, store, book_id, entry)?;
        }
    }
    Ok(())
}

fn collect_chunk_hits(
    connection: &Connection,
    match_query: &str,
    limit: usize,
) -> CommandResult<Vec<RawHit>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT
                c.id,
                c.path,
                c.source_kind,
                c.section_title,
                c.start_line,
                c.end_line,
                c.token_estimate,
                f.content,
                bm25(workspace_search_chunks_fts) AS rank
            FROM workspace_search_chunks_fts f
            JOIN workspace_search_chunks c ON c.id = f.chunk_id
            WHERE workspace_search_chunks_fts MATCH ?1
            ORDER BY rank ASC
            LIMIT ?2
            "#,
        )
        .map_err(error_to_string)?;
    let rows = statement
        .query_map(params![match_query, limit as i64], |row| {
            let rank = row.get::<_, f64>(8)?;
            Ok(RawHit {
                id: row.get(0)?,
                path: display_relative_path(&row.get::<_, String>(1)?),
                source_kind: row.get(2)?,
                section_title: row.get(3)?,
                start_line: row.get::<_, i64>(4)? as usize,
                end_line: row.get::<_, i64>(5)? as usize,
                token_estimate: row.get::<_, i64>(6)? as usize,
                content: row.get(7)?,
                score: -rank,
            })
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;
    Ok(rows)
}

fn collect_path_hits(
    connection: &Connection,
    match_query: &str,
    limit: usize,
) -> CommandResult<Vec<RawHit>> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT path, name, source_kind, bm25(workspace_search_paths_fts) AS rank
            FROM workspace_search_paths_fts
            WHERE workspace_search_paths_fts MATCH ?1
            ORDER BY rank ASC
            LIMIT ?2
            "#,
        )
        .map_err(error_to_string)?;
    let path_rows = statement
        .query_map(params![match_query, limit as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, f64>(3)?,
            ))
        })
        .map_err(error_to_string)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(error_to_string)?;

    let mut hits = Vec::new();
    for (path, name, source_kind, rank) in path_rows {
        if let Some(chunk) = first_chunk_for_path(connection, &path)? {
            hits.push(RawHit {
                score: -rank + 4.0,
                ..chunk
            });
            continue;
        }
        hits.push(RawHit {
            content: format!("路径命中：{}", display_relative_path(&path)),
            end_line: 1,
            id: format!("path:{path}"),
            path: display_relative_path(&path),
            score: -rank + 4.0,
            section_title: Some(name),
            source_kind,
            start_line: 1,
            token_estimate: 24,
        });
    }
    Ok(hits)
}

fn first_chunk_for_path(connection: &Connection, path: &str) -> CommandResult<Option<RawHit>> {
    let result = connection
        .query_row(
            r#"
            SELECT
                c.id,
                c.path,
                c.source_kind,
                c.section_title,
                c.start_line,
                c.end_line,
                c.token_estimate,
                f.content
            FROM workspace_search_chunks c
            JOIN workspace_search_chunks_fts f ON f.chunk_id = c.id
            WHERE c.path = ?1
            ORDER BY c.chunk_index ASC
            LIMIT 1
            "#,
            params![path],
            |row| {
                Ok(RawHit {
                    id: row.get(0)?,
                    path: display_relative_path(&row.get::<_, String>(1)?),
                    source_kind: row.get(2)?,
                    section_title: row.get(3)?,
                    start_line: row.get::<_, i64>(4)? as usize,
                    end_line: row.get::<_, i64>(5)? as usize,
                    token_estimate: row.get::<_, i64>(6)? as usize,
                    content: row.get(7)?,
                    score: 0.0,
                })
            },
        )
        .optional()
        .map_err(error_to_string)?;
    Ok(result)
}

fn has_adjacent_chunk(connection: &Connection, path: &str, start_line: usize) -> bool {
    connection
        .query_row(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM workspace_search_chunks
                WHERE path = ?1 AND end_line < ?2
                UNION ALL
                SELECT 1 FROM workspace_search_chunks
                WHERE path = ?1 AND start_line > ?2
                LIMIT 1
            )
            "#,
            params![path, start_line as i64],
            |row| row.get::<_, i64>(0),
        )
        .map(|value| value != 0)
        .unwrap_or(false)
}

fn query_terms_present(content: &str, terms: &[String]) -> Vec<String> {
    let haystack = build_search_text(&[content]);
    let haystack_terms = haystack.split_whitespace().collect::<HashSet<_>>();
    terms
        .iter()
        .filter(|term| haystack_terms.contains(term.as_str()))
        .cloned()
        .collect()
}

fn direct_contains_boost(path: &str, title: Option<&str>, content: &str, query: &str) -> f64 {
    let lowered_query = query.to_lowercase();
    let lowered_path = path.to_lowercase();
    let lowered_title = title.unwrap_or("").to_lowercase();
    let lowered_content = content.to_lowercase();
    let mut boost = 0.0;
    if lowered_path.contains(&lowered_query) {
        boost += 5.0;
    }
    if lowered_title.contains(&lowered_query) {
        boost += 4.0;
    }
    if lowered_content.contains(&lowered_query) {
        boost += 2.0;
    }
    boost
}

fn build_reason(hit: &RawHit, query: &str, matched_terms: &[String], intent: &str) -> String {
    let mut reasons = Vec::new();
    if hit.path.to_lowercase().contains(&query.to_lowercase()) {
        reasons.push("路径命中".to_string());
    }
    if hit
        .section_title
        .as_deref()
        .is_some_and(|title| title.to_lowercase().contains(&query.to_lowercase()))
    {
        reasons.push("标题命中".to_string());
    }
    if !matched_terms.is_empty() {
        reasons.push(format!("上下文命中：{}", matched_terms.join("、")));
    }
    if intent != "auto" {
        reasons.push(format!("intent={intent}"));
    }
    reasons.push(format!("source={}", hit.source_kind));
    reasons.join("；")
}

fn trim_preview(content: &str) -> String {
    if content.chars().count() <= MAX_PREVIEW_CHARS {
        return content.trim().to_string();
    }
    let mut preview = content.chars().take(MAX_PREVIEW_CHARS).collect::<String>();
    preview.push_str("...");
    preview.trim().to_string()
}

fn assemble_results(
    connection: &Connection,
    query: &str,
    intent: &str,
    terms: &[String],
    raw_hits: Vec<RawHit>,
    limit: usize,
    token_budget: usize,
    scope: &[String],
) -> CommandResult<(Vec<WorkspaceContextHit>, bool)> {
    let mut unique = HashMap::<String, RawHit>::new();
    for hit in raw_hits {
        if !is_path_in_scope(&hit.path, scope) {
            continue;
        }
        let entry = unique.entry(hit.id.clone()).or_insert_with(|| RawHit {
            content: hit.content.clone(),
            end_line: hit.end_line,
            id: hit.id.clone(),
            path: hit.path.clone(),
            score: f64::MIN,
            section_title: hit.section_title.clone(),
            source_kind: hit.source_kind.clone(),
            start_line: hit.start_line,
            token_estimate: hit.token_estimate,
        });
        entry.score = entry.score.max(hit.score);
    }

    let mut ranked = unique
        .into_values()
        .map(|mut hit| {
            hit.score += source_kind_boost(&hit.source_kind);
            hit.score += intent_boost(intent, &hit.source_kind);
            hit.score +=
                direct_contains_boost(&hit.path, hit.section_title.as_deref(), &hit.content, query);
            let matched_count = query_terms_present(
                &format!(
                    "{}\n{}\n{}",
                    hit.path,
                    hit.section_title.clone().unwrap_or_default(),
                    hit.content
                ),
                terms,
            )
            .len();
            hit.score += matched_count as f64 * 1.5;
            hit
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.path.cmp(&right.path))
            .then_with(|| left.start_line.cmp(&right.start_line))
    });

    let mut results = Vec::new();
    let mut used_tokens = 0_usize;
    let mut path_counts = HashMap::<String, usize>::new();
    let mut truncated = false;
    for hit in ranked {
        let count = path_counts.entry(hit.path.clone()).or_default();
        if *count >= 2 {
            truncated = true;
            continue;
        }
        if results.len() >= limit || used_tokens + hit.token_estimate > token_budget {
            truncated = true;
            break;
        }
        *count += 1;
        used_tokens += hit.token_estimate;
        let matched_terms = query_terms_present(
            &format!(
                "{}\n{}\n{}",
                hit.path,
                hit.section_title.clone().unwrap_or_default(),
                hit.content
            ),
            terms,
        );
        let reason = build_reason(&hit, query, &matched_terms, intent);
        results.push(WorkspaceContextHit {
            adjacent_available: has_adjacent_chunk(connection, &hit.path, hit.start_line),
            end_line: hit.end_line,
            id: hit.id,
            matched_terms,
            path: hit.path,
            preview: trim_preview(&hit.content),
            reason,
            score: (hit.score * 100.0).round() / 100.0,
            section_title: hit.section_title,
            source_kind: hit.source_kind,
            start_line: hit.start_line,
        });
    }
    Ok((results, truncated))
}

fn build_suggested_reads(results: &[WorkspaceContextHit]) -> Vec<WorkspaceReadSuggestion> {
    let mut seen = HashSet::new();
    results
        .iter()
        .filter(|hit| seen.insert(hit.path.clone()))
        .take(5)
        .map(|hit| WorkspaceReadSuggestion {
            end_line: hit.end_line,
            path: hit.path.clone(),
            reason: format!("高置信 {} 证据，编辑前建议精读。", hit.source_kind),
            start_line: hit.start_line,
        })
        .collect()
}

pub(crate) fn search_workspace_content_db(
    store: &WorkspaceStore,
    book_id: &str,
    query: &str,
    limit: Option<usize>,
    intent: Option<&str>,
    scope: Option<Vec<String>>,
    token_budget: Option<usize>,
    include_adjacent: Option<bool>,
    registry: &ToolCancellationRegistry,
    request_id: Option<&str>,
) -> CommandResult<WorkspaceSearchResult> {
    // 由 book_id 取书,打开该书的 per-book 索引库操作。
    let book = load_book_by_id(store, book_id)?;
    check_cancellation(registry, request_id)?;
    let connection = store.open_index(&book.id)?;
    ensure_book_search_index(&connection, store, &book.id)?;
    check_cancellation(registry, request_id)?;

    let normalized_query = normalize_search_query(query)?;
    let normalized_intent = normalize_intent(intent);
    let normalized_scope = normalize_scope(scope);
    let normalized_limit = normalize_search_limit(limit);
    let normalized_token_budget = normalize_token_budget(token_budget);
    let (match_query, terms) = build_match_query(&normalized_query)?;
    let raw_limit = normalized_limit
        * if include_adjacent.unwrap_or(true) {
            8
        } else {
            5
        };

    let mut raw_hits = collect_chunk_hits(&connection, &match_query, raw_limit)?;
    check_cancellation(registry, request_id)?;
    raw_hits.extend(collect_path_hits(&connection, &match_query, raw_limit)?);
    check_cancellation(registry, request_id)?;

    let (results, truncated) = assemble_results(
        &connection,
        &normalized_query,
        &normalized_intent,
        &terms,
        raw_hits,
        normalized_limit,
        normalized_token_budget,
        &normalized_scope,
    )?;
    let suggested_reads = build_suggested_reads(&results);

    Ok(WorkspaceSearchResult {
        intent: normalized_intent,
        query: normalized_query,
        results,
        strategy: "sqlite_fts5_ngram_chunks".into(),
        suggested_reads,
        token_budget: normalized_token_budget,
        truncated,
    })
}

trait OptionalRow<T> {
    fn optional(self) -> rusqlite::Result<Option<T>>;
}

impl<T> OptionalRow<T> for rusqlite::Result<T> {
    fn optional(self) -> rusqlite::Result<Option<T>> {
        match self {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error),
        }
    }
}
