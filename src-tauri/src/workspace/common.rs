// 工作区模块通用工具：错误、时间戳、路径规范化、校验、取消令牌辅助。

use crate::ToolCancellationRegistry;
use std::path::Path;

pub(crate) type CommandResult<T> = Result<T, String>;

pub(crate) const INVALID_NAME_CHARS: [char; 9] =
    ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

pub(crate) fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

pub(crate) fn now_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

pub(crate) fn normalize_workspace_path(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

pub(crate) fn normalize_relative_path(value: &str) -> CommandResult<String> {
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

pub(crate) fn join_relative_path(parent_path: &str, name: &str) -> String {
    if parent_path.is_empty() {
        name.to_string()
    } else {
        format!("{parent_path}/{name}")
    }
}

pub(crate) fn parent_relative_path(path: &str) -> String {
    let mut parts = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();
    let _ = parts.pop();
    parts.join("/")
}

pub(crate) fn entry_name_from_path(path: &str) -> CommandResult<String> {
    path.rsplit('/')
        .find(|segment| !segment.is_empty())
        .map(|segment| segment.to_string())
        .ok_or_else(|| "无法解析当前路径名称。".to_string())
}

pub(crate) fn file_extension(name: &str) -> Option<String> {
    Path::new(name)
        .extension()
        .map(|extension| format!(".{}", extension.to_string_lossy().to_lowercase()))
}

pub(crate) fn validate_name(value: &str) -> CommandResult<String> {
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

pub(crate) fn validate_relative_segments(relative_path: &str) -> CommandResult<()> {
    for segment in relative_path
        .split('/')
        .filter(|segment| !segment.is_empty())
    {
        let _ = validate_name(segment)?;
    }
    Ok(())
}

pub(crate) fn check_cancellation(
    registry: &ToolCancellationRegistry,
    request_id: Option<&str>,
) -> CommandResult<()> {
    registry.check(request_id)
}

pub(crate) fn with_cancellable_request<T, F>(
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

// ---- 文本行辅助（读写行 / 上下文校验） ----

pub(crate) fn detect_line_ending(contents: &str) -> &'static str {
    if contents.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

pub(crate) fn split_text_lines(contents: &str) -> (Vec<String>, bool) {
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

pub(crate) fn validate_single_line_text(value: &str) -> CommandResult<String> {
    if value.contains('\n') || value.contains('\r') {
        return Err("替换行内容时不能包含换行符。".into());
    }
    Ok(value.to_string())
}

pub(crate) fn validate_line_number(line_number: usize) -> CommandResult<usize> {
    if line_number == 0 {
        return Err("行号必须从 1 开始。".into());
    }
    Ok(line_number - 1)
}

pub(crate) fn line_text_or_empty(lines: &[String], index: usize) -> &str {
    lines.get(index).map(String::as_str).unwrap_or("")
}

pub(crate) fn validate_optional_context_line(
    value: Option<String>,
) -> CommandResult<Option<String>> {
    match value {
        Some(line) => validate_single_line_text(&line).map(Some),
        None => Ok(None),
    }
}

pub(crate) fn check_adjacent_context(
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

pub(crate) fn bytes_to_text(bytes: Vec<u8>) -> CommandResult<String> {
    String::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 文本，无法按文本方式读取。".into())
}
