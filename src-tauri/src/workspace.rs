use crate::{db::open_database, ToolCancellationRegistry};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    io::{Cursor, Read, Seek, Write},
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

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

type CommandResult<T> = Result<T, String>;

const INVALID_NAME_CHARS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
const DEFAULT_SEARCH_LIMIT: usize = 50;
const MAX_SEARCH_LIMIT: usize = 200;
const REQUIRED_BOOK_WORKSPACE_FILES: [&str; 2] = ["README.md", "04_正文/创作状态追踪器.json"];
const MAX_BOOK_ARCHIVE_ENTRIES: usize = 5_000;
const MAX_BOOK_ARCHIVE_FILE_SIZE: u64 = 10 * 1024 * 1024;
const MAX_BOOK_ARCHIVE_TOTAL_SIZE: u64 = 256 * 1024 * 1024;
const MAX_BOOK_ARCHIVE_DEPTH: usize = 12;
const MAX_BOOK_ARCHIVE_COMPRESSION_RATIO: u64 = 200;

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn normalize_path_string(value: String) -> String {
    let normalized = value.replace('\\', "/");
    if let Some(path) = normalized.strip_prefix("//?/UNC/") {
        return format!("//{}", path);
    }
    if let Some(path) = normalized.strip_prefix("//?/") {
        return path.to_string();
    }
    normalized
}

fn normalize_path(path: &Path) -> String {
    normalize_path_string(path.to_string_lossy().to_string())
}

fn entry_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| normalize_path(path))
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(normalize_path)
        .unwrap_or_else(|_| normalize_path(path))
}

fn display_relative_path(root: &Path, path: &Path) -> String {
    let relative = relative_path(root, path);
    if relative.is_empty() {
        ".".into()
    } else {
        relative
    }
}

fn file_extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|extension| format!(".{}", extension.to_string_lossy().to_lowercase()))
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

fn validate_adjacent_context(
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

fn collect_workspace_search_matches(
    root: &Path,
    current: &Path,
    query: &str,
    limit: usize,
    matches: &mut Vec<WorkspaceSearchMatch>,
    registry: &ToolCancellationRegistry,
    request_id: Option<&str>,
) -> CommandResult<()> {
    check_cancellation(registry, request_id)?;
    for entry in fs::read_dir(current).map_err(error_to_string)? {
        check_cancellation(registry, request_id)?;
        let path = entry.map_err(error_to_string)?.path();
        let name = entry_name(&path);

        let lowered_name = name.to_lowercase();
        let display_path = display_relative_path(root, &path);

        if path.is_dir() {
            if lowered_name.contains(query)
                && push_search_match(
                    matches,
                    "directory_name",
                    display_path.clone(),
                    None,
                    None,
                    limit,
                )
            {
                return Ok(());
            }

            collect_workspace_search_matches(
                root, &path, query, limit, matches, registry, request_id,
            )?;
            if matches.len() >= limit {
                return Ok(());
            }
            continue;
        }

        if lowered_name.contains(query)
            && push_search_match(
                matches,
                "file_name",
                display_path.clone(),
                None,
                None,
                limit,
            )
        {
            return Ok(());
        }

        if matches.len() >= limit {
            return Ok(());
        }
        let Ok(contents) = fs::read_to_string(&path) else {
            continue;
        };

        for (index, line) in contents.lines().enumerate() {
            check_cancellation(registry, request_id)?;
            if !line.to_lowercase().contains(query) {
                continue;
            }

            if push_search_match(
                matches,
                "content",
                display_path.clone(),
                Some(index + 1),
                Some(line.to_string()),
                limit,
            ) {
                return Ok(());
            }
        }
    }

    Ok(())
}

fn ensure_root_directory(root_path: &str) -> CommandResult<PathBuf> {
    let root = PathBuf::from(root_path);
    if !root.exists() {
        return Err("书籍目录不存在。".into());
    }
    if !root.is_dir() {
        return Err("所选路径不是文件夹。".into());
    }
    fs::canonicalize(root).map_err(error_to_string)
}

fn resolve_path_from_root(root: &Path, path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "." {
        return root.to_path_buf();
    }

    let candidate = PathBuf::from(trimmed);
    if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    }
}

fn normalize_candidate_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                let _ = normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    normalized
}

fn path_depth(path: &Path) -> usize {
    path.components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count()
}

fn is_ignored_book_archive_path(path: &Path) -> bool {
    path.components().any(|component| {
        let Component::Normal(name) = component else {
            return false;
        };
        let value = name.to_string_lossy();
        value == "__MACOSX" || value == ".DS_Store" || value == "Thumbs.db"
    })
}

fn preview_archive_paths(paths: &[PathBuf]) -> String {
    let preview = paths
        .iter()
        .take(8)
        .map(|path| normalize_path(path))
        .collect::<Vec<_>>()
        .join("，");

    if preview.is_empty() {
        "无可用文件".into()
    } else {
        preview
    }
}

fn collect_book_archive_file_paths<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> CommandResult<Vec<PathBuf>> {
    if archive.len() == 0 {
        return Err("ZIP 压缩包为空。".into());
    }
    if archive.len() > MAX_BOOK_ARCHIVE_ENTRIES {
        return Err("ZIP 内文件数量过多。".into());
    }

    let mut safe_paths = Vec::new();
    let mut total_uncompressed = 0_u64;

    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(error_to_string)?;
        let Some(path) = entry.enclosed_name() else {
            return Err("ZIP 内存在非法路径。".into());
        };
        if path_depth(&path) > MAX_BOOK_ARCHIVE_DEPTH {
            return Err("ZIP 内目录层级过深。".into());
        }
        if entry.size() > MAX_BOOK_ARCHIVE_FILE_SIZE {
            return Err("ZIP 内单个文件过大。".into());
        }
        if entry.compressed_size() > 0
            && entry.size() / entry.compressed_size().max(1) > MAX_BOOK_ARCHIVE_COMPRESSION_RATIO
        {
            return Err("ZIP 压缩比异常，已拒绝导入。".into());
        }

        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_BOOK_ARCHIVE_TOTAL_SIZE {
            return Err("ZIP 解压后的总大小超出限制。".into());
        }

        if entry.is_dir() || is_ignored_book_archive_path(&path) {
            continue;
        }

        safe_paths.push(path.to_path_buf());
    }

    if safe_paths.is_empty() {
        return Err("ZIP 中没有可导入的文件。".into());
    }

    Ok(safe_paths)
}

fn archive_contains_required_book_files(
    file_set: &HashSet<String>,
    prefix: &Path,
) -> bool {
    REQUIRED_BOOK_WORKSPACE_FILES.iter().all(|relative_path| {
        let candidate = if prefix.as_os_str().is_empty() {
            PathBuf::from(relative_path)
        } else {
            prefix.join(relative_path)
        };
        file_set.contains(&normalize_path(&candidate))
    })
}

fn detect_book_archive_root(file_paths: &[PathBuf]) -> CommandResult<PathBuf> {
    let file_set = file_paths
        .iter()
        .map(|path| normalize_path(path))
        .collect::<HashSet<_>>();
    let mut candidates = vec![PathBuf::new()];
    let mut seen = HashSet::from([String::new()]);

    for path in file_paths {
        let mut current = path.parent();
        while let Some(prefix) = current {
            let normalized_prefix = normalize_path(prefix);
            if seen.insert(normalized_prefix) {
                candidates.push(prefix.to_path_buf());
            }
            current = prefix.parent();
        }
    }

    let matching_roots = candidates
        .into_iter()
        .filter(|prefix| archive_contains_required_book_files(&file_set, prefix))
        .collect::<Vec<_>>();

    if matching_roots.is_empty() {
        return Err(format!(
            "ZIP 中未找到有效书籍工作区。至少需要包含 README.md 和 04_正文/创作状态追踪器.json。检测到的文件示例：{}",
            preview_archive_paths(file_paths)
        ));
    }

    if matching_roots.len() > 1 {
        let options = matching_roots
            .iter()
            .map(|prefix| {
                if prefix.as_os_str().is_empty() {
                    "<压缩包根目录>".into()
                } else {
                    normalize_path(prefix)
                }
            })
            .collect::<Vec<_>>()
            .join("，");

        return Err(format!(
            "ZIP 中检测到多个书籍工作区，当前仅支持单书导入。检测到：{}",
            options
        ));
    }

    Ok(matching_roots[0].clone())
}

fn derive_imported_book_name(root_prefix: &Path, file_name: &str) -> CommandResult<String> {
    let candidate = root_prefix
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            Path::new(file_name)
                .file_stem()
                .and_then(|name| name.to_str())
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToOwned::to_owned)
        })
        .ok_or_else(|| "无法确定导入书籍名称。".to_string())?;

    validate_name(&candidate)
}

fn import_book_archive_to_library(
    books_root: &Path,
    file_name: &str,
    archive_bytes: Vec<u8>,
) -> CommandResult<PathBuf> {
    let mut archive = ZipArchive::new(Cursor::new(archive_bytes)).map_err(error_to_string)?;
    let file_paths = collect_book_archive_file_paths(&mut archive)?;
    let root_prefix = detect_book_archive_root(&file_paths)?;
    let book_name = derive_imported_book_name(&root_prefix, file_name)?;
    let target_root = books_root.join(&book_name);

    if target_root.exists() {
        return Err("同名书籍已存在，请先重命名现有书籍或导入其他压缩包。".into());
    }

    fs::create_dir_all(&target_root).map_err(error_to_string)?;
    let import_result = (|| -> CommandResult<()> {
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(error_to_string)?;
            if entry.is_dir() {
                continue;
            }

            let Some(safe_path) = entry.enclosed_name() else {
                continue;
            };
            if is_ignored_book_archive_path(&safe_path) {
                continue;
            }

            let relative_path = if root_prefix.as_os_str().is_empty() {
                safe_path.to_path_buf()
            } else {
                let Ok(path) = safe_path.strip_prefix(&root_prefix) else {
                    continue;
                };
                if path.as_os_str().is_empty() {
                    continue;
                }
                path.to_path_buf()
            };

            let target_path = target_root.join(&relative_path);
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(error_to_string)?;
            }

            let mut output = fs::File::create(&target_path).map_err(error_to_string)?;
            std::io::copy(&mut entry, &mut output).map_err(error_to_string)?;
        }

        if !is_book_workspace_directory(&target_root) {
            return Err("导入的 ZIP 不是有效的书籍工作区。".into());
        }

        Ok(())
    })();

    if let Err(error) = import_result {
        let _ = fs::remove_dir_all(&target_root);
        return Err(error);
    }

    Ok(target_root)
}

fn ensure_book_workspace_in_library(books_root: &Path, root_path: &str) -> CommandResult<PathBuf> {
    let workspace_path = ensure_existing_path_in_root(books_root, root_path)?;
    if !is_book_workspace_directory(&workspace_path) {
        return Err("目标书籍不存在，或不是有效的书籍工作区。".into());
    }

    Ok(workspace_path)
}

fn append_workspace_directory_to_archive<W: Write + Seek>(
    archive: &mut ZipWriter<W>,
    root_path: &Path,
    current_path: &Path,
) -> CommandResult<()> {
    if current_path != root_path {
        let directory_name = format!("{}/", relative_path(root_path, current_path));
        archive
            .add_directory(
                directory_name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .map_err(error_to_string)?;
    }

    let mut entries = fs::read_dir(current_path)
        .map_err(error_to_string)?
        .map(|entry| entry.map(|entry| entry.path()).map_err(error_to_string))
        .collect::<CommandResult<Vec<_>>>()?;
    entries.sort_by(|left, right| relative_path(root_path, left).cmp(&relative_path(root_path, right)));

    for path in entries {
        if path.is_dir() {
            append_workspace_directory_to_archive(archive, root_path, &path)?;
            continue;
        }

        if !path.is_file() {
            continue;
        }

        let archive_path = relative_path(root_path, &path);
        archive
            .start_file(
                archive_path,
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .map_err(error_to_string)?;

        let mut input = fs::File::open(&path).map_err(error_to_string)?;
        std::io::copy(&mut input, archive).map_err(error_to_string)?;
    }

    Ok(())
}

fn export_book_workspace_archive(workspace_path: &Path) -> CommandResult<Vec<u8>> {
    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    append_workspace_directory_to_archive(&mut archive, workspace_path, workspace_path)?;
    archive.finish().map_err(error_to_string).map(|cursor| cursor.into_inner())
}

fn delete_book_workspace_internal(books_root: &Path, root_path: &str) -> CommandResult<()> {
    let workspace_path = ensure_book_workspace_in_library(books_root, root_path)?;
    fs::remove_dir_all(&workspace_path).map_err(error_to_string)
}

fn ensure_existing_path_in_root(root: &Path, path: &str) -> CommandResult<PathBuf> {
    let target = resolve_path_from_root(root, path);
    if !target.exists() {
        return Err("目标路径不存在。".into());
    }

    let canonical_root = fs::canonicalize(root).map_err(error_to_string)?;
    let canonical_target = fs::canonicalize(target).map_err(error_to_string)?;

    if !canonical_target.starts_with(&canonical_root) {
        return Err("目标路径不在当前书籍目录内。".into());
    }

    Ok(canonical_target)
}

fn ensure_path_in_root(root: &Path, path: &str) -> CommandResult<PathBuf> {
    let target = normalize_candidate_path(&resolve_path_from_root(root, path));
    let canonical_root = fs::canonicalize(root).map_err(error_to_string)?;

    if !target.starts_with(&canonical_root) {
        return Err("目标路径不在当前书籍目录内。".into());
    }

    Ok(target)
}

fn ensure_parent_directory_in_root(root: &Path, parent_path: &str) -> CommandResult<PathBuf> {
    let parent = resolve_path_from_root(root, parent_path);
    if !parent.exists() || !parent.is_dir() {
        return Err("父级目录不存在。".into());
    }

    let canonical_root = fs::canonicalize(root).map_err(error_to_string)?;
    let canonical_parent = fs::canonicalize(parent).map_err(error_to_string)?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err("父级目录不在当前书籍目录内。".into());
    }

    Ok(canonical_parent)
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
        .any(|char| INVALID_NAME_CHARS.contains(&char))
    {
        return Err("名称不能包含 < > : \" / \\ | ? *。".into());
    }
    Ok(trimmed.to_string())
}

fn normalize_text_file_name(value: &str) -> CommandResult<String> {
    let validated = validate_name(value)?;
    let path = Path::new(&validated);
    let next_name = if path.extension().is_none() {
        format!("{validated}.md")
    } else {
        validated
    };

    let extension = file_extension(Path::new(&next_name)).unwrap_or_default();
    if extension != ".md" && extension != ".txt" && extension != ".json" {
        return Err("只能创建 .md、.txt 或 .json 文件。".into());
    }

    Ok(next_name)
}

fn build_rename_target_name(source_path: &Path, next_name: &str) -> CommandResult<String> {
    let validated = validate_name(next_name)?;
    if source_path.is_dir() {
        return Ok(validated);
    }

    if Path::new(&validated).extension().is_some() {
        return Ok(validated);
    }

    let current_extension = file_extension(source_path).unwrap_or_default();
    Ok(format!("{validated}{current_extension}"))
}

fn build_move_target_path(source_path: &Path, target_parent_path: &Path) -> CommandResult<PathBuf> {
    let entry_name = source_path
        .file_name()
        .ok_or_else(|| "无法解析当前路径名称。".to_string())?;
    Ok(target_parent_path.join(entry_name))
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

fn build_tree(
    root: &Path,
    current: &Path,
    registry: &ToolCancellationRegistry,
    request_id: Option<&str>,
) -> CommandResult<TreeNode> {
    check_cancellation(registry, request_id)?;
    let metadata = fs::metadata(current).map_err(error_to_string)?;
    let mut node = TreeNode {
        children: None,
        extension: if metadata.is_file() {
            file_extension(current)
        } else {
            None
        },
        kind: if metadata.is_dir() {
            "directory".into()
        } else {
            "file".into()
        },
        name: entry_name(current),
        path: normalize_path(current),
    };

    if metadata.is_dir() {
        let mut children = Vec::new();
        for entry in fs::read_dir(current).map_err(error_to_string)? {
            check_cancellation(registry, request_id)?;
            let child_path = entry.map_err(error_to_string)?.path();
            children.push(build_tree(root, &child_path, registry, request_id)?);
        }
        sort_tree_nodes(&mut children);
        let _ = root;
        node.children = Some(children);
    }

    Ok(node)
}

fn create_book_readme_template(book_name: &str) -> String {
    format!(
        "# 项目名称：{book_name}\n**类型**：待补充\n**AI 助理任务**：协助作者在遵循设定集的基础上，完成高质量的章节创作、逻辑校验与伏笔埋设。\n\n## ⚠️ 核心操作协议\n1. **环境初始化**：每次对话开始前，请先索引 `01_世界观设定/` 与 `02_角色设定/`。\n2. **逻辑前置**：创作新章节前，必须读取 `04_正文/创作状态追踪器.json` 以获取最新剧情坐标。\n3. **输出闭环**：每完成一章创作，需同步更新 `03_剧情大纲/伏笔与线索追踪.md`。\n\n## 当前开发里程碑\n- [ ] 设定完善（进行中）\n- [ ] 第一卷大纲定稿\n- [ ] 正文连载中\n"
    )
}

fn build_book_template(book_name: &str) -> (Vec<&'static str>, Vec<(&'static str, String)>) {
    (
        vec![
            "00_系统指令",
            "01_世界观设定",
            "02_角色设定",
            "03_剧情大纲",
            "03_剧情大纲/卷次详细大纲",
            "04_正文",
            "04_正文/第一卷",
            "05_素材资源",
        ],
        vec![
            (
                "README.md",
                create_book_readme_template(book_name),
            ),
            (
                "00_系统指令/写作风格指南.md",
                "# 写作风格指南\n\n## 1. 叙事视角\n- **主要视角**：第三人称有限视角（聚焦主角）\n- **人称偏好**：多用动作描写，少用主观感叹。\n\n## 2. 语言特征\n- **词汇量**：待补充\n- **节奏控制**：战斗场景短句为主；日常场景注重氛围渲染。\n\n## 3. 禁忌事项\n- 严禁：角色 OOC（脱离人设）、战力崩坏、无逻辑的降智行为。\n".into(),
            ),
            (
                "00_系统指令/交互格式规范.md",
                "# 交互格式规范\n\n## 1. 章节输出要求\n- 新建或续写章节时，先给出章节元信息，再输出正文。\n- 正文结束后，补充创作日志与状态更新建议。\n\n## 2. 数据更新要求\n- 涉及角色、地点、伏笔、数值变化时，必须标记建议同步更新的文件。\n- 若信息不足，应先提出缺口，不得擅自补全关键设定。\n\n## 3. 一致性要求\n- 所有命名以本仓库现有术语为准。\n- 若与历史内容冲突，优先列出冲突点再给出修正建议。\n".into(),
            ),
            (
                "01_世界观设定/地理历史背景.md",
                "# 地理历史背景\n\n## 地图与区域\n- 核心大陆：\n- 主要国家 / 势力：\n- 关键边境与交通线：\n\n## 历史脉络\n- 纪年法：\n- 重大历史事件：\n- 影响当下格局的旧案：\n".into(),
            ),
            (
                "01_世界观设定/力量等级体系.md",
                "# 力量等级体系\n\n## 1. 等级划分\n| 境界/级别 | 标志性特征 | 资源消耗 |\n| :--- | :--- | :--- |\n| 初窥门径 | 气感产生 | 基础灵石 |\n| ... | ... | ... |\n\n## 2. 战力判定原则\n- **越级挑战**：必须具备[特定道具/牺牲代价]方能生效。\n- **环境加成**：在[特定地形]下，实力增幅 [X%]。\n".into(),
            ),
            (
                "01_世界观设定/核心术语对照表.md",
                "# 核心术语对照表\n\n| 术语 | 官方定义 | 备注 |\n| :--- | :--- | :--- |\n| 待补充 | 待补充 | 待补充 |\n".into(),
            ),
            (
                "02_角色设定/主角个人档案.md",
                "# 角色档案：[角色名]\n\n## 核心属性\n- **核心动机**：[他最终想要得到什么？]\n- **性格冲突**：[例如：极度利己但无法忍受欺凌弱小]\n- **语言风格**：[例如：逻辑性极强，不使用脏话]\n\n## 状态追踪\n- **初始实力**：\n- **核心技能包**：\n- **已知弱点**：\n".into(),
            ),
            (
                "02_角色设定/重要配角索引.md",
                "# 重要配角索引\n\n## 阵营划分\n- 盟友：\n- 对手：\n- 中立角色：\n\n## 角色功能描述\n| 角色名 | 立场 | 关键作用 | 当前状态 |\n| :--- | :--- | :--- | :--- |\n| 待补充 | 待补充 | 待补充 | 待补充 |\n".into(),
            ),
            (
                "02_角色设定/角色关系矩阵.json",
                "{\n  \"version\": 1,\n  \"updatedAt\": \"\",\n  \"characters\": [],\n  \"relationships\": []\n}\n".into(),
            ),
            (
                "03_剧情大纲/全书架构总纲.md",
                "# 全书架构总纲\n\n## 故事定位\n- 主题：\n- 核心卖点：\n- 目标读者：\n\n## 主线冲突\n- 主角想达成什么：\n- 阻碍主角的核心冲突：\n- 结局方向：\n\n## 关键转折\n1. 开篇引子：\n2. 第一阶段：\n3. 中段升级：\n4. 高潮爆发：\n5. 终局收束：\n".into(),
            ),
            (
                "03_剧情大纲/卷次详细大纲/01_第一卷.md",
                "# 第一卷大纲\n\n## 本卷定位\n- 卷名：第一卷\n- 本卷目标：\n- 本卷冲突：\n\n## 情节推进\n1. 开局：\n2. 发展：\n3. 反转：\n4. 卷末落点：\n".into(),
            ),
            (
                "03_剧情大纲/伏笔与线索追踪.md",
                "# 伏笔与线索追踪\n\n| 编号 | 伏笔/线索 | 首次出现 | 当前状态 | 回收计划 |\n| :--- | :--- | :--- | :--- | :--- |\n| F-001 | 待补充 | 待补充 | 进行中 | 待补充 |\n".into(),
            ),
            (
                "04_正文/章节模板.md",
                "---\n章节: 第[X]章\n标题: [标题名]\n本章核心功能: [例如：角色成长 / 引入反派 / 揭露真相]\n前置状态索引: [关联上一章内容]\n---\n\n# 正文\n\n[此处为 AI 创作的正式章节内容]\n\n---\n## 创作日志（AI 自动填写）\n1. **角色变更**：[哪些人进场/退场]\n2. **地点迁移**：[从 A 移动到 B]\n3. **状态更新**：[主角数值或情感的变化]\n".into(),
            ),
            (
                "04_正文/第一卷/第001章_待命名.md",
                format!(
                    "---\n章节: 第001章\n标题: [待命名]\n本章核心功能: [例如：角色成长 / 引入反派 / 揭露真相]\n前置状态索引: [关联上一章内容]\n关联项目: {book_name}\n---\n\n# 正文\n\n[此处为 AI 创作的正式章节内容]\n\n---\n## 创作日志（AI 自动填写）\n1. **角色变更**：[哪些人进场/退场]\n2. **地点迁移**：[从 A 移动到 B]\n3. **状态更新**：[主角数值或情感的变化]\n"
                ),
            ),
            (
                "04_正文/创作状态追踪器.json",
                format!(
                    "{{\n  \"project\": \"{book_name}\",\n  \"currentVolume\": \"第一卷\",\n  \"currentChapter\": \"第001章\",\n  \"timelineCheckpoint\": \"开篇阶段\",\n  \"activeCharacters\": [],\n  \"activeClues\": [],\n  \"locations\": [],\n  \"lastUpdated\": \"\"\n}}\n"
                ),
            ),
            (
                "05_素材资源/历史参考资料.md",
                "# 历史参考资料\n\n## 现实原型\n- 待补充\n\n## 可借鉴元素\n- 待补充\n".into(),
            ),
            (
                "05_素材资源/场景描绘索引.md",
                "# 场景描绘索引\n\n## 场景目录\n- 地标 / 建筑：\n- 城市 / 聚落：\n- 战场 / 秘境：\n\n## 描绘维度\n- 视觉：\n- 听觉：\n- 气味与触感：\n- 人群活动：\n".into(),
            ),
        ],
    )
}

fn create_book_workspace_internal(parent_path: &Path, book_name: &str) -> CommandResult<PathBuf> {
    let validated_book_name = validate_name(book_name)?;
    let root_path = parent_path.join(&validated_book_name);

    if root_path.exists() {
        return Err("同名书籍已存在。".into());
    }

    fs::create_dir_all(&root_path).map_err(error_to_string)?;
    let setup_result = (|| -> CommandResult<()> {
        let (directories, files) = build_book_template(&validated_book_name);
        for directory in directories {
            fs::create_dir_all(root_path.join(directory)).map_err(error_to_string)?;
        }

        for (relative_path, contents) in files {
            fs::write(root_path.join(relative_path), contents).map_err(error_to_string)?;
        }
        Ok(())
    })();

    if let Err(error) = setup_result {
        let _ = fs::remove_dir_all(&root_path);
        return Err(error);
    }

    Ok(root_path)
}

fn ensure_books_library_root(app: &AppHandle) -> CommandResult<PathBuf> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(error_to_string)?
        .join("books");
    fs::create_dir_all(&root).map_err(error_to_string)?;
    Ok(root)
}

fn now_iso() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn ensure_book_registry_entry(app: &AppHandle, root_path: &Path) -> CommandResult<String> {
    let normalized_root_path = normalize_path(root_path);
    let connection = open_database(app)?;
    let existing_id = connection
        .query_row(
            "SELECT id FROM book_workspace_registry WHERE root_path = ?1",
            params![normalized_root_path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?;

    if let Some(book_id) = existing_id {
        return Ok(book_id);
    }

    let book_id = Uuid::new_v4().to_string();
    connection
        .execute(
            r#"
            INSERT INTO book_workspace_registry (id, root_path, created_at)
            VALUES (?1, ?2, ?3)
            "#,
            params![book_id, normalize_path(root_path), now_iso()],
        )
        .map_err(error_to_string)?;
    Ok(book_id)
}

fn get_book_workspace_path_by_id(app: &AppHandle, book_id: &str) -> CommandResult<PathBuf> {
    let connection = open_database(app)?;
    let root_path = connection
        .query_row(
            "SELECT root_path FROM book_workspace_registry WHERE id = ?1",
            params![book_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?
        .ok_or_else(|| "目标书籍不存在。".to_string())?;

    let books_root = ensure_books_library_root(app)?;
    ensure_book_workspace_in_library(&books_root, &root_path)
}

fn delete_book_registry_entry(app: &AppHandle, root_path: &Path) -> CommandResult<()> {
    let connection = open_database(app)?;
    connection
        .execute(
            "DELETE FROM book_workspace_registry WHERE root_path = ?1",
            params![normalize_path(root_path)],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn build_book_workspace_summary(app: &AppHandle, path: &Path) -> CommandResult<BookWorkspaceSummary> {
    Ok(BookWorkspaceSummary {
        id: ensure_book_registry_entry(app, path)?,
        name: entry_name(path),
        path: normalize_path(path),
        updated_at: read_updated_at(path),
    })
}

fn read_updated_at(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn is_book_workspace_directory(path: &Path) -> bool {
    path.is_dir()
        && REQUIRED_BOOK_WORKSPACE_FILES
            .iter()
            .all(|relative_path| path.join(relative_path).is_file())
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
            .map(|path| normalize_path(&path)));
    }

    #[cfg(mobile)]
    {
        let _ = app;
        // 移动端当前不支持目录选择，返回空值让前端走降级处理。
        Ok(None)
    }
}

#[tauri::command]
pub fn list_book_workspaces(app: AppHandle) -> CommandResult<Vec<BookWorkspaceSummary>> {
    let books_root = ensure_books_library_root(&app)?;
    let mut workspaces = Vec::new();

    for entry in fs::read_dir(&books_root).map_err(error_to_string)? {
        let entry = entry.map_err(error_to_string)?;
        let path = entry.path();
        if !is_book_workspace_directory(&path) {
            continue;
        }

        workspaces.push(build_book_workspace_summary(&app, &path)?);
    }

    workspaces.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(workspaces)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_book_workspace_summary(
    app: AppHandle,
    rootPath: String,
) -> CommandResult<BookWorkspaceSummary> {
    let books_root = ensure_books_library_root(&app)?;
    let workspace_path = ensure_book_workspace_in_library(&books_root, &rootPath)?;
    build_book_workspace_summary(&app, &workspace_path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn get_book_workspace_summary_by_id(
    app: AppHandle,
    bookId: String,
) -> CommandResult<BookWorkspaceSummary> {
    let workspace_path = get_book_workspace_path_by_id(&app, &bookId)?;
    build_book_workspace_summary(&app, &workspace_path)
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

    let books_root = ensure_books_library_root(&app)?;
    let workspace_path = import_book_archive_to_library(&books_root, &fileName, archiveBytes)?;
    let _ = ensure_book_registry_entry(&app, &workspace_path)?;
    build_book_workspace_summary(&app, &workspace_path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn export_book_zip(app: AppHandle, rootPath: String) -> CommandResult<Option<String>> {
    let books_root = ensure_books_library_root(&app)?;
    let workspace_path = ensure_book_workspace_in_library(&books_root, &rootPath)?;
    let archive_bytes = export_book_workspace_archive(&workspace_path)?;

    #[cfg(desktop)]
    {
        let default_file_name = format!("{}.zip", entry_name(&workspace_path));
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

        fs::write(&final_path, archive_bytes).map_err(error_to_string)?;
        return Ok(Some(normalize_path(&final_path)));
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
    let books_root = ensure_books_library_root(&app)?;
    let workspace_path = ensure_book_workspace_in_library(&books_root, &rootPath)?;
    delete_book_workspace_internal(&books_root, &rootPath)?;
    delete_book_registry_entry(&app, &workspace_path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_workspace_tree(
    rootPath: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<TreeNode> {
    read_workspace_tree_internal(&rootPath, requestId.as_deref(), &registry)
}

fn read_workspace_tree_internal(
    root_path: &str,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<TreeNode> {
    with_cancellable_request(registry, request_id, || {
        let root_path = ensure_root_directory(root_path)?;
        build_tree(&root_path, &root_path, registry, request_id)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_text_file(
    rootPath: String,
    path: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    read_text_file_internal(&rootPath, &path, requestId.as_deref(), &registry)
}

fn read_text_file_internal(
    root_path: &str,
    path: &str,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<String> {
    with_cancellable_request(registry, request_id, || {
        check_cancellation(registry, request_id)?;
        let root_path = ensure_root_directory(root_path)?;
        check_cancellation(registry, request_id)?;
        let file_path = ensure_existing_path_in_root(&root_path, path)?;
        if !file_path.is_file() {
            return Err("只能读取文件内容。".into());
        }
        check_cancellation(registry, request_id)?;
        let contents = fs::read_to_string(file_path).map_err(error_to_string)?;
        check_cancellation(registry, request_id)?;
        Ok(contents)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_text_file(
    rootPath: String,
    path: String,
    contents: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    write_text_file_internal(&rootPath, &path, &contents, requestId.as_deref(), &registry)
}

fn write_text_file_internal(
    root_path: &str,
    path: &str,
    contents: &str,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<()> {
    with_cancellable_request(registry, request_id, || {
        check_cancellation(registry, request_id)?;
        let root_path = ensure_root_directory(root_path)?;
        check_cancellation(registry, request_id)?;
        let file_path = ensure_path_in_root(&root_path, path)?;

        if file_path == root_path {
            return Err("只能写入文件内容。".into());
        }

        if file_path.exists() && !file_path.is_file() {
            return Err("只能写入文件内容。".into());
        }

        let parent_path = file_path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法定位父级目录。".to_string())?;
        check_cancellation(registry, request_id)?;
        fs::create_dir_all(&parent_path).map_err(error_to_string)?;
        check_cancellation(registry, request_id)?;
        fs::write(&file_path, contents).map_err(error_to_string)?;
        Ok(())
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn search_workspace_content(
    rootPath: String,
    query: String,
    limit: Option<usize>,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<Vec<WorkspaceSearchMatch>> {
    search_workspace_content_internal(&rootPath, &query, limit, requestId.as_deref(), &registry)
}

fn search_workspace_content_internal(
    root_path: &str,
    query: &str,
    limit: Option<usize>,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<Vec<WorkspaceSearchMatch>> {
    with_cancellable_request(registry, request_id, || {
        let root_path = ensure_root_directory(root_path)?;
        let normalized_query = normalize_search_query(query)?;
        let normalized_limit = normalize_search_limit(limit);
        let mut matches = Vec::new();

        collect_workspace_search_matches(
            &root_path,
            &root_path,
            &normalized_query,
            normalized_limit,
            &mut matches,
            registry,
            request_id,
        )?;

        Ok(matches)
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_text_file_line(
    rootPath: String,
    path: String,
    lineNumber: usize,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<WorkspaceLineResult> {
    read_text_file_line_internal(
        &rootPath,
        &path,
        lineNumber,
        requestId.as_deref(),
        &registry,
    )
}

fn read_text_file_line_internal(
    root_path: &str,
    path: &str,
    line_number: usize,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<WorkspaceLineResult> {
    with_cancellable_request(registry, request_id, || {
        check_cancellation(registry, request_id)?;
        let root_path = ensure_root_directory(root_path)?;
        check_cancellation(registry, request_id)?;
        let file_path = ensure_existing_path_in_root(&root_path, path)?;
        if !file_path.is_file() {
            return Err("只能读取文件中的指定行。".into());
        }

        check_cancellation(registry, request_id)?;
        let contents = fs::read_to_string(&file_path).map_err(error_to_string)?;
        let (lines, _) = split_text_lines(&contents);
        let index = validate_line_number(line_number)?;
        check_cancellation(registry, request_id)?;

        Ok(WorkspaceLineResult {
            line_number,
            path: display_relative_path(&root_path, &file_path),
            text: line_text_or_empty(&lines, index).to_string(),
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn replace_text_file_line(
    rootPath: String,
    path: String,
    lineNumber: usize,
    contents: String,
    previousLine: Option<String>,
    nextLine: Option<String>,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<WorkspaceLineResult> {
    replace_text_file_line_internal(
        &rootPath,
        &path,
        lineNumber,
        &contents,
        previousLine,
        nextLine,
        requestId.as_deref(),
        &registry,
    )
}

fn replace_text_file_line_internal(
    root_path: &str,
    path: &str,
    line_number: usize,
    contents: &str,
    previous_line: Option<String>,
    next_line: Option<String>,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<WorkspaceLineResult> {
    with_cancellable_request(registry, request_id, || {
        check_cancellation(registry, request_id)?;
        let root_path = ensure_root_directory(root_path)?;
        check_cancellation(registry, request_id)?;
        let file_path = ensure_existing_path_in_root(&root_path, path)?;
        if !file_path.is_file() {
            return Err("只能替换文件中的指定行。".into());
        }

        let next_line_value = validate_single_line_text(contents)?;
        let previous_line_value = validate_optional_context_line(previous_line)?;
        let next_context_line = validate_optional_context_line(next_line)?;
        check_cancellation(registry, request_id)?;
        let raw = fs::read_to_string(&file_path).map_err(error_to_string)?;
        let line_ending = detect_line_ending(&raw);
        let (mut lines, had_trailing_newline) = split_text_lines(&raw);
        let index = validate_line_number(line_number)?;
        validate_adjacent_context(
            &lines,
            index,
            previous_line_value.as_deref(),
            next_context_line.as_deref(),
        )?;

        if index >= lines.len() {
            lines.resize(index + 1, String::new());
        }
        lines[index] = next_line_value.clone();

        let mut next_contents = lines.join(line_ending);
        if had_trailing_newline {
            next_contents.push_str(line_ending);
        }

        check_cancellation(registry, request_id)?;
        fs::write(&file_path, next_contents).map_err(error_to_string)?;

        Ok(WorkspaceLineResult {
            line_number,
            path: display_relative_path(&root_path, &file_path),
            text: next_line_value,
        })
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_book_workspace(
    app: AppHandle,
    parentPath: Option<String>,
    bookName: String,
) -> CommandResult<BookWorkspaceSummary> {
    let canonical_parent = match parentPath
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        Some(parent_path) => {
            let parent_path = PathBuf::from(parent_path);
            if !parent_path.exists() || !parent_path.is_dir() {
                return Err("书籍创建位置不存在。".into());
            }
            fs::canonicalize(parent_path).map_err(error_to_string)?
        }
        None => ensure_books_library_root(&app)?,
    };
    let workspace_path = create_book_workspace_internal(&canonical_parent, &bookName)?;
    let _ = ensure_book_registry_entry(&app, &workspace_path)?;
    build_book_workspace_summary(&app, &workspace_path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workspace_directory(
    rootPath: String,
    parentPath: String,
    name: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    create_workspace_directory_internal(
        &rootPath,
        &parentPath,
        &name,
        requestId.as_deref(),
        &registry,
    )
}

fn create_workspace_directory_internal(
    root_path: &str,
    parent_path: &str,
    name: &str,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<String> {
    with_cancellable_request(registry, request_id, || {
        check_cancellation(registry, request_id)?;
        let root_path = ensure_root_directory(root_path)?;
        let parent_path = ensure_parent_directory_in_root(&root_path, parent_path)?;
        let directory_name = validate_name(name)?;
        let next_path = parent_path.join(directory_name);

        if next_path.exists() {
            return Err("同名文件或文件夹已存在。".into());
        }

        check_cancellation(registry, request_id)?;
        fs::create_dir_all(&next_path).map_err(error_to_string)?;
        Ok(normalize_path(&next_path))
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workspace_text_file(
    rootPath: String,
    parentPath: String,
    name: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    create_workspace_text_file_internal(
        &rootPath,
        &parentPath,
        &name,
        requestId.as_deref(),
        &registry,
    )
}

fn create_workspace_text_file_internal(
    root_path: &str,
    parent_path: &str,
    name: &str,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<String> {
    with_cancellable_request(registry, request_id, || {
        check_cancellation(registry, request_id)?;
        let root_path = ensure_root_directory(root_path)?;
        let parent_path = ensure_parent_directory_in_root(&root_path, parent_path)?;
        let file_name = normalize_text_file_name(name)?;
        let next_path = parent_path.join(file_name);

        if next_path.exists() {
            return Err("同名文件已存在。".into());
        }

        check_cancellation(registry, request_id)?;
        fs::write(&next_path, "").map_err(error_to_string)?;
        Ok(normalize_path(&next_path))
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn rename_workspace_entry(
    rootPath: String,
    path: String,
    nextName: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    rename_workspace_entry_internal(&rootPath, &path, &nextName, requestId.as_deref(), &registry)
}

fn rename_workspace_entry_internal(
    root_path: &str,
    path: &str,
    next_name: &str,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<String> {
    with_cancellable_request(registry, request_id, || {
        check_cancellation(registry, request_id)?;
        let root_path = ensure_root_directory(root_path)?;
        let current_path = ensure_existing_path_in_root(&root_path, path)?;

        if current_path == root_path {
            return Err("不能重命名书籍根目录。".into());
        }

        let parent_path = current_path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "无法定位父级目录。".to_string())?;
        let target_name = build_rename_target_name(&current_path, next_name)?;
        let target_path = parent_path.join(target_name);

        if target_path.exists() {
            return Err("目标名称已存在。".into());
        }

        check_cancellation(registry, request_id)?;
        fs::rename(&current_path, &target_path).map_err(error_to_string)?;
        Ok(normalize_path(&target_path))
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn move_workspace_entry(
    rootPath: String,
    path: String,
    targetParentPath: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    move_workspace_entry_internal(
        &rootPath,
        &path,
        &targetParentPath,
        requestId.as_deref(),
        &registry,
    )
}

fn move_workspace_entry_internal(
    root_path: &str,
    path: &str,
    target_parent_path: &str,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<String> {
    with_cancellable_request(registry, request_id, || {
        check_cancellation(registry, request_id)?;
        let root_path = ensure_root_directory(root_path)?;
        let source_path = ensure_existing_path_in_root(&root_path, path)?;

        if source_path == root_path {
            return Err("不能迁移书籍根目录。".into());
        }

        let target_parent = ensure_parent_directory_in_root(&root_path, target_parent_path)?;
        let target_path = build_move_target_path(&source_path, &target_parent)?;

        if source_path == target_path {
            return Err("目标位置未变化。".into());
        }

        if source_path.is_dir() && target_parent.starts_with(&source_path) {
            return Err("不能将文件夹迁移到其自身或子目录中。".into());
        }

        if target_path.exists() {
            return Err("目标位置已存在同名文件或文件夹。".into());
        }

        check_cancellation(registry, request_id)?;
        fs::rename(&source_path, &target_path).map_err(error_to_string)?;
        Ok(normalize_path(&target_path))
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_workspace_entry(
    rootPath: String,
    path: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<()> {
    delete_workspace_entry_internal(&rootPath, &path, requestId.as_deref(), &registry)
}

fn delete_workspace_entry_internal(
    root_path: &str,
    path: &str,
    request_id: Option<&str>,
    registry: &ToolCancellationRegistry,
) -> CommandResult<()> {
    with_cancellable_request(registry, request_id, || {
        check_cancellation(registry, request_id)?;
        let root_path = ensure_root_directory(root_path)?;
        let target_path = ensure_existing_path_in_root(&root_path, path)?;

        if target_path == root_path {
            return Err("不能删除书籍根目录。".into());
        }

        check_cancellation(registry, request_id)?;
        if target_path.is_dir() {
            fs::remove_dir_all(&target_path).map_err(error_to_string)?;
        } else {
            fs::remove_file(&target_path).map_err(error_to_string)?;
        }

        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn create_temp_workspace() -> PathBuf {
        let root = std::env::temp_dir().join(format!("ainovelstudio-workspace-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("failed to create temp workspace");
        root
    }

    fn create_book_archive(entries: &[(&str, &str)]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut archive = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);

        for (path, content) in entries {
            archive
                .start_file(path, options)
                .expect("start_file should succeed");
            archive
                .write_all(content.as_bytes())
                .expect("write_all should succeed");
        }

        archive
            .finish()
            .expect("finish should succeed")
            .into_inner()
    }

    fn read_archive_entry_names(archive_bytes: Vec<u8>) -> Vec<String> {
        let mut archive =
            ZipArchive::new(Cursor::new(archive_bytes)).expect("archive should be readable");
        let mut names = (0..archive.len())
            .map(|index| {
                archive
                    .by_index(index)
                    .expect("entry should be readable")
                    .name()
                    .replace('\\', "/")
            })
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    #[test]
    fn write_text_file_creates_missing_directories_and_file() {
        let root = create_temp_workspace();
        let root_str = normalize_path(&root);
        let registry = ToolCancellationRegistry::default();

        write_text_file_internal(
            &root_str,
            "章节/第一卷/第1章.md",
            "# 新章节\n\n这里是正文。",
            None,
            &registry,
        )
        .expect("write_text_file should create missing directories and file");

        let created_file = root.join("章节").join("第一卷").join("第1章.md");
        let content = fs::read_to_string(&created_file).expect("created file should be readable");
        assert_eq!(content, "# 新章节\n\n这里是正文。");

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn write_text_file_rejects_paths_outside_root() {
        let root = create_temp_workspace();
        let root_str = normalize_path(&root);
        let registry = ToolCancellationRegistry::default();

        let error = write_text_file_internal(&root_str, "../escape.md", "oops", None, &registry)
            .expect_err("write_text_file should reject escaping root");

        assert_eq!(error, "目标路径不在当前书籍目录内。");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn read_text_file_line_supports_any_positive_line_number() {
        let root = create_temp_workspace();
        let file_path = root.join("章节.md");
        fs::write(&file_path, "第一行\n第二行").expect("failed to seed file");
        let registry = ToolCancellationRegistry::default();

        let result =
            read_text_file_line_internal(&normalize_path(&root), "章节.md", 5, None, &registry)
                .expect("read_text_file_line should support out-of-range positive lines");

        assert_eq!(result.line_number, 5);
        assert_eq!(result.text, "");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn replace_text_file_line_extends_missing_lines() {
        let root = create_temp_workspace();
        let file_path = root.join("章节.md");
        fs::write(&file_path, "第一行\n第二行").expect("failed to seed file");
        let registry = ToolCancellationRegistry::default();

        let result = replace_text_file_line_internal(
            &normalize_path(&root),
            "章节.md",
            5,
            "第五行",
            Some("".into()),
            Some("".into()),
            None,
            &registry,
        )
        .expect("replace_text_file_line should allow writing to any positive line");

        let content = fs::read_to_string(&file_path).expect("updated file should be readable");
        assert_eq!(result.line_number, 5);
        assert_eq!(result.text, "第五行");
        assert_eq!(content, "第一行\n第二行\n\n\n第五行");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn replace_text_file_line_validates_adjacent_lines() {
        let root = create_temp_workspace();
        let file_path = root.join("章节.md");
        fs::write(&file_path, "第一行\n第二行\n第三行").expect("failed to seed file");
        let registry = ToolCancellationRegistry::default();

        let error = replace_text_file_line_internal(
            &normalize_path(&root),
            "章节.md",
            2,
            "新的第二行",
            Some("不匹配的上一行".into()),
            Some("第三行".into()),
            None,
            &registry,
        )
        .expect_err("replace_text_file_line should validate previous line");

        assert_eq!(
            error,
            "前一行校验失败。预期“不匹配的上一行”，实际“第一行”。"
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn build_book_template_uses_engineering_structure() {
        let (directories, files) = build_book_template("北境余烬");
        let file_paths = files.iter().map(|(path, _)| *path).collect::<Vec<_>>();

        assert!(directories.contains(&"00_系统指令"));
        assert!(directories.contains(&"04_正文/第一卷"));
        assert!(file_paths.contains(&"README.md"));
        assert!(file_paths.contains(&"02_角色设定/角色关系矩阵.json"));
        assert!(file_paths.contains(&"04_正文/章节模板.md"));
        assert!(file_paths.contains(&"04_正文/第一卷/第001章_待命名.md"));
    }

    #[test]
    fn import_book_archive_supports_nested_workspace_root() {
        let root = create_temp_workspace();
        let archive = create_book_archive(&[
            ("北境余烬/README.md", "# 北境余烬"),
            (
                "北境余烬/04_正文/创作状态追踪器.json",
                "{\"currentChapter\":\"第001章\"}",
            ),
            ("北境余烬/04_正文/第一卷/第001章.md", "正文"),
        ]);

        let imported_path = import_book_archive_to_library(&root, "导入书籍.zip", archive)
            .expect("import_book_archive_to_library should import nested workspace");

        assert!(imported_path.ends_with("北境余烬"));
        assert!(imported_path.join("README.md").is_file());
        assert!(
            imported_path
                .join("04_正文")
                .join("创作状态追踪器.json")
                .is_file()
        );
        assert!(
            imported_path
                .join("04_正文")
                .join("第一卷")
                .join("第001章.md")
                .is_file()
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn import_book_archive_supports_flat_workspace_root() {
        let root = create_temp_workspace();
        let archive = create_book_archive(&[
            ("README.md", "# 平原夜雨"),
            ("04_正文/创作状态追踪器.json", "{\"progress\":1}"),
            ("04_正文/第一卷/第001章.md", "正文"),
        ]);

        let imported_path = import_book_archive_to_library(&root, "平原夜雨.zip", archive)
            .expect("import_book_archive_to_library should import flat workspace");

        assert!(imported_path.ends_with("平原夜雨"));
        assert!(imported_path.join("README.md").is_file());
        assert!(
            imported_path
                .join("04_正文")
                .join("创作状态追踪器.json")
                .is_file()
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn import_book_archive_rejects_multiple_workspaces() {
        let root = create_temp_workspace();
        let archive = create_book_archive(&[
            ("甲书/README.md", "# 甲书"),
            ("甲书/04_正文/创作状态追踪器.json", "{\"progress\":1}"),
            ("乙书/README.md", "# 乙书"),
            ("乙书/04_正文/创作状态追踪器.json", "{\"progress\":2}"),
        ]);

        let error = import_book_archive_to_library(&root, "双书.zip", archive)
            .expect_err("multiple workspaces should be rejected");

        assert!(error.contains("多个书籍工作区"));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn export_book_workspace_archive_keeps_workspace_structure() {
        let root = create_temp_workspace();
        let workspace = create_book_workspace_internal(&root, "北境余烬")
            .expect("create_book_workspace_internal should create workspace");
        fs::write(
            workspace.join("04_正文").join("第一卷").join("第002章.md"),
            "第二章正文",
        )
        .expect("failed to seed extra chapter");

        let archive_bytes = export_book_workspace_archive(&workspace)
            .expect("export_book_workspace_archive should succeed");
        let entry_names = read_archive_entry_names(archive_bytes);

        assert!(entry_names.contains(&"README.md".to_string()));
        assert!(entry_names.contains(&"04_正文/创作状态追踪器.json".to_string()));
        assert!(entry_names.contains(&"04_正文/第一卷/第002章.md".to_string()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn delete_book_workspace_internal_removes_workspace_root() {
        let root = create_temp_workspace();
        let workspace = create_book_workspace_internal(&root, "平原夜雨")
            .expect("create_book_workspace_internal should create workspace");

        delete_book_workspace_internal(&root, &normalize_path(&workspace))
            .expect("delete_book_workspace_internal should remove workspace");

        assert!(!workspace.exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn is_book_workspace_directory_requires_template_markers() {
        let root = create_temp_workspace();
        let valid_book = create_book_workspace_internal(&root, "北境余烬")
            .expect("create_book_workspace_internal should create valid workspace");
        let invalid_book = root.join("半成品");
        fs::create_dir_all(&invalid_book).expect("failed to create invalid workspace");
        fs::write(invalid_book.join("README.md"), "only readme").expect("failed to write invalid readme");

        assert!(is_book_workspace_directory(&valid_book));
        assert!(!is_book_workspace_directory(&invalid_book));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn create_workspace_text_file_accepts_json_extension() {
        let root = create_temp_workspace();
        let root_str = normalize_path(&root);
        let registry = ToolCancellationRegistry::default();

        let created = create_workspace_text_file_internal(
            &root_str,
            &normalize_path(&root),
            "角色关系矩阵.json",
            None,
            &registry,
        )
        .expect("create_workspace_text_file should accept json extension");

        assert!(created.ends_with("/角色关系矩阵.json"));
        assert!(root.join("角色关系矩阵.json").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn move_workspace_entry_moves_file_to_target_directory() {
        let root = create_temp_workspace();
        let root_str = normalize_path(&root);
        let source_dir = root.join("第一卷");
        let target_dir = root.join("第二卷");
        fs::create_dir_all(&source_dir).expect("failed to create source directory");
        fs::create_dir_all(&target_dir).expect("failed to create target directory");
        let source_file = source_dir.join("第001章.md");
        fs::write(&source_file, "章节正文").expect("failed to seed source file");
        let registry = ToolCancellationRegistry::default();

        let moved_path = move_workspace_entry_internal(
            &root_str,
            "第一卷/第001章.md",
            "第二卷",
            None,
            &registry,
        )
        .expect("move_workspace_entry should move file to target directory");

        assert!(moved_path.ends_with("/第二卷/第001章.md"));
        assert!(!source_file.exists());
        assert!(target_dir.join("第001章.md").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn move_workspace_entry_rejects_moving_directory_into_descendant() {
        let root = create_temp_workspace();
        let root_str = normalize_path(&root);
        let source_dir = root.join("卷一");
        let nested_dir = source_dir.join("章节");
        fs::create_dir_all(&nested_dir).expect("failed to create nested directory");
        let registry = ToolCancellationRegistry::default();

        let error = move_workspace_entry_internal(&root_str, "卷一", "卷一/章节", None, &registry)
            .expect_err("move should reject moving a directory into its descendant");

        assert_eq!(error, "不能将文件夹迁移到其自身或子目录中。");
        assert!(source_dir.exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn cancelled_write_text_file_does_not_create_file() {
        let root = create_temp_workspace();
        let root_str = normalize_path(&root);
        let registry = ToolCancellationRegistry::default();
        registry.cancel("req-write-cancel");

        let error = write_text_file_internal(
            &root_str,
            "章节/第二卷/第2章.md",
            "不会写入",
            Some("req-write-cancel"),
            &registry,
        )
        .expect_err("cancelled write should abort before writing");

        assert_eq!(error, "Tool execution aborted.");
        assert!(!root.join("章节").join("第二卷").join("第2章.md").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn cancelled_create_workspace_text_file_does_not_create_file() {
        let root = create_temp_workspace();
        let root_str = normalize_path(&root);
        let registry = ToolCancellationRegistry::default();
        registry.cancel("req-create-file-cancel");

        let error = create_workspace_text_file_internal(
            &root_str,
            &root_str,
            "新建章节.md",
            Some("req-create-file-cancel"),
            &registry,
        )
        .expect_err("cancelled create file should abort before creating file");

        assert_eq!(error, "Tool execution aborted.");
        assert!(!root.join("新建章节.md").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn cancelled_move_workspace_entry_does_not_move_file() {
        let root = create_temp_workspace();
        let root_str = normalize_path(&root);
        let source_dir = root.join("第一卷");
        let target_dir = root.join("第二卷");
        fs::create_dir_all(&source_dir).expect("failed to create source directory");
        fs::create_dir_all(&target_dir).expect("failed to create target directory");
        let source_file = source_dir.join("第002章.md");
        fs::write(&source_file, "保留内容").expect("failed to seed file");
        let registry = ToolCancellationRegistry::default();
        registry.cancel("req-move-cancel");

        let error = move_workspace_entry_internal(
            &root_str,
            "第一卷/第002章.md",
            "第二卷",
            Some("req-move-cancel"),
            &registry,
        )
        .expect_err("cancelled move should abort before moving file");

        assert_eq!(error, "Tool execution aborted.");
        assert!(source_file.exists());
        assert!(!target_dir.join("第002章.md").exists());
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn cancelled_delete_workspace_entry_does_not_remove_file() {
        let root = create_temp_workspace();
        let root_str = normalize_path(&root);
        let file_path = root.join("章节.md");
        fs::write(&file_path, "保留内容").expect("failed to seed file");
        let registry = ToolCancellationRegistry::default();
        registry.cancel("req-delete-cancel");

        let error = delete_workspace_entry_internal(
            &root_str,
            "章节.md",
            Some("req-delete-cancel"),
            &registry,
        )
        .expect_err("cancelled delete should abort before removing file");

        assert_eq!(error, "Tool execution aborted.");
        assert!(file_path.exists());
        fs::remove_dir_all(&root).ok();
    }
}
