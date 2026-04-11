use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{path::BaseDirectory, AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use zip::ZipArchive;

type CommandResult<T> = Result<T, String>;

const MAX_ARCHIVE_ENTRIES: usize = 200;
const MAX_ARCHIVE_FILE_SIZE: u64 = 5 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_SIZE: u64 = 20 * 1024 * 1024;
const MAX_ARCHIVE_DEPTH: usize = 8;
const MAX_COMPRESSION_RATIO: u64 = 200;
const PRIMARY_AGENT_FILES: [&str; 3] = ["AGENTS.md", "TOOLS.md", "MEMORY.md"];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentValidation {
    errors: Vec<String>,
    is_valid: bool,
    warnings: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentManifest {
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<String>,
    body: String,
    default_enabled: bool,
    description: String,
    discovered_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    dispatch_hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frontmatter: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frontmatter_raw: Option<String>,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    install_path: Option<String>,
    is_builtin: bool,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    memory_file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    memory_preview: Option<String>,
    raw_markdown: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    source_kind: String,
    suggested_tools: Vec<String>,
    tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools_file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools_preview: Option<String>,
    validation: AgentValidation,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_file_path: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinAgentsInitializationResult {
    initialized_agent_ids: Vec<String>,
    skipped_agent_ids: Vec<String>,
}

#[derive(Clone)]
struct AgentRoot {
    is_builtin: bool,
    path: PathBuf,
    source_kind: &'static str,
}

struct ParsedAgentMarkdown {
    body: String,
    frontmatter: Option<Value>,
    frontmatter_raw: Option<String>,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn current_timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn sanitize_agent_id_fallback(value: &str) -> String {
    let normalized = value
        .trim()
        .chars()
        .map(|char| {
            if char.is_ascii_lowercase() || char.is_ascii_digit() || matches!(char, '.' | '_' | '-')
            {
                char
            } else if char.is_ascii_uppercase() {
                char.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();
    let collapsed = normalized
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let fallback = collapsed.trim_matches('.').trim_matches('-').to_string();
    if fallback.is_empty() {
        "agent".into()
    } else {
        fallback.chars().take(64).collect()
    }
}

fn read_object_field<'a>(
    frontmatter: Option<&'a Map<String, Value>>,
    key: &str,
) -> Option<&'a Map<String, Value>> {
    frontmatter
        .and_then(|map| map.get(key))
        .and_then(Value::as_object)
}

fn read_metadata_string_field(
    frontmatter: Option<&Map<String, Value>>,
    key: &str,
) -> Option<String> {
    read_object_field(frontmatter, "metadata")
        .and_then(|map| map.get(key))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_string_field(frontmatter: Option<&Map<String, Value>>, key: &str) -> Option<String> {
    frontmatter
        .and_then(|map| map.get(key))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_string_list_field(frontmatter: Option<&Map<String, Value>>, key: &str) -> Vec<String> {
    let Some(value) = frontmatter.and_then(|map| map.get(key)) else {
        return Vec::new();
    };

    match value {
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect(),
        Value::String(value) => value
            .split_whitespace()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToString::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn extract_description_from_body(body: &str) -> String {
    body.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.trim_start_matches('#').trim().to_string())
        .unwrap_or_else(|| "未提供代理描述。".into())
}

fn preview_text(content: &str) -> Option<String> {
    let preview = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(4)
        .collect::<Vec<_>>()
        .join("\n");
    if preview.is_empty() {
        None
    } else {
        Some(preview)
    }
}

fn parse_agent_markdown(raw: &str) -> CommandResult<ParsedAgentMarkdown> {
    let normalized = raw.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return Ok(ParsedAgentMarkdown {
            body: normalized.trim().to_string(),
            frontmatter: None,
            frontmatter_raw: None,
        });
    }

    let mut closing_index = None;
    let mut search_offset = 4;
    while let Some(index) = normalized[search_offset..].find("\n---") {
        let absolute = search_offset + index;
        let suffix = &normalized[(absolute + 4)..];
        if suffix.is_empty() || suffix.starts_with('\n') {
            closing_index = Some(absolute + 1);
            break;
        }
        search_offset = absolute + 4;
    }

    let closing_index =
        closing_index.ok_or_else(|| "AGENTS.md 的 YAML 头部缺少结束分隔符 ---。".to_string())?;
    let yaml_raw = normalized[4..(closing_index - 1)].trim().to_string();
    let body_start = if normalized[closing_index..].starts_with("---\n") {
        closing_index + 4
    } else {
        closing_index + 3
    };
    let body = normalized[body_start..].trim().to_string();

    if yaml_raw.is_empty() {
        return Ok(ParsedAgentMarkdown {
            body,
            frontmatter: Some(Value::Object(Map::new())),
            frontmatter_raw: Some(String::new()),
        });
    }

    let parsed = serde_yaml::from_str::<Value>(&yaml_raw)
        .map_err(|error| format!("YAML 解析失败：{error}"))?;

    match parsed {
        Value::Object(_) => Ok(ParsedAgentMarkdown {
            body,
            frontmatter: Some(parsed),
            frontmatter_raw: Some(yaml_raw),
        }),
        _ => Err("AGENTS.md 顶部 YAML 必须是对象结构。".into()),
    }
}

fn validate_agent_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return false;
    }
    if trimmed.starts_with('-') || trimmed.ends_with('-') || trimmed.contains("--") {
        return false;
    }

    trimmed
        .chars()
        .all(|char| char.is_ascii_lowercase() || char.is_ascii_digit() || char == '-')
}

fn validate_frontmatter(
    frontmatter: Option<&Map<String, Value>>,
    directory_name: &str,
) -> (Vec<String>, Vec<String>) {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let name = read_string_field(frontmatter, "name");
    match name {
        Some(ref value) if validate_agent_name(value) => {
            if value != directory_name {
                errors.push("frontmatter.name 必须与代理目录名保持一致。".into());
            }
        }
        Some(_) => {
            errors.push("frontmatter.name 格式不合法：仅支持小写字母、数字和连字符，长度 1-64，且不能以连字符开头或结尾，也不能包含连续的 --。".into());
        }
        None => errors.push("AGENTS.md 缺少必填 frontmatter 字段：name。".into()),
    }

    match read_string_field(frontmatter, "description") {
        Some(value) => {
            if value.chars().count() > 1024 {
                errors.push("frontmatter.description 长度不能超过 1024 个字符。".into());
            }
        }
        None => errors.push("AGENTS.md 缺少必填 frontmatter 字段：description。".into()),
    }

    if let Some(role) = read_string_field(frontmatter, "role") {
        if role.chars().count() > 64 {
            errors.push("frontmatter.role 长度不能超过 64 个字符。".into());
        }
    } else {
        warnings.push("建议填写 frontmatter.role，用于主代理委派。".into());
    }

    if let Some(dispatch_hint) = read_string_field(frontmatter, "dispatch-hint") {
        if dispatch_hint.chars().count() > 500 {
            errors.push("frontmatter.dispatch-hint 长度不能超过 500 个字符。".into());
        }
    } else {
        warnings.push("建议填写 frontmatter.dispatch-hint，用于说明何时委派该代理。".into());
    }

    if let Some(metadata) = read_object_field(frontmatter, "metadata") {
        if metadata
            .iter()
            .any(|(key, value)| key.trim().is_empty() || !value.is_string())
        {
            errors.push("frontmatter.metadata 仅支持字符串键值对。".into());
        }
    }

    (errors, warnings)
}

fn parse_agent_manifest(agent_dir: &Path, source_root: &AgentRoot) -> CommandResult<AgentManifest> {
    let agent_file_path = agent_dir.join("AGENTS.md");
    if !agent_file_path.exists() || !agent_file_path.is_file() {
        return Err("代理目录缺少 AGENTS.md。".into());
    }

    let raw_markdown = fs::read_to_string(&agent_file_path).map_err(error_to_string)?;
    let directory_name = agent_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "agent".into());

    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let parsed_markdown = match parse_agent_markdown(&raw_markdown) {
        Ok(parsed) => parsed,
        Err(error) => {
            errors.push(error);
            ParsedAgentMarkdown {
                body: raw_markdown.trim().to_string(),
                frontmatter: None,
                frontmatter_raw: None,
            }
        }
    };

    let frontmatter_object = parsed_markdown
        .frontmatter
        .as_ref()
        .and_then(Value::as_object);
    let id = sanitize_agent_id_fallback(&directory_name);
    let (frontmatter_errors, frontmatter_warnings) =
        validate_frontmatter(frontmatter_object, &directory_name);
    errors.extend(frontmatter_errors);
    warnings.extend(frontmatter_warnings);

    let name =
        read_string_field(frontmatter_object, "name").unwrap_or_else(|| directory_name.clone());
    let description = read_string_field(frontmatter_object, "description")
        .unwrap_or_else(|| extract_description_from_body(&parsed_markdown.body));
    let version = read_string_field(frontmatter_object, "version")
        .or_else(|| read_metadata_string_field(frontmatter_object, "version"));
    let author = read_string_field(frontmatter_object, "author")
        .or_else(|| read_metadata_string_field(frontmatter_object, "author"));
    let role = read_string_field(frontmatter_object, "role");
    let dispatch_hint = read_string_field(frontmatter_object, "dispatch-hint");
    let tags = read_string_list_field(frontmatter_object, "tags");
    let suggested_tools = {
        let from_tools = read_string_list_field(frontmatter_object, "tools");
        if from_tools.is_empty() {
            read_string_list_field(frontmatter_object, "allowed-tools")
        } else {
            from_tools
        }
    };

    let tools_file_path = agent_dir.join("TOOLS.md");
    let memory_file_path = agent_dir.join("MEMORY.md");
    let tools_preview = if tools_file_path.exists() {
        preview_text(&fs::read_to_string(&tools_file_path).map_err(error_to_string)?)
    } else {
        warnings.push("建议提供 TOOLS.md，用于描述该代理的工具与技能边界。".into());
        None
    };
    let memory_preview = if memory_file_path.exists() {
        preview_text(&fs::read_to_string(&memory_file_path).map_err(error_to_string)?)
    } else {
        warnings.push("建议提供 MEMORY.md，用于记录该代理的长期偏好。".into());
        None
    };

    if parsed_markdown.body.trim().is_empty() {
        warnings.push("AGENTS.md 正文为空，运行时可能无法提供有效代理说明。".into());
    }

    Ok(AgentManifest {
        author,
        body: parsed_markdown.body,
        default_enabled: source_root.is_builtin,
        description,
        discovered_at: current_timestamp(),
        dispatch_hint,
        frontmatter: parsed_markdown.frontmatter,
        frontmatter_raw: parsed_markdown.frontmatter_raw,
        id,
        install_path: Some(normalize_path(agent_dir)),
        is_builtin: source_root.is_builtin,
        name,
        memory_file_path: if memory_file_path.exists() {
            Some(normalize_path(&memory_file_path))
        } else {
            None
        },
        memory_preview,
        raw_markdown,
        role,
        source_kind: source_root.source_kind.into(),
        suggested_tools,
        tags,
        tools_file_path: if tools_file_path.exists() {
            Some(normalize_path(&tools_file_path))
        } else {
            None
        },
        tools_preview,
        validation: AgentValidation {
            is_valid: errors.is_empty(),
            errors,
            warnings,
        },
        version,
        agent_file_path: Some(normalize_path(&agent_file_path)),
    })
}

fn scan_agent_root(root: &AgentRoot) -> CommandResult<Vec<AgentManifest>> {
    if !root.path.exists() || !root.path.is_dir() {
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();
    for entry in fs::read_dir(&root.path).map_err(error_to_string)? {
        let entry = entry.map_err(error_to_string)?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if !path.join("AGENTS.md").exists() {
            continue;
        }
        manifests.push(parse_agent_manifest(&path, root)?);
    }

    Ok(manifests)
}

fn ensure_user_agents_root(app: &AppHandle) -> CommandResult<PathBuf> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(error_to_string)?
        .join("agents");
    fs::create_dir_all(&root).map_err(error_to_string)?;
    Ok(root)
}

fn resolve_builtin_agents_root(app: &AppHandle) -> Option<PathBuf> {
    ["agents", "resources/agents"]
        .into_iter()
        .filter_map(|relative_path| {
            app.path()
                .resolve(relative_path, BaseDirectory::Resource)
                .ok()
        })
        .find(|path| path.exists() && path.is_dir())
}

fn collect_agent_roots(app: &AppHandle) -> CommandResult<Vec<AgentRoot>> {
    let mut roots = Vec::new();
    if let Some(resource_root) = resolve_builtin_agents_root(app) {
        roots.push(AgentRoot {
            is_builtin: true,
            path: resource_root,
            source_kind: "builtin-package",
        });
    }

    roots.push(AgentRoot {
        is_builtin: false,
        path: ensure_user_agents_root(app)?,
        source_kind: "installed-package",
    });

    Ok(roots)
}

fn scan_all_agents(app: &AppHandle) -> CommandResult<Vec<AgentManifest>> {
    let mut builtin_ids: HashSet<String> = HashSet::new();
    let mut by_id: HashMap<String, AgentManifest> = HashMap::new();
    for root in collect_agent_roots(app)? {
        for manifest in scan_agent_root(&root)? {
            if root.is_builtin {
                builtin_ids.insert(manifest.id.clone());
            }
            match by_id.get(&manifest.id) {
                Some(existing) if existing.source_kind == "installed-package" => {}
                _ => {
                    by_id.insert(manifest.id.clone(), manifest);
                }
            }
        }
    }

    let mut manifests = by_id
        .into_values()
        .map(|mut manifest| {
            manifest.default_enabled = builtin_ids.contains(&manifest.id);
            manifest
        })
        .collect::<Vec<_>>();
    manifests.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(manifests)
}

fn resolve_agent_file_path(agent_dir: &Path, relative_path: &str) -> CommandResult<PathBuf> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("文件路径不能为空。".into());
    }

    if !PRIMARY_AGENT_FILES.contains(&trimmed) {
        return Err("仅允许访问 AGENTS.md、TOOLS.md、MEMORY.md。".into());
    }

    let relative = PathBuf::from(trimmed);
    if relative.is_absolute() {
        return Err("文件路径不合法。".into());
    }
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("文件路径不合法。".into());
    }

    let file_path = agent_dir.join(&relative);
    if !file_path.exists() || !file_path.is_file() {
        return Err("未找到对应代理文件。".into());
    }

    let canonical_file_path = fs::canonicalize(&file_path).map_err(error_to_string)?;
    let canonical_agent_dir = fs::canonicalize(agent_dir).map_err(error_to_string)?;
    if !canonical_file_path.starts_with(&canonical_agent_dir) {
        return Err("代理文件路径超出允许范围。".into());
    }

    Ok(file_path)
}

fn build_agent_markdown_template(name: &str, description: &str) -> String {
    format!(
        "---\nname: {name}\ndescription: {description}\ntools:\n  - read_file\n  - write_file\ntags:\n  - writing\n---\n# {name}\n\n你是一名写作代理，负责根据用户需求产出可直接使用的小说内容。\n\n## 工作方式\n- 先理解任务目标与约束。\n- 明确当前章节或片段需要达成的效果。\n- 输出可直接采用的写作结果，并说明关键改动理由。\n"
    )
}

fn write_agent_file(agent_dir: &Path, relative_path: &str, content: &str) -> CommandResult<()> {
    let trimmed = relative_path.trim();
    if !PRIMARY_AGENT_FILES.contains(&trimmed) {
        return Err("仅允许写入 AGENTS.md、TOOLS.md、MEMORY.md。".into());
    }
    let file_path = agent_dir.join(trimmed);

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(error_to_string)?;
    }
    fs::write(file_path, content).map_err(error_to_string)
}

fn create_agent_directory_from_content(
    app: &AppHandle,
    name: &str,
    agent_markdown: &str,
) -> CommandResult<()> {
    let safe_name = name.trim();
    if !validate_agent_name(safe_name) {
        return Err("名称格式不合法：仅支持小写字母、数字和连字符。".into());
    }
    let user_root = ensure_user_agents_root(app)?;
    let agent_dir = user_root.join(&safe_name);
    if agent_dir.exists() {
        return Err("已存在同名代理。".into());
    }

    fs::write(agent_dir.join("AGENTS.md"), agent_markdown).map_err(error_to_string)?;
    fs::write(
        agent_dir.join("TOOLS.md"),
        "# TOOLS\n\n- 在这里记录该代理可使用的工具、技能与边界。\n",
    )
    .map_err(error_to_string)?;
    fs::write(
        agent_dir.join("MEMORY.md"),
        "# MEMORY\n\n- 在这里记录用户对该代理的长期偏好。\n",
    )
    .map_err(error_to_string)?;

    let scan_root = AgentRoot {
        is_builtin: false,
        path: user_root,
        source_kind: "installed-package",
    };
    let manifest = parse_agent_manifest(&agent_dir, &scan_root)?;
    if !manifest.validation.is_valid {
        let _ = fs::remove_dir_all(&agent_dir);
        let error_details = manifest.validation.errors.join("；");
        return Err(if error_details.is_empty() {
            "复制内置代理失败。".into()
        } else {
            format!("复制内置代理失败：{error_details}")
        });
    }

    Ok(())
}

fn create_agent_directory(app: &AppHandle, name: &str, description: &str) -> CommandResult<()> {
    let safe_name = name.trim();
    if !validate_agent_name(safe_name) {
        return Err("名称格式不合法：仅支持小写字母、数字和连字符。".into());
    }
    let trimmed_description = description.trim();
    if trimmed_description.is_empty() {
        return Err("代理简介不能为空。".into());
    }
    if trimmed_description.chars().count() > 1024 {
        return Err("代理简介长度不能超过 1024 个字符。".into());
    }

    let user_root = ensure_user_agents_root(app)?;
    let agent_dir = user_root.join(&safe_name);
    if agent_dir.exists() {
        return Err("已存在同名代理。".into());
    }

    fs::write(
        agent_dir.join("AGENTS.md"),
        build_agent_markdown_template(&safe_name, trimmed_description),
    )
    .map_err(error_to_string)?;
    fs::write(
        agent_dir.join("TOOLS.md"),
        "# TOOLS\n\n- 记录该代理可用的工具与技能。\n",
    )
    .map_err(error_to_string)?;
    fs::write(
        agent_dir.join("MEMORY.md"),
        "# MEMORY\n\n- 记录用户对该代理的长期偏好。\n",
    )
    .map_err(error_to_string)?;

    let scan_root = AgentRoot {
        is_builtin: false,
        path: user_root,
        source_kind: "installed-package",
    };
    let manifest = parse_agent_manifest(&agent_dir, &scan_root)?;
    if !manifest.validation.is_valid {
        let _ = fs::remove_dir_all(&agent_dir);
        let error_details = manifest.validation.errors.join("；");
        return Err(if error_details.is_empty() {
            "新建代理失败。".into()
        } else {
            format!("新建代理失败：{error_details}")
        });
    }

    Ok(())
}

fn resolve_agent_directory(app: &AppHandle, agent_id: &str) -> CommandResult<PathBuf> {
    scan_all_agents(app)?
        .into_iter()
        .find(|agent| agent.id == agent_id)
        .and_then(|agent| agent.install_path)
        .map(PathBuf::from)
        .ok_or_else(|| "未找到对应代理。".into())
}

fn resolve_installed_agent_directory(app: &AppHandle, agent_id: &str) -> CommandResult<PathBuf> {
    let user_root = ensure_user_agents_root(app)?;
    let target_path = user_root.join(agent_id);
    if !target_path.exists() || !target_path.is_dir() {
        return Err("未找到可删除的已安装代理目录。".into());
    }

    let canonical_target_path = fs::canonicalize(&target_path).map_err(error_to_string)?;
    let canonical_user_root = fs::canonicalize(&user_root).map_err(error_to_string)?;
    if !canonical_target_path.starts_with(&canonical_user_root) {
        return Err("代理目录超出允许范围。".into());
    }

    Ok(target_path)
}

fn copy_directory_recursive(source: &Path, target: &Path) -> CommandResult<()> {
    fs::create_dir_all(target).map_err(error_to_string)?;
    for entry in fs::read_dir(source).map_err(error_to_string)? {
        let entry = entry.map_err(error_to_string)?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_directory_recursive(&source_path, &target_path)?;
        } else {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(error_to_string)?;
            }
            fs::copy(&source_path, &target_path).map_err(error_to_string)?;
        }
    }
    Ok(())
}

fn sync_builtin_agents_to_user_dir(
    app: &AppHandle,
) -> CommandResult<BuiltinAgentsInitializationResult> {
    let user_root = ensure_user_agents_root(app)?;
    let builtin_root = match resolve_builtin_agents_root(app) {
        Some(path) => path,
        None => {
            return Ok(BuiltinAgentsInitializationResult {
                initialized_agent_ids: Vec::new(),
                skipped_agent_ids: Vec::new(),
            });
        }
    };

    let builtin_agent_root = AgentRoot {
        is_builtin: true,
        path: builtin_root,
        source_kind: "builtin-package",
    };
    let builtin_manifests = scan_agent_root(&builtin_agent_root)?;

    let mut initialized_agent_ids = Vec::new();
    let mut skipped_agent_ids = Vec::new();
    for manifest in builtin_manifests {
        let Some(install_path) = manifest.install_path.as_deref() else {
            skipped_agent_ids.push(manifest.id);
            continue;
        };

        let target_path = user_root.join(&manifest.id);
        if target_path.exists() {
            skipped_agent_ids.push(manifest.id);
            continue;
        }

        copy_directory_recursive(Path::new(install_path), &target_path)?;
        initialized_agent_ids.push(manifest.id);
    }

    Ok(BuiltinAgentsInitializationResult {
        initialized_agent_ids,
        skipped_agent_ids,
    })
}

fn path_depth(path: &Path) -> usize {
    path.components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count()
}

fn install_agent_from_zip(app: &AppHandle, zip_path: &Path) -> CommandResult<Vec<AgentManifest>> {
    let file = File::open(zip_path).map_err(error_to_string)?;
    let mut archive = ZipArchive::new(file).map_err(error_to_string)?;
    if archive.len() == 0 {
        return Err("ZIP 压缩包为空。".into());
    }
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("ZIP 内文件数量过多。".into());
    }

    let mut safe_paths: Vec<PathBuf> = Vec::new();
    let mut total_uncompressed = 0_u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(error_to_string)?;
        let Some(path) = entry.enclosed_name() else {
            return Err("ZIP 内存在非法路径。".into());
        };
        if path_depth(&path) > MAX_ARCHIVE_DEPTH {
            return Err("ZIP 内目录层级过深。".into());
        }
        if entry.size() > MAX_ARCHIVE_FILE_SIZE {
            return Err("ZIP 内单个文件过大。".into());
        }
        if entry.compressed_size() > 0
            && entry.size() / entry.compressed_size().max(1) > MAX_COMPRESSION_RATIO
        {
            return Err("ZIP 压缩比异常，已拒绝导入。".into());
        }
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_ARCHIVE_TOTAL_SIZE {
            return Err("ZIP 解压后的总大小超出限制。".into());
        }
        safe_paths.push(path.to_path_buf());
    }

    let agent_files = safe_paths
        .iter()
        .filter(|path| {
            path.file_name()
                .map(|name| name == "AGENTS.md")
                .unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();

    if agent_files.is_empty() {
        let preview = safe_paths
            .iter()
            .take(8)
            .map(|path| normalize_path(path))
            .collect::<Vec<_>>()
            .join("，");
        return Err(format!(
            "ZIP 中未找到 AGENTS.md。压缩包内检测到的文件示例：{}",
            if preview.is_empty() {
                "无可用文件".into()
            } else {
                preview
            }
        ));
    }
    if agent_files.len() > 1 {
        let duplicate_files = agent_files
            .iter()
            .map(|path| normalize_path(path))
            .collect::<Vec<_>>()
            .join("，");
        return Err(format!(
            "ZIP 中检测到多个 AGENTS.md，当前仅支持单代理包导入。检测到：{}",
            duplicate_files
        ));
    }

    let agent_file_path = &agent_files[0];
    let root_prefix = agent_file_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let archive_file_name = zip_path
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_agent_id_fallback)
        .unwrap_or_else(|| format!("agent-{}", current_timestamp_millis()));

    let temp_root = app
        .path()
        .app_data_dir()
        .map_err(error_to_string)?
        .join("agent-import-temp")
        .join(format!(
            "{}-{}",
            archive_file_name,
            current_timestamp_millis()
        ));
    if temp_root.exists() {
        fs::remove_dir_all(&temp_root).map_err(error_to_string)?;
    }
    fs::create_dir_all(&temp_root).map_err(error_to_string)?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error_to_string)?;
        let Some(path) = entry.enclosed_name() else {
            let _ = fs::remove_dir_all(&temp_root);
            return Err("ZIP 内存在非法路径。".into());
        };
        if path_depth(&path) > MAX_ARCHIVE_DEPTH {
            let _ = fs::remove_dir_all(&temp_root);
            return Err("ZIP 内目录层级过深。".into());
        }
        if !root_prefix.as_os_str().is_empty() && !path.starts_with(&root_prefix) {
            let _ = fs::remove_dir_all(&temp_root);
            return Err("ZIP 内容结构不一致，无法确定代理根目录。".into());
        }

        let relative = if root_prefix.as_os_str().is_empty() {
            path.to_path_buf()
        } else {
            path.strip_prefix(&root_prefix)
                .map_err(error_to_string)?
                .to_path_buf()
        };
        if relative.as_os_str().is_empty() {
            continue;
        }

        let output_path = temp_root.join(&relative);
        if entry.name().ends_with('/') {
            fs::create_dir_all(&output_path).map_err(error_to_string)?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(error_to_string)?;
        }
        let mut output_file = File::create(&output_path).map_err(error_to_string)?;
        std::io::copy(&mut entry, &mut output_file).map_err(error_to_string)?;
    }

    let extract_root = if root_prefix.as_os_str().is_empty() {
        temp_root.clone()
    } else {
        temp_root.clone()
    };

    let scan_root = AgentRoot {
        is_builtin: false,
        path: temp_root.clone(),
        source_kind: "installed-package",
    };
    let mut manifests = scan_agent_root(&scan_root)?;
    if manifests.len() != 1 {
        let _ = fs::remove_dir_all(&temp_root);
        return Err("导入包解析失败，必须且只能包含一个代理目录。".into());
    }

    let manifest = manifests.remove(0);
    if !manifest.validation.is_valid {
        let _ = fs::remove_dir_all(&temp_root);
        let error_details = manifest.validation.errors.join("；");
        return Err(if error_details.is_empty() {
            "代理包校验失败。".into()
        } else {
            format!("代理包校验失败：{error_details}")
        });
    }

    let user_root = ensure_user_agents_root(app)?;
    let target_path = user_root.join(&manifest.id);
    if target_path.exists() {
        let _ = fs::remove_dir_all(&temp_root);
        return Err("已存在同名代理，请先移除旧代理后再导入。".into());
    }

    copy_directory_recursive(&extract_root.join(&manifest.id), &target_path)?;
    let _ = fs::remove_dir_all(&temp_root);
    scan_all_agents(app)
}

#[tauri::command]
pub async fn pick_agent_archive(app: AppHandle) -> CommandResult<Option<String>> {
    Ok(app
        .dialog()
        .file()
        .add_filter("Agent ZIP", &["zip"])
        .blocking_pick_file()
        .and_then(|path| path.into_path().ok())
        .map(|path| normalize_path(&path)))
}

#[tauri::command]
pub fn scan_installed_agents(app: AppHandle) -> CommandResult<Vec<AgentManifest>> {
    scan_all_agents(&app)
}

#[tauri::command]
pub fn initialize_builtin_agents(
    app: AppHandle,
) -> CommandResult<BuiltinAgentsInitializationResult> {
    sync_builtin_agents_to_user_dir(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_agent_detail(app: AppHandle, agentId: String) -> CommandResult<AgentManifest> {
    scan_all_agents(&app)?
        .into_iter()
        .find(|agent| agent.id == agentId)
        .ok_or_else(|| "未找到对应代理。".into())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_agent_file_content(
    app: AppHandle,
    agentId: String,
    relativePath: String,
) -> CommandResult<String> {
    let agent_dir = resolve_agent_directory(&app, &agentId)?;
    let file_path = resolve_agent_file_path(&agent_dir, &relativePath)?;
    fs::read_to_string(file_path).map_err(error_to_string)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_agent_file_content(
    app: AppHandle,
    agentId: String,
    relativePath: String,
    content: String,
) -> CommandResult<Vec<AgentManifest>> {
    let installed_agent_dir = resolve_installed_agent_directory(&app, &agentId);
    let agent_dir = match installed_agent_dir {
        Ok(agent_dir) => agent_dir,
        Err(_) => {
            if relativePath.trim() != "AGENTS.md" {
                return Err("仅支持先复制内置代理的 AGENTS.md。".into());
            }
            let manifest = scan_all_agents(&app)?
                .into_iter()
                .find(|agent| agent.id == agentId)
                .ok_or_else(|| "未找到对应代理。".to_string())?;
            create_agent_directory_from_content(&app, &agentId, &content)?;
            let user_root = ensure_user_agents_root(&app)?;
            let copied_agent_dir = user_root.join(&agentId);
            if let Some(install_path) = manifest.install_path {
                let source_path = PathBuf::from(install_path);
                for relative in PRIMARY_AGENT_FILES
                    .iter()
                    .filter(|name| **name != "AGENTS.md")
                {
                    let source_file = source_path.join(relative);
                    if source_file.exists() && source_file.is_file() {
                        fs::copy(&source_file, copied_agent_dir.join(relative))
                            .map_err(error_to_string)?;
                    }
                }
            }
            copied_agent_dir
        }
    };
    write_agent_file(&agent_dir, &relativePath, &content)?;
    scan_all_agents(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_agent(
    app: AppHandle,
    name: String,
    description: String,
) -> CommandResult<Vec<AgentManifest>> {
    create_agent_directory(&app, &name, &description)?;
    scan_all_agents(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_installed_agent(
    app: AppHandle,
    agentId: String,
) -> CommandResult<Vec<AgentManifest>> {
    let target_path = resolve_installed_agent_directory(&app, &agentId)?;
    fs::remove_dir_all(&target_path).map_err(error_to_string)?;
    scan_all_agents(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn import_agent_zip(app: AppHandle, zipPath: String) -> CommandResult<Vec<AgentManifest>> {
    let zip_path = PathBuf::from(zipPath);
    if !zip_path.exists() || !zip_path.is_file() {
        return Err("ZIP 文件不存在。".into());
    }
    if zip_path
        .extension()
        .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
        .as_deref()
        != Some("zip")
    {
        return Err("仅支持导入 .zip 代理包。".into());
    }

    install_agent_from_zip(&app, &zip_path)
}

