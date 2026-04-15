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
const REQUIRED_BOOK_WORKSPACE_FILES: [&str; 2] = ["README.md", "正文/创作状态追踪器.json"];

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
        "# 项目名称：{book_name}\n\n本工作区按雪花写作法初始化，建议从 `00-一句话概括.md` 开始，沿着“概括 -> 大纲 -> 人物 -> 场景 -> 正文”的顺序推进。\n\n## 推荐推进顺序\n1. `00-一句话概括.md`：先钉住故事支点、主角困境与失败代价。\n2. `01-五句式大纲.md`：把故事扩成五句式三幕骨架。\n3. `03-人物卡片/` 与 `04-人物背景/`：补齐人物欲望、缺陷、转变和过去伤口。\n4. `05-完整大纲.md` -> `07-场景清单.md` -> `08-场景规划/`：先规划场景，再落章节。\n5. `正文/创作状态追踪器.json`：每次开始正文前先刷新当前进度坐标。\n6. `正文/第一卷/`：根据场景规划开始写章节初稿。\n\n## AI 协作约定\n- 写正文前，优先读取 `00-写作风格.md`、`05-完整大纲.md`、`07-场景清单.md`。\n- 修改人物设定时，同步更新 `03-人物卡片/`、`04-人物背景/`、`06-人物宝典/`。\n- 新增或重写章节后，同步回写 `正文/创作状态追踪器.json`。\n- 灵感、资料与命名备忘统一沉淀到 `素材/`。\n\n## 当前进度\n- [ ] 完成一句话概括\n- [ ] 完成五句式大纲\n- [ ] 补齐主角卡片与背景\n- [ ] 输出完整大纲与场景清单\n- [ ] 开始第一卷正文\n"
    )
}

fn create_story_hook_template(book_name: &str) -> String {
    format!(
        "# 一句话概括\n\n- 书名：{book_name}\n- 题材：待定\n- 目标读者：待定\n- 时间线类型：顺叙\n- 写作风格：见 `00-写作风格.md`\n\n## 故事支点\n主角必须在 [截止时限] 前解决 [核心冲突]，否则将失去 [关键代价]。\n\n## 一句话版本\n待补充（建议 25 字内，突出主角 + 冲突 + 代价）\n"
    )
}

fn create_writing_style_template() -> String {
    "# 写作风格配置\n\n## 预设风格\n**当前预设**：待定\n\n## 核心参数\n| 参数 | 值 | 说明 |\n|------|----|------|\n| 叙事视角 | 第三人称限制 | 聚焦主角体验，兼顾沉浸感与信息控制 |\n| 情绪基调 | 张力递进 | 从日常失衡逐步推高危机 |\n| 对话密度 | 中 | 让人物关系和信息揭示并行推进 |\n| 描写详细度 | 适中 | 关键场景细写，过渡段控制节奏 |\n\n## 高级参数\n| 参数 | 值 |\n|------|----|\n| 语言正式度 | 半书面 |\n| 句式节奏 | 长短交替 |\n| 修辞密度 | 中 |\n| 禁止元素 | 失控降智、重复解释、无意义铺垫 |\n"
        .into()
}

fn create_five_sentence_outline_template() -> String {
    "# 五句式大纲\n\n1. **开端**：主角处于一个看似稳定、实则早已失衡的世界。\n2. **诱因**：一次事件迫使主角面对真正的目标或威胁。\n3. **升级**：主角连续试错，局势越来越糟，代价不断抬高。\n4. **低谷**：主角失去最关键的支点，被迫直面内在缺陷。\n5. **兑现**：主角做出最终选择，用改变后的自己解决核心冲突。\n\n## 备注\n- 每一句都要推动主线，不写纯背景散点。\n- 第 3 句与第 4 句之间，至少安排一次不可逆损失。\n"
        .into()
}

fn create_one_page_outline_template() -> String {
    "# 一页纸大纲\n\n## 开场与常态\n- 主角现状：\n- 读者第一印象：\n- 初始缺口：\n\n## 第一转折\n- 触发事件：\n- 主角被迫采取的行动：\n\n## 中段升级\n- 外部阻碍：\n- 内部矛盾：\n- 关系变化：\n\n## 第二转折\n- 最大损失：\n- 真相揭示：\n\n## 结局兑现\n- 最终对抗：\n- 主角完成的转变：\n- 主题回响：\n"
        .into()
}

fn create_character_card_template() -> String {
    "# 主角卡片\n\n## 基础信息\n- 姓名：\n- 年龄：\n- 身份：\n- 外显标签：\n\n## 雪花四问\n- 想要什么：\n- 为什么得不到：\n- 最害怕失去什么：\n- 故事结束时会发生怎样的改变：\n\n## 角色驱动\n- 外在目标：\n- 内在需求：\n- 核心缺陷：\n- 关键优势：\n\n## 关系钩子\n- 最重要的盟友：\n- 最危险的对手：\n- 最难放下的人：\n"
        .into()
}

fn create_character_background_template() -> String {
    "# 主角背景\n\n## 原生环境\n- 家庭 / 阶层：\n- 成长地点：\n- 早年信念：\n\n## 关键旧伤\n- 过去创伤：\n- 形成的防御机制：\n- 最不愿被人知道的秘密：\n\n## 进入主线前夜\n- 现在为什么刚好走到失衡边缘：\n- 如果这次不改变，会继续失去什么：\n"
        .into()
}

fn create_full_outline_template() -> String {
    "# 完整大纲\n\n## 故事主轴\n- 主问题：\n- 终局目标：\n- 主题句：\n\n## 第一幕\n- 起始状态：\n- 诱发事件：\n- 第一转折：\n\n## 第二幕\n- 升级一：\n- 升级二：\n- 中点反转：\n- 至暗时刻：\n\n## 第三幕\n- 最终计划：\n- 终局对抗：\n- 结尾余波：\n\n## 卷册安排\n### 第一卷\n- 核心任务：\n- 卷末钩子：\n"
        .into()
}

fn create_character_bible_template() -> String {
    "# 主角宝典\n\n## 公开设定\n- 一句话定位：\n- 常用口头禅：\n- 行动偏好：\n\n## 隐藏层\n- 不愿触碰的话题：\n- 一旦被逼到墙角会怎么做：\n- 会被什么人或事迅速击穿：\n\n## 关系网\n- 与盟友的真实张力：\n- 与反派的镜像点：\n- 与世界规则的冲突：\n\n## 成长里程碑\n- 开局状态：\n- 中段崩塌：\n- 结尾完成：\n"
        .into()
}

fn create_scene_list_template() -> String {
    "# 场景清单\n\n| 场景 | 所属卷章 | POV | 场景目标 | 冲突 / 阻碍 | 转折结果 | 状态 |\n|------|----------|-----|-----------|-------------|----------|------|\n| 场景01 | 第一卷 / 第001章 | 主角 | 抛出主问题 | 主角的既定方案被否定 | 发现更大的危机 | 待写 |\n"
        .into()
}

fn create_scene_plan_template() -> String {
    "# 场景01-开场-待定\n\n## 场景定位\n- 所属章节：第一卷 / 第001章\n- POV：主角\n- 场景目标：用一个有冲突的开场把主角推上主线\n- 冲突来源：主角的现实缺口被外部事件放大\n- 场景结果：主角被迫进入下一步行动\n\n## 三拍设计\n1. 开场画面：\n2. 冲突推进：\n3. 尾钩 / 转折：\n\n## 关键信息\n- 需要埋下的伏笔：\n- 需要回收的旧设定：\n- 需要体现的人物关系：\n"
        .into()
}

fn create_chapter_template() -> String {
    "# 章节模板\n\n## 本章任务\n- 对应场景文件：\n- 本章目标：\n- 本章冲突：\n- 本章尾钩：\n\n## 正文\n\n## 写后复盘\n- 是否推进主线：\n- 是否触发角色变化：\n- 下章承接：\n"
        .into()
}

fn create_first_chapter_template(book_name: &str) -> String {
    format!(
        "# 第001章 待命名\n\n- 关联项目：{book_name}\n- 对应场景：`08-场景规划/场景01-开场-待定.md`\n- 当前卷：第一卷\n- 写作风格：见 `00-写作风格.md`\n\n## 本章目标\n- 用一个有冲突的开场把主角推上主线。\n- 交代当前缺口与即将到来的代价。\n- 在结尾留下继续阅读的钩子。\n\n## 正文\n待补充\n"
    )
}

fn create_tracker_template(book_name: &str) -> String {
    format!(
        "{{\n  \"project\": \"{book_name}\",\n  \"stage\": \"构思期\",\n  \"currentVolume\": \"第一卷\",\n  \"currentChapter\": \"第001章\",\n  \"currentScene\": \"场景01-开场-待定\",\n  \"lastCompletedStep\": \"步骤1：一句话概括\",\n  \"nextFocus\": \"完善 01-五句式大纲，并补齐主角卡片与背景。\",\n  \"updatedAt\": null\n}}\n"
    )
}

fn build_book_template(book_name: &str) -> (Vec<&'static str>, Vec<(&'static str, String)>) {
    (
        vec![
            "03-人物卡片",
            "04-人物背景",
            "06-人物宝典",
            "08-场景规划",
            "正文",
            "正文/第一卷",
            "素材",
        ],
        vec![
            ("README.md", create_book_readme_template(book_name)),
            ("00-一句话概括.md", create_story_hook_template(book_name)),
            ("00-写作风格.md", create_writing_style_template()),
            ("01-五句式大纲.md", create_five_sentence_outline_template()),
            ("02-一页纸大纲.md", create_one_page_outline_template()),
            ("03-人物卡片/主角.md", create_character_card_template()),
            (
                "04-人物背景/主角-背景.md",
                create_character_background_template(),
            ),
            ("05-完整大纲.md", create_full_outline_template()),
            (
                "06-人物宝典/主角-宝典.md",
                create_character_bible_template(),
            ),
            ("07-场景清单.md", create_scene_list_template()),
            (
                "08-场景规划/场景01-开场-待定.md",
                create_scene_plan_template(),
            ),
            ("正文/章节模板.md", create_chapter_template()),
            (
                "正文/第一卷/第001章_待命名.md",
                create_first_chapter_template(book_name),
            ),
            (
                "正文/创作状态追踪器.json",
                create_tracker_template(book_name),
            ),
            (
                "素材/灵感速记.md",
                "# 灵感速记\n\n- 角色火花：\n- 反转点子：\n- 对白碎片：\n".into(),
            ),
            (
                "素材/资料索引.md",
                "# 资料索引\n\n- 世界观考据：\n- 专业知识：\n- 命名备忘：\n".into(),
            ),
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
            "ZIP 中未找到有效书籍工作区。至少需要包含 README.md 和 正文/创作状态追踪器.json。检测到的文件示例：{}",
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
        if entry.is_dir() {
            continue;
        }
        let path = normalize_relative_path(entry.name())?;
        if path.is_empty() || is_ignored_book_archive_path(&path) {
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
    let files = load_entry_records(connection, &book.id)?
        .into_iter()
        .filter(|entry| entry.kind == "file")
        .collect::<Vec<_>>();

    let cursor = Cursor::new(Vec::new());
    let mut archive = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for entry in files {
        archive
            .start_file(format!("{}/{}", book.name, entry.path), options)
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
        let tracker = read_text_file_db(
            &connection,
            &book.root_path,
            "books/北境余烬/正文/创作状态追踪器.json",
        )
        .expect("tracker should load");
        assert!(tracker.contains("\"project\": \"北境余烬\""));
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
        let mut connection = create_connection();
        let cursor = Cursor::new(Vec::new());
        let mut archive = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        archive
            .start_file("北境余烬/README.md", options)
            .expect("README entry should start");
        archive
            .write_all(b"# \xe5\x8c\x97\xe5\xa2\x83\xe4\xbd\x99\xe7\x83\xac\n")
            .expect("README bytes should write");
        archive
            .start_file("北境余烬/正文/创作状态追踪器.json", options)
            .expect("tracker entry should start");
        archive
            .write_all("{\"project\":\"北境余烬\"}".as_bytes())
            .expect("tracker bytes should write");
        let archive_bytes = archive
            .finish()
            .expect("archive should finish")
            .into_inner();

        let transaction = connection.transaction().expect("transaction should open");
        let book = import_book_zip_db(&transaction, "北境余烬.zip", archive_bytes)
            .expect("zip should import");
        transaction.commit().expect("transaction should commit");

        let exported = export_book_zip_db(&connection, &book.root_path).expect("zip should export");
        assert!(!exported.is_empty());
    }
}
