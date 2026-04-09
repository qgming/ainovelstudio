use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
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
const BLOCKED_REFERENCE_EXTENSIONS: [&str; 10] = [
    "exe", "dll", "bat", "cmd", "sh", "ps1", "msi", "com", "scr", "js",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillReferenceEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    extension: Option<String>,
    name: String,
    path: String,
    size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillValidation {
    errors: Vec<String>,
    is_valid: bool,
    warnings: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillManifest {
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<String>,
    body: String,
    description: String,
    discovered_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    frontmatter: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frontmatter_raw: Option<String>,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    install_path: Option<String>,
    is_builtin: bool,
    name: String,
    raw_markdown: String,
    references: Vec<SkillReferenceEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    references_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    skill_file_path: Option<String>,
    source_kind: String,
    suggested_tools: Vec<String>,
    tags: Vec<String>,
    validation: SkillValidation,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinSkillsInitializationResult {
    initialized_skill_ids: Vec<String>,
    skipped_skill_ids: Vec<String>,
}

#[derive(Clone)]
struct SkillRoot {
    is_builtin: bool,
    path: PathBuf,
    source_kind: &'static str,
}

struct ParsedSkillMarkdown {
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

fn sanitize_skill_id_fallback(value: &str) -> String {
    let normalized = value
        .trim()
        .chars()
        .map(|char| {
            if char.is_ascii_lowercase() || char.is_ascii_digit() || matches!(char, '.' | '_' | '-') {
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
        "skill".into()
    } else {
        fallback.chars().take(64).collect()
    }
}

fn read_object_field<'a>(frontmatter: Option<&'a Map<String, Value>>, key: &str) -> Option<&'a Map<String, Value>> {
    frontmatter.and_then(|map| map.get(key)).and_then(Value::as_object)
}

fn read_metadata_string_field(frontmatter: Option<&Map<String, Value>>, key: &str) -> Option<String> {
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
        .unwrap_or_else(|| "未提供技能描述。".into())
}

fn parse_skill_markdown(raw: &str) -> CommandResult<ParsedSkillMarkdown> {
    let normalized = raw.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return Ok(ParsedSkillMarkdown {
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

    let closing_index = closing_index.ok_or_else(|| "SKILL.md 的 YAML 头部缺少结束分隔符 ---。".to_string())?;
    let yaml_raw = normalized[4..(closing_index - 1)].trim().to_string();
    let body_start = if normalized[closing_index..].starts_with("---\n") {
        closing_index + 4
    } else {
        closing_index + 3
    };
    let body = normalized[body_start..].trim().to_string();

    if yaml_raw.is_empty() {
        return Ok(ParsedSkillMarkdown {
            body,
            frontmatter: Some(Value::Object(Map::new())),
            frontmatter_raw: Some(String::new()),
        });
    }

    let parsed = serde_yaml::from_str::<Value>(&yaml_raw)
        .map_err(|error| format!("YAML 解析失败：{error}"))?;

    match parsed {
        Value::Object(_) => Ok(ParsedSkillMarkdown {
            body,
            frontmatter: Some(parsed),
            frontmatter_raw: Some(yaml_raw),
        }),
        _ => Err("SKILL.md 顶部 YAML 必须是对象结构。".into()),
    }
}

fn detect_extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .filter(|extension| !extension.is_empty())
}

fn is_reference_file_allowed(path: &Path) -> bool {
    !detect_extension(path)
        .map(|extension| BLOCKED_REFERENCE_EXTENSIONS.contains(&extension.as_str()))
        .unwrap_or(false)
}

fn validate_skill_name(name: &str) -> bool {
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

fn validate_frontmatter(frontmatter: Option<&Map<String, Value>>, directory_name: &str) -> (Vec<String>, Vec<String>) {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let name = read_string_field(frontmatter, "name");
    match name {
        Some(ref value) if validate_skill_name(value) => {
            if value != directory_name {
                errors.push("frontmatter.name 必须与技能目录名保持一致。".into());
            }
        }
        Some(_) => {
            errors.push("frontmatter.name 格式不合法：仅支持小写字母、数字和连字符，长度 1-64，且不能以连字符开头或结尾，也不能包含连续的 --。".into());
        }
        None => {
            errors.push("SKILL.md 缺少必填 frontmatter 字段：name。".into());
        }
    }

    match read_string_field(frontmatter, "description") {
        Some(value) => {
            let length = value.chars().count();
            if length > 1024 {
                errors.push("frontmatter.description 长度不能超过 1024 个字符。".into());
            }
            if !value.contains("use when") && !value.contains("使用") && !value.contains("适用") {
                warnings.push("frontmatter.description 建议同时描述技能做什么，以及在什么情况下使用。".into());
            }
        }
        None => {
            errors.push("SKILL.md 缺少必填 frontmatter 字段：description。".into());
        }
    }

    if let Some(compatibility) = read_string_field(frontmatter, "compatibility") {
        let length = compatibility.chars().count();
        if length > 500 {
            errors.push("frontmatter.compatibility 长度不能超过 500 个字符。".into());
        }
    }

    if let Some(metadata) = read_object_field(frontmatter, "metadata") {
        if metadata.iter().any(|(key, value)| key.trim().is_empty() || !value.is_string()) {
            errors.push("frontmatter.metadata 仅支持字符串键值对。".into());
        }
    }

    if let Some(allowed_tools) = read_string_field(frontmatter, "allowed-tools") {
        if allowed_tools.trim().is_empty() {
            errors.push("frontmatter.allowed-tools 不能为空字符串。".into());
        }
    }

    (errors, warnings)
}

fn collect_reference_entries(base_path: &Path, current_path: &Path) -> CommandResult<Vec<SkillReferenceEntry>> {
    let mut entries = Vec::new();
    if !current_path.exists() {
        return Ok(entries);
    }

    for entry in fs::read_dir(current_path).map_err(error_to_string)? {
        let entry = entry.map_err(error_to_string)?;
        let path = entry.path();
        if path.is_dir() {
            entries.extend(collect_reference_entries(base_path, &path)?);
            continue;
        }

        let relative = path
            .strip_prefix(base_path)
            .map_err(error_to_string)?;
        let metadata = fs::metadata(&path).map_err(error_to_string)?;
        entries.push(SkillReferenceEntry {
            extension: detect_extension(&path),
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| normalize_path(&path)),
            path: normalize_path(relative),
            size: metadata.len(),
        });
    }

    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

fn parse_skill_manifest(skill_dir: &Path, source_root: &SkillRoot) -> CommandResult<SkillManifest> {
    let skill_file_path = skill_dir.join("SKILL.md");
    if !skill_file_path.exists() || !skill_file_path.is_file() {
        return Err("技能目录缺少 SKILL.md。".into());
    }

    let raw_markdown = fs::read_to_string(&skill_file_path).map_err(error_to_string)?;
    let directory_name = skill_dir
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "skill".into());

    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let parsed_markdown = match parse_skill_markdown(&raw_markdown) {
        Ok(parsed) => parsed,
        Err(error) => {
            errors.push(error);
            ParsedSkillMarkdown {
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

    let fallback_id = sanitize_skill_id_fallback(&directory_name);
    let id = fallback_id.clone();

    let (frontmatter_errors, frontmatter_warnings) = validate_frontmatter(frontmatter_object, &directory_name);
    errors.extend(frontmatter_errors);
    warnings.extend(frontmatter_warnings);

    let name = read_string_field(frontmatter_object, "name").unwrap_or_else(|| directory_name.clone());
    let description = read_string_field(frontmatter_object, "description")
        .unwrap_or_else(|| extract_description_from_body(&parsed_markdown.body));
    let version = read_string_field(frontmatter_object, "version")
        .or_else(|| read_metadata_string_field(frontmatter_object, "version"));
    let author = read_string_field(frontmatter_object, "author")
        .or_else(|| read_metadata_string_field(frontmatter_object, "author"));
    let tags = read_string_list_field(frontmatter_object, "tags");
    let suggested_tools = {
        let from_tools = read_string_list_field(frontmatter_object, "tools");
        if from_tools.is_empty() {
            read_string_list_field(frontmatter_object, "allowed-tools")
        } else {
            from_tools
        }
    };

    let references_path = skill_dir.join("references");
    let references = if references_path.exists() && references_path.is_dir() {
        let entries = collect_reference_entries(skill_dir, &references_path)?;
        if entries.iter().any(|entry| !is_reference_file_allowed(Path::new(&entry.path))) {
            errors.push("references 目录包含不允许导入的可执行文件。".into());
        }
        entries
    } else {
        Vec::new()
    };

    if parsed_markdown.body.trim().is_empty() {
        warnings.push("SKILL.md 正文为空，运行时可能无法提供有效技能说明。".into());
    }

    Ok(SkillManifest {
        author,
        body: parsed_markdown.body,
        description,
        discovered_at: current_timestamp(),
        frontmatter: parsed_markdown.frontmatter,
        frontmatter_raw: parsed_markdown.frontmatter_raw,
        id,
        install_path: Some(normalize_path(skill_dir)),
        is_builtin: source_root.is_builtin,
        name,
        raw_markdown,
        references,
        references_path: if references_path.exists() {
            Some(normalize_path(&references_path))
        } else {
            None
        },
        skill_file_path: Some(normalize_path(&skill_file_path)),
        source_kind: source_root.source_kind.into(),
        suggested_tools,
        tags,
        validation: SkillValidation {
            is_valid: errors.is_empty(),
            errors,
            warnings,
        },
        version,
    })
}

fn scan_skill_root(root: &SkillRoot) -> CommandResult<Vec<SkillManifest>> {
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

        let skill_file = path.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }

        manifests.push(parse_skill_manifest(&path, root)?);
    }

    Ok(manifests)
}

fn ensure_user_skills_root(app: &AppHandle) -> CommandResult<PathBuf> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(error_to_string)?
        .join("skills");
    fs::create_dir_all(&root).map_err(error_to_string)?;
    Ok(root)
}

fn collect_skill_roots(app: &AppHandle) -> CommandResult<Vec<SkillRoot>> {
    let mut roots = Vec::new();
    if let Ok(resource_root) = app.path().resolve("skills", BaseDirectory::Resource) {
        roots.push(SkillRoot {
            is_builtin: true,
            path: resource_root,
            source_kind: "builtin-package",
        });
    }

    roots.push(SkillRoot {
        is_builtin: false,
        path: ensure_user_skills_root(app)?,
        source_kind: "installed-package",
    });

    Ok(roots)
}

fn scan_all_skills(app: &AppHandle) -> CommandResult<Vec<SkillManifest>> {
    let mut by_id: HashMap<String, SkillManifest> = HashMap::new();
    for root in collect_skill_roots(app)? {
        for manifest in scan_skill_root(&root)? {
            match by_id.get(&manifest.id) {
                Some(existing) if existing.source_kind == "installed-package" => {}
                _ => {
                    by_id.insert(manifest.id.clone(), manifest);
                }
            }
        }
    }

    let mut manifests = by_id.into_values().collect::<Vec<_>>();
    manifests.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(manifests)
}

fn resolve_skill_file_path(skill_dir: &Path, relative_path: &str) -> CommandResult<PathBuf> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("文件路径不能为空。".into());
    }

    let relative = PathBuf::from(trimmed);
    if relative.is_absolute() {
        return Err("文件路径不合法。".into());
    }
    if relative
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
    {
        return Err("文件路径不合法。".into());
    }

    let file_path = skill_dir.join(&relative);
    if !file_path.exists() || !file_path.is_file() {
        return Err("未找到对应技能文件。".into());
    }

    let canonical_file_path = fs::canonicalize(&file_path).map_err(error_to_string)?;
    let canonical_skill_dir = fs::canonicalize(skill_dir).map_err(error_to_string)?;
    if !canonical_file_path.starts_with(&canonical_skill_dir) {
        return Err("技能文件路径超出允许范围。".into());
    }

    Ok(file_path)
}

fn validate_reference_name(name: &str) -> CommandResult<String> {
    let trimmed = name.trim();
    if !validate_skill_name(trimmed) {
        return Err("参考文献名称格式不合法：仅支持小写字母、数字和连字符。".into());
    }
    Ok(trimmed.to_string())
}

fn build_skill_markdown_template(name: &str, description: &str) -> String {
    format!(
        "---\nname: {name}\ndescription: {description}\n---\n# {name}\n\n在这里编写技能说明、适用场景和执行方式。\n"
    )
}

fn write_skill_file(skill_dir: &Path, relative_path: &str, content: &str) -> CommandResult<()> {
    let trimmed = relative_path.trim();
    if trimmed == "SKILL.md" {
        let file_path = skill_dir.join("SKILL.md");
        fs::write(&file_path, content).map_err(error_to_string)?;
        return Ok(());
    }

    let file_path = resolve_reference_file_path(skill_dir, trimmed)?;
    fs::write(file_path, content).map_err(error_to_string)
}

fn create_reference_file(skill_dir: &Path, name: &str) -> CommandResult<String> {
    let safe_name = validate_reference_name(name)?;
    let references_root = skill_dir.join("references");
    fs::create_dir_all(&references_root).map_err(error_to_string)?;

    let relative_path = format!("references/{safe_name}.md");
    let file_path = references_root.join(format!("{safe_name}.md"));
    if file_path.exists() {
        return Err("已存在同名参考文献文件。".into());
    }

    fs::write(
        &file_path,
        format!("# {safe_name}\n\n在这里记录与技能相关的参考内容。\n"),
    )
    .map_err(error_to_string)?;

    Ok(relative_path)
}

fn create_skill_directory_from_content(app: &AppHandle, name: &str, skill_markdown: &str) -> CommandResult<()> {
    let safe_name = validate_reference_name(name)?;
    let user_root = ensure_user_skills_root(app)?;
    let skill_dir = user_root.join(&safe_name);
    if skill_dir.exists() {
        return Err("已存在同名技能。".into());
    }

    fs::create_dir_all(skill_dir.join("references")).map_err(error_to_string)?;
    fs::write(skill_dir.join("SKILL.md"), skill_markdown).map_err(error_to_string)?;

    let scan_root = SkillRoot {
        is_builtin: false,
        path: user_root,
        source_kind: "installed-package",
    };
    let manifest = parse_skill_manifest(&skill_dir, &scan_root)?;
    if !manifest.validation.is_valid {
        let _ = fs::remove_dir_all(&skill_dir);
        let error_details = manifest.validation.errors.join("；");
        return Err(if error_details.is_empty() {
            "复制内置技能失败。".into()
        } else {
            format!("复制内置技能失败：{error_details}")
        });
    }

    Ok(())
}

fn create_skill_directory(app: &AppHandle, name: &str, description: &str) -> CommandResult<()> {
    let safe_name = validate_reference_name(name)?;
    let trimmed_description = description.trim();
    if trimmed_description.is_empty() {
        return Err("技能简介不能为空。".into());
    }
    if trimmed_description.chars().count() > 1024 {
        return Err("技能简介长度不能超过 1024 个字符。".into());
    }

    let user_root = ensure_user_skills_root(app)?;
    let skill_dir = user_root.join(&safe_name);
    if skill_dir.exists() {
        return Err("已存在同名技能。".into());
    }

    fs::create_dir_all(skill_dir.join("references")).map_err(error_to_string)?;
    fs::write(
        skill_dir.join("SKILL.md"),
        build_skill_markdown_template(&safe_name, trimmed_description),
    )
    .map_err(error_to_string)?;

    let scan_root = SkillRoot {
        is_builtin: false,
        path: user_root,
        source_kind: "installed-package",
    };
    let manifest = parse_skill_manifest(&skill_dir, &scan_root)?;
    if !manifest.validation.is_valid {
        let _ = fs::remove_dir_all(&skill_dir);
        let error_details = manifest.validation.errors.join("；");
        return Err(if error_details.is_empty() {
            "新建技能失败。".into()
        } else {
            format!("新建技能失败：{error_details}")
        });
    }

    Ok(())
}

fn resolve_skill_directory(app: &AppHandle, skill_id: &str) -> CommandResult<PathBuf> {
    scan_all_skills(app)?
        .into_iter()
        .find(|skill| skill.id == skill_id)
        .and_then(|skill| skill.install_path)
        .map(PathBuf::from)
        .ok_or_else(|| "未找到对应技能。".into())
}

fn resolve_installed_skill_directory(app: &AppHandle, skill_id: &str) -> CommandResult<PathBuf> {
    let user_root = ensure_user_skills_root(app)?;
    let target_path = user_root.join(skill_id);
    if !target_path.exists() || !target_path.is_dir() {
        return Err("未找到可删除的已安装技能目录。".into());
    }

    let canonical_target_path = fs::canonicalize(&target_path).map_err(error_to_string)?;
    let canonical_user_root = fs::canonicalize(&user_root).map_err(error_to_string)?;
    if !canonical_target_path.starts_with(&canonical_user_root) {
        return Err("技能目录超出允许范围。".into());
    }

    Ok(target_path)
}

fn resolve_reference_file_path(skill_dir: &Path, reference_path: &str) -> CommandResult<PathBuf> {
    let relative_path = PathBuf::from(reference_path);
    if relative_path.is_absolute() {
        return Err("references 路径不合法。".into());
    }
    if relative_path
        .components()
        .any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
    {
        return Err("references 路径不合法。".into());
    }

    let references_root = skill_dir.join("references");
    let reference_file_path = if relative_path.starts_with("references") {
        skill_dir.join(&relative_path)
    } else {
        references_root.join(&relative_path)
    };
    if !reference_file_path.exists() || !reference_file_path.is_file() {
        return Err("未找到对应 reference 文件。".into());
    }
    if !is_reference_file_allowed(&reference_file_path) {
        return Err("当前 reference 文件类型不允许读取。".into());
    }

    let canonical_file_path = fs::canonicalize(&reference_file_path).map_err(error_to_string)?;
    let canonical_references_root = fs::canonicalize(&references_root).map_err(error_to_string)?;
    if !canonical_file_path.starts_with(&canonical_references_root) {
        return Err("references 路径超出允许范围。".into());
    }

    Ok(reference_file_path)
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

fn sync_builtin_skills_to_user_dir(app: &AppHandle) -> CommandResult<BuiltinSkillsInitializationResult> {
    let user_root = ensure_user_skills_root(app)?;
    let builtin_root = match app.path().resolve("skills", BaseDirectory::Resource) {
        Ok(path) if path.exists() && path.is_dir() => path,
        _ => {
            return Ok(BuiltinSkillsInitializationResult {
                initialized_skill_ids: Vec::new(),
                skipped_skill_ids: Vec::new(),
            });
        }
    };

    let builtin_skill_root = SkillRoot {
        is_builtin: true,
        path: builtin_root,
        source_kind: "builtin-package",
    };
    let builtin_manifests = scan_skill_root(&builtin_skill_root)?;

    let mut initialized_skill_ids = Vec::new();
    let mut skipped_skill_ids = Vec::new();
    for manifest in builtin_manifests {
        let Some(install_path) = manifest.install_path.as_deref() else {
            skipped_skill_ids.push(manifest.id);
            continue;
        };

        let target_path = user_root.join(&manifest.id);
        if target_path.exists() {
            skipped_skill_ids.push(manifest.id);
            continue;
        }

        copy_directory_recursive(Path::new(install_path), &target_path)?;
        initialized_skill_ids.push(manifest.id);
    }

    Ok(BuiltinSkillsInitializationResult {
        initialized_skill_ids,
        skipped_skill_ids,
    })
}

fn path_depth(path: &Path) -> usize {
    path.components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count()
}

fn validate_reference_archive_path(path: &Path) -> CommandResult<()> {
    let Some(first_component) = path.components().next() else {
        return Ok(());
    };
    if let Component::Normal(name) = first_component {
        if name.to_string_lossy() == "references" && !is_reference_file_allowed(path) {
            return Err("references 目录中存在不允许导入的文件类型。".into());
        }
    }
    Ok(())
}

fn install_skill_from_zip(app: &AppHandle, zip_path: &Path) -> CommandResult<Vec<SkillManifest>> {
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
        if entry.compressed_size() > 0 && entry.size() / entry.compressed_size().max(1) > MAX_COMPRESSION_RATIO {
            return Err("ZIP 压缩比异常，已拒绝导入。".into());
        }
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_ARCHIVE_TOTAL_SIZE {
            return Err("ZIP 解压后的总大小超出限制。".into());
        }
        safe_paths.push(path.to_path_buf());
    }

    let skill_files = safe_paths
        .iter()
        .filter(|path| path.file_name().map(|name| name == "SKILL.md").unwrap_or(false))
        .cloned()
        .collect::<Vec<_>>();

    if skill_files.is_empty() {
        let preview = safe_paths
            .iter()
            .take(8)
            .map(|path| normalize_path(path))
            .collect::<Vec<_>>()
            .join("，");
        return Err(format!(
            "ZIP 中未找到 SKILL.md。压缩包内检测到的文件示例：{}",
            if preview.is_empty() { "无可用文件".into() } else { preview }
        ));
    }
    if skill_files.len() > 1 {
        let duplicate_files = skill_files
            .iter()
            .map(|path| normalize_path(path))
            .collect::<Vec<_>>()
            .join("，");
        return Err(format!(
            "ZIP 中检测到多个 SKILL.md，当前仅支持单技能包导入。检测到：{}",
            duplicate_files
        ));
    }

    let skill_file_path = &skill_files[0];
    let root_prefix = skill_file_path.parent().map(Path::to_path_buf).unwrap_or_default();
    let archive_file_name = zip_path
        .file_stem()
        .and_then(|name| name.to_str())
        .map(sanitize_skill_id_fallback)
        .unwrap_or_else(|| format!("skill-{}", current_timestamp_millis()));

    let temp_root = app
        .path()
        .app_data_dir()
        .map_err(error_to_string)?
        .join("skill-import-temp")
        .join(format!("{}-{}", archive_file_name, current_timestamp_millis()));
    if temp_root.exists() {
        fs::remove_dir_all(&temp_root).map_err(error_to_string)?;
    }
    fs::create_dir_all(&temp_root).map_err(error_to_string)?;

    let extract_root = temp_root.join(&archive_file_name);
    fs::create_dir_all(&extract_root).map_err(error_to_string)?;

    let mut archive = ZipArchive::new(File::open(zip_path).map_err(error_to_string)?).map_err(error_to_string)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error_to_string)?;
        let Some(safe_path) = entry.enclosed_name() else {
            continue;
        };
        if !root_prefix.as_os_str().is_empty() && !safe_path.starts_with(&root_prefix) {
            continue;
        }
        let relative_path = if root_prefix.as_os_str().is_empty() {
            safe_path.clone()
        } else {
            safe_path
                .strip_prefix(&root_prefix)
                .map_err(error_to_string)?
                .to_path_buf()
        };
        if relative_path.as_os_str().is_empty() {
            continue;
        }
        validate_reference_archive_path(&relative_path)?;

        let output_path = extract_root.join(&relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&output_path).map_err(error_to_string)?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(error_to_string)?;
        }
        let mut output = File::create(&output_path).map_err(error_to_string)?;
        std::io::copy(&mut entry, &mut output).map_err(error_to_string)?;
    }

    let scan_root = SkillRoot {
        is_builtin: false,
        path: extract_root.clone(),
        source_kind: "installed-package",
    };
    let manifest = parse_skill_manifest(&extract_root, &scan_root)?;
    if !manifest.validation.is_valid {
        let _ = fs::remove_dir_all(&temp_root);
        let error_details = manifest.validation.errors.join("；");
        let warning_details = manifest.validation.warnings.join("；");
        return Err(match (error_details.is_empty(), warning_details.is_empty()) {
            (false, false) => format!("技能包校验失败：{}。警告：{}", error_details, warning_details),
            (false, true) => format!("技能包校验失败：{}", error_details),
            (true, false) => format!("技能包校验失败，警告：{}", warning_details),
            (true, true) => "技能包校验失败。".into(),
        });
    }

    let user_root = ensure_user_skills_root(app)?;
    let target_path = user_root.join(&manifest.id);
    if target_path.exists() {
        let _ = fs::remove_dir_all(&temp_root);
        return Err("已存在同名技能，请先移除旧技能后再导入。".into());
    }

    copy_directory_recursive(&extract_root, &target_path)?;
    let _ = fs::remove_dir_all(&temp_root);
    scan_all_skills(app)
}

#[tauri::command]
pub async fn pick_skill_archive(app: AppHandle) -> CommandResult<Option<String>> {
    Ok(app
        .dialog()
        .file()
        .add_filter("Skill ZIP", &["zip"])
        .blocking_pick_file()
        .and_then(|path| path.into_path().ok())
        .map(|path| normalize_path(&path)))
}

#[tauri::command]
pub fn scan_installed_skills(app: AppHandle) -> CommandResult<Vec<SkillManifest>> {
    scan_all_skills(&app)
}

#[tauri::command]
pub fn initialize_builtin_skills(app: AppHandle) -> CommandResult<BuiltinSkillsInitializationResult> {
    sync_builtin_skills_to_user_dir(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_skill_detail(app: AppHandle, skillId: String) -> CommandResult<SkillManifest> {
    scan_all_skills(&app)?
        .into_iter()
        .find(|skill| skill.id == skillId)
        .ok_or_else(|| "未找到对应技能。".into())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_skill_reference_content(
    app: AppHandle,
    skillId: String,
    referencePath: String,
) -> CommandResult<String> {
    let skill_dir = resolve_skill_directory(&app, &skillId)?;
    let reference_file_path = resolve_reference_file_path(&skill_dir, &referencePath)?;
    fs::read_to_string(reference_file_path).map_err(error_to_string)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_skill_file_content(app: AppHandle, skillId: String, relativePath: String) -> CommandResult<String> {
    let skill_dir = resolve_skill_directory(&app, &skillId)?;
    if relativePath.trim() == "SKILL.md" {
        let file_path = resolve_skill_file_path(&skill_dir, "SKILL.md")?;
        return fs::read_to_string(file_path).map_err(error_to_string);
    }

    let reference_file_path = resolve_reference_file_path(&skill_dir, &relativePath)?;
    fs::read_to_string(reference_file_path).map_err(error_to_string)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_skill_file_content(
    app: AppHandle,
    skillId: String,
    relativePath: String,
    content: String,
) -> CommandResult<Vec<SkillManifest>> {
    let installed_skill_dir = resolve_installed_skill_directory(&app, &skillId);
    let skill_dir = match installed_skill_dir {
        Ok(skill_dir) => skill_dir,
        Err(_) => {
            if relativePath.trim() != "SKILL.md" {
                return Err("仅支持先复制内置技能的主文件。".into());
            }
            let manifest = scan_all_skills(&app)?
                .into_iter()
                .find(|skill| skill.id == skillId)
                .ok_or_else(|| "未找到对应技能。".to_string())?;
            create_skill_directory_from_content(&app, &skillId, &content)?;
            let user_root = ensure_user_skills_root(&app)?;
            let copied_skill_dir = user_root.join(&skillId);
            if let Some(references_path) = manifest.references_path {
                let source_references_path = PathBuf::from(references_path);
                if source_references_path.exists() && source_references_path.is_dir() {
                    copy_directory_recursive(&source_references_path, &copied_skill_dir.join("references"))?;
                }
            }
            copied_skill_dir
        }
    };
    write_skill_file(&skill_dir, &relativePath, &content)?;
    scan_all_skills(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_skill(app: AppHandle, name: String, description: String) -> CommandResult<Vec<SkillManifest>> {
    create_skill_directory(&app, &name, &description)?;
    scan_all_skills(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_skill_reference_file(app: AppHandle, skillId: String, name: String) -> CommandResult<Vec<SkillManifest>> {
    let skill_dir = resolve_installed_skill_directory(&app, &skillId)?;
    create_reference_file(&skill_dir, &name)?;
    scan_all_skills(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_installed_skill(app: AppHandle, skillId: String) -> CommandResult<Vec<SkillManifest>> {
    let target_path = resolve_installed_skill_directory(&app, &skillId)?;
    fs::remove_dir_all(&target_path).map_err(error_to_string)?;
    scan_all_skills(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn import_skill_zip(app: AppHandle, zipPath: String) -> CommandResult<Vec<SkillManifest>> {
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
        return Err("仅支持导入 .zip 技能包。".into());
    }

    install_skill_from_zip(&app, &zip_path)
}
