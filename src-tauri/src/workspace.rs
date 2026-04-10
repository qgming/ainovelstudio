use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

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

#[derive(Serialize)]
struct HiddenIndexItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    extension: Option<String>,
    kind: String,
    name: String,
    path: String,
}

#[derive(Serialize)]
struct HiddenIndexFile {
    items: Vec<HiddenIndexItem>,
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

#[derive(Serialize)]
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

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
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

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
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

fn resolve_line_index(lines: &[String], line_number: usize) -> CommandResult<usize> {
    if line_number == 0 {
        return Err("行号必须从 1 开始。".into());
    }

    let index = line_number - 1;
    if index >= lines.len() {
        return Err(format!(
            "目标文件只有 {} 行，无法访问第 {} 行。",
            lines.len(),
            line_number
        ));
    }

    Ok(index)
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
) -> CommandResult<()> {
    for entry in fs::read_dir(current).map_err(error_to_string)? {
        let path = entry.map_err(error_to_string)?.path();
        let name = entry_name(&path);
        if name == "index.json" {
            continue;
        }

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

            collect_workspace_search_matches(root, &path, query, limit, matches)?;
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
    if trimmed == "index.json" {
        return Err("index.json 由系统维护，不能手动创建或重命名。".into());
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
    if extension != ".md" && extension != ".txt" {
        return Err("只能创建 .md 或 .txt 文件。".into());
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

fn sort_tree_nodes(nodes: &mut [TreeNode]) {
    nodes.sort_by(|left, right| {
        let left_rank = if left.kind == "directory" { 0 } else { 1 };
        let right_rank = if right.kind == "directory" { 0 } else { 1 };
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
}

fn sort_index_items(items: &mut [HiddenIndexItem]) {
    items.sort_by(|left, right| {
        let left_rank = if left.kind == "directory" { 0 } else { 1 };
        let right_rank = if right.kind == "directory" { 0 } else { 1 };
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
}

fn build_tree(root: &Path, current: &Path) -> CommandResult<TreeNode> {
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
            let child_path = entry.map_err(error_to_string)?.path();
            if entry_name(&child_path) == "index.json" {
                continue;
            }
            children.push(build_tree(root, &child_path)?);
        }
        sort_tree_nodes(&mut children);
        let _ = root;
        node.children = Some(children);
    }

    Ok(node)
}

fn write_index_file(root: &Path, current: &Path) -> CommandResult<()> {
    let mut items = Vec::new();
    let mut child_directories = Vec::new();

    for entry in fs::read_dir(current).map_err(error_to_string)? {
        let path = entry.map_err(error_to_string)?.path();
        let name = entry_name(&path);
        if name == "index.json" {
            continue;
        }

        if path.is_dir() {
            child_directories.push(path.clone());
        }

        items.push(HiddenIndexItem {
            extension: if path.is_file() {
                file_extension(&path)
            } else {
                None
            },
            kind: if path.is_dir() {
                "directory".into()
            } else {
                "file".into()
            },
            name,
            path: relative_path(root, &path),
        });
    }

    sort_index_items(&mut items);

    let payload = HiddenIndexFile {
        items,
        name: entry_name(current),
        path: relative_path(root, current),
        updated_at: current_timestamp(),
    };

    let json = serde_json::to_string_pretty(&payload).map_err(error_to_string)?;
    fs::write(current.join("index.json"), json).map_err(error_to_string)?;

    for child_directory in child_directories {
        write_index_file(root, &child_directory)?;
    }

    Ok(())
}

fn refresh_workspace_indexes(root: &Path) -> CommandResult<()> {
    write_index_file(root, root)
}

fn create_book_intro_template(book_name: &str) -> String {
    format!(
        "# {book_name}\n\n## 作品状态\n\n- 状态：筹备中\n- 题材：待补充\n- 当前进度：第1卷 / 第1章\n\n## 文件夹架构\n\n- 章节：正文分卷与章节草稿\n- 大纲：故事总纲、分卷大纲、章节细纲\n- 设定：人物、世界、地点、势力设定\n- 草稿：灵感片段与临时文本\n- 提示词：AI 写作风格与提示约束\n\n## 当前目标\n\n- 明确主线冲突\n- 完成第一卷大纲\n- 推进开篇章节初稿\n"
    )
}

fn build_book_template(book_name: &str) -> (Vec<&'static str>, Vec<(&'static str, String)>) {
    (
        vec![
            "章节",
            "章节/第一卷",
            "大纲",
            "大纲/分卷大纲",
            "大纲/章节细纲",
            "大纲/章节细纲/第一卷",
            "设定",
            "设定/人物",
            "设定/世界",
            "设定/地点",
            "设定/势力",
            "草稿",
            "提示词",
        ],
        vec![
            ("作品说明.md", create_book_intro_template(book_name)),
            (
                "章节/第一卷/第1章-开篇.md",
                format!(
                    "# 第1章 开篇\n\n## 章节定位\n\n- 作品：{book_name}\n- 本章目标：建立主角处境与核心悬念\n- 出场人物：\n- 场景：\n\n## 正文\n\n"
                ),
            ),
            (
                "大纲/故事总纲.md",
                "# 故事总纲\n\n## 故事定位\n\n- 主题：\n- 核心卖点：\n- 目标读者：\n\n## 主线目标\n\n- 主角想达成什么：\n- 阻碍主角的核心冲突：\n\n## 推进节奏\n\n1. 开篇引子：\n2. 第一阶段：\n3. 中段升级：\n4. 高潮爆发：\n5. 结局方向：\n".into(),
            ),
            (
                "大纲/分卷大纲/第一卷大纲.md",
                "# 第一卷大纲\n\n## 本卷定位\n\n- 卷名：\n- 本卷目标：\n- 本卷冲突：\n\n## 情节推进\n\n1. 开局：\n2. 发展：\n3. 反转：\n4. 卷末落点：\n".into(),
            ),
            (
                "大纲/章节细纲/第一卷/第1章细纲.md",
                "# 第1章细纲\n\n## 本章目标\n\n- 主要事件：\n- 冲突点：\n- 信息点：\n- 结尾钩子：\n\n## 场景拆分\n\n1. 场景一：\n2. 场景二：\n3. 场景三：\n".into(),
            ),
            (
                "设定/人物/主角设定.md",
                "# 主角设定\n\n## 基本信息\n\n- 姓名：\n- 年龄：\n- 身份：\n\n## 人物核心\n\n- 表层性格：\n- 深层欲望：\n- 核心缺陷：\n- 成长方向：\n\n## 关系与冲突\n\n- 关键关系：\n- 主要矛盾：\n".into(),
            ),
            (
                "设定/世界/世界观设定.md",
                "# 世界观设定\n\n## 背景\n\n- 时代：\n- 世界基调：\n\n## 规则\n\n- 核心规则：\n- 限制条件：\n\n## 势力与地点\n\n- 主要势力：\n- 关键地点：\n".into(),
            ),
            (
                "提示词/写作风格提示.md",
                "# 写作风格提示\n\n## 叙事要求\n\n- 叙事视角：\n- 语言风格：\n- 节奏要求：\n\n## AI 写作约束\n\n- 必须突出：\n- 尽量避免：\n- 禁止出现：\n".into(),
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

    let (directories, files) = build_book_template(&validated_book_name);
    for directory in directories {
        fs::create_dir_all(root_path.join(directory)).map_err(error_to_string)?;
    }

    for (relative_path, contents) in files {
        fs::write(root_path.join(relative_path), contents).map_err(error_to_string)?;
    }

    refresh_workspace_indexes(&root_path)?;
    Ok(root_path)
}

#[tauri::command]
pub async fn pick_book_directory(app: AppHandle) -> CommandResult<Option<String>> {
    Ok(app
        .dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
        .map(|path| normalize_path(&path)))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_workspace_tree(rootPath: String) -> CommandResult<TreeNode> {
    let root_path = ensure_root_directory(&rootPath)?;
    refresh_workspace_indexes(&root_path)?;
    build_tree(&root_path, &root_path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_text_file(rootPath: String, path: String) -> CommandResult<String> {
    let root_path = ensure_root_directory(&rootPath)?;
    let file_path = ensure_existing_path_in_root(&root_path, &path)?;
    if !file_path.is_file() {
        return Err("只能读取文件内容。".into());
    }
    fs::read_to_string(file_path).map_err(error_to_string)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_text_file(rootPath: String, path: String, contents: String) -> CommandResult<()> {
    let root_path = ensure_root_directory(&rootPath)?;
    let file_path = ensure_existing_path_in_root(&root_path, &path)?;
    if !file_path.is_file() {
        return Err("只能写入文件内容。".into());
    }
    fs::write(file_path, contents).map_err(error_to_string)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn search_workspace_content(
    rootPath: String,
    query: String,
    limit: Option<usize>,
) -> CommandResult<Vec<WorkspaceSearchMatch>> {
    let root_path = ensure_root_directory(&rootPath)?;
    let normalized_query = normalize_search_query(&query)?;
    let normalized_limit = normalize_search_limit(limit);
    let mut matches = Vec::new();

    collect_workspace_search_matches(
        &root_path,
        &root_path,
        &normalized_query,
        normalized_limit,
        &mut matches,
    )?;

    Ok(matches)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_text_file_line(
    rootPath: String,
    path: String,
    lineNumber: usize,
) -> CommandResult<WorkspaceLineResult> {
    let root_path = ensure_root_directory(&rootPath)?;
    let file_path = ensure_existing_path_in_root(&root_path, &path)?;
    if !file_path.is_file() {
        return Err("只能读取文件中的指定行。".into());
    }

    let contents = fs::read_to_string(&file_path).map_err(error_to_string)?;
    let (lines, _) = split_text_lines(&contents);
    let index = resolve_line_index(&lines, lineNumber)?;

    Ok(WorkspaceLineResult {
        line_number: lineNumber,
        path: display_relative_path(&root_path, &file_path),
        text: lines[index].clone(),
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn replace_text_file_line(
    rootPath: String,
    path: String,
    lineNumber: usize,
    contents: String,
) -> CommandResult<WorkspaceLineResult> {
    let root_path = ensure_root_directory(&rootPath)?;
    let file_path = ensure_existing_path_in_root(&root_path, &path)?;
    if !file_path.is_file() {
        return Err("只能替换文件中的指定行。".into());
    }

    let next_line = validate_single_line_text(&contents)?;
    let raw = fs::read_to_string(&file_path).map_err(error_to_string)?;
    let line_ending = detect_line_ending(&raw);
    let (mut lines, had_trailing_newline) = split_text_lines(&raw);
    let index = resolve_line_index(&lines, lineNumber)?;
    lines[index] = next_line.clone();

    let mut next_contents = lines.join(line_ending);
    if had_trailing_newline {
        next_contents.push_str(line_ending);
    }

    fs::write(&file_path, next_contents).map_err(error_to_string)?;

    Ok(WorkspaceLineResult {
        line_number: lineNumber,
        path: display_relative_path(&root_path, &file_path),
        text: next_line,
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_book_workspace(parentPath: String, bookName: String) -> CommandResult<String> {
    let parent_path = PathBuf::from(parentPath);
    if !parent_path.exists() || !parent_path.is_dir() {
        return Err("书籍创建位置不存在。".into());
    }

    let canonical_parent = fs::canonicalize(parent_path).map_err(error_to_string)?;
    let workspace_path = create_book_workspace_internal(&canonical_parent, &bookName)?;
    Ok(normalize_path(&workspace_path))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workspace_directory(
    rootPath: String,
    parentPath: String,
    name: String,
) -> CommandResult<String> {
    let root_path = ensure_root_directory(&rootPath)?;
    let parent_path = ensure_parent_directory_in_root(&root_path, &parentPath)?;
    let directory_name = validate_name(&name)?;
    let next_path = parent_path.join(directory_name);

    if next_path.exists() {
        return Err("同名文件或文件夹已存在。".into());
    }

    fs::create_dir_all(&next_path).map_err(error_to_string)?;
    refresh_workspace_indexes(&root_path)?;
    Ok(normalize_path(&next_path))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_workspace_text_file(
    rootPath: String,
    parentPath: String,
    name: String,
) -> CommandResult<String> {
    let root_path = ensure_root_directory(&rootPath)?;
    let parent_path = ensure_parent_directory_in_root(&root_path, &parentPath)?;
    let file_name = normalize_text_file_name(&name)?;
    let next_path = parent_path.join(file_name);

    if next_path.exists() {
        return Err("同名文件已存在。".into());
    }

    fs::write(&next_path, "").map_err(error_to_string)?;
    refresh_workspace_indexes(&root_path)?;
    Ok(normalize_path(&next_path))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn rename_workspace_entry(
    rootPath: String,
    path: String,
    nextName: String,
) -> CommandResult<String> {
    let root_path = ensure_root_directory(&rootPath)?;
    let current_path = ensure_existing_path_in_root(&root_path, &path)?;

    if current_path == root_path {
        return Err("不能重命名书籍根目录。".into());
    }

    let parent_path = current_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "无法定位父级目录。".to_string())?;
    let target_name = build_rename_target_name(&current_path, &nextName)?;
    let target_path = parent_path.join(target_name);

    if target_path.exists() {
        return Err("目标名称已存在。".into());
    }

    fs::rename(&current_path, &target_path).map_err(error_to_string)?;
    refresh_workspace_indexes(&root_path)?;
    Ok(normalize_path(&target_path))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_workspace_entry(rootPath: String, path: String) -> CommandResult<()> {
    let root_path = ensure_root_directory(&rootPath)?;
    let target_path = ensure_existing_path_in_root(&root_path, &path)?;

    if target_path == root_path {
        return Err("不能删除书籍根目录。".into());
    }

    if target_path.is_dir() {
        fs::remove_dir_all(&target_path).map_err(error_to_string)?;
    } else {
        fs::remove_file(&target_path).map_err(error_to_string)?;
    }

    refresh_workspace_indexes(&root_path)
}
