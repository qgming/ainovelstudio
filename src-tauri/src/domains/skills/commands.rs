use crate::domains::skills::skill_store::{SkillMeta, SkillStore};
use crate::{
    app::ToolCancellationRegistry, infrastructure::db::open_database,
    infrastructure::embedded_resources::EMBEDDED_SKILL_FILES,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, State};
use zip::ZipArchive;

type CommandResult<T> = Result<T, String>;
type SkillFiles = HashMap<String, String>;

const MAX_ARCHIVE_ENTRIES: usize = 200;
const MAX_ARCHIVE_FILE_SIZE: u64 = 5 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_SIZE: u64 = 20 * 1024 * 1024;
const MAX_ARCHIVE_DEPTH: usize = 8;
const MAX_COMPRESSION_RATIO: u64 = 200;
const BLOCKED_REFERENCE_EXTENSIONS: [&str; 10] = [
    "exe", "dll", "bat", "cmd", "sh", "ps1", "msi", "com", "scr", "js",
];
const SKILL_SOURCE_BUILTIN: &str = "builtin-package";
const SKILL_SOURCE_INSTALLED: &str = "installed-package";
const SKILL_PRIMARY_FILE: &str = "SKILL.md";
const SKILL_REFERENCES_DIR: &str = "references";
const SKILL_REFERENCES_PREFIX: &str = "references/";
const SKILL_TEMPLATES_DIR: &str = "templates";
const SKILL_TEMPLATES_PREFIX: &str = "templates/";
const BUILTIN_SKILLS_SYNC_VERSION_KEY: &str = "skills.builtin_sync_version";
const BUILTIN_SKILLS_SYNC_SIGNATURE_KEY: &str = "skills.builtin_sync_signature";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillReferenceEntry {
    #[serde(skip_serializing_if = "Option::is_none")]
    extension: Option<String>,
    name: String,
    path: String,
    size: u64,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillValidation {
    errors: Vec<String>,
    is_valid: bool,
    warnings: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillManifest {
    #[serde(skip_serializing_if = "Option::is_none")]
    author: Option<String>,
    body: String,
    default_enabled: bool,
    description: String,
    discovered_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
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
    #[serde(default)]
    templates: Vec<SkillReferenceEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    templates_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    skill_file_path: Option<String>,
    source_kind: String,
    #[serde(default)]
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

fn normalize_text_content(content: &str) -> String {
    content.replace("\r\n", "\n")
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn sanitize_skill_id_fallback(value: &str) -> String {
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
        "skill".into()
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
        .unwrap_or_else(|| "未提供技能描述。".into())
}

fn parse_skill_markdown(raw: &str) -> CommandResult<ParsedSkillMarkdown> {
    let normalized = normalize_text_content(raw);
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

    let closing_index =
        closing_index.ok_or_else(|| "SKILL.md 的 YAML 头部缺少结束分隔符 ---。".to_string())?;
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

fn is_skill_supporting_file_allowed(path: &Path) -> bool {
    !detect_extension(path)
        .map(|extension| BLOCKED_REFERENCE_EXTENSIONS.contains(&extension.as_str()))
        .unwrap_or(false)
}

fn is_supported_skill_file_path(path: &str) -> bool {
    path.starts_with(SKILL_REFERENCES_PREFIX) || path.starts_with(SKILL_TEMPLATES_PREFIX)
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

fn validate_frontmatter(
    frontmatter: Option<&Map<String, Value>>,
    skill_id: &str,
) -> (Vec<String>, Vec<String>) {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    let name = read_string_field(frontmatter, "name");
    match name {
        Some(ref value) if validate_skill_name(value) => {
            if value != skill_id {
                errors.push("frontmatter.name 必须与技能 ID 保持一致。".into());
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
            if value.chars().count() > 1024 {
                errors.push("frontmatter.description 长度不能超过 1024 个字符。".into());
            }
            if !value.contains("use when") && !value.contains("使用") && !value.contains("适用")
            {
                warnings.push(
                    "frontmatter.description 建议同时描述技能做什么，以及在什么情况下使用。".into(),
                );
            }
        }
        None => {
            errors.push("SKILL.md 缺少必填 frontmatter 字段：description。".into());
        }
    }

    if let Some(compatibility) = read_string_field(frontmatter, "compatibility") {
        if compatibility.chars().count() > 500 {
            errors.push("frontmatter.compatibility 长度不能超过 500 个字符。".into());
        }
    }

    if let Some(metadata) = read_object_field(frontmatter, "metadata") {
        if metadata
            .iter()
            .any(|(key, value)| key.trim().is_empty() || !value.is_string())
        {
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

fn normalize_relative_path(relative_path: &str) -> CommandResult<String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("文件路径不能为空。".into());
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

    Ok(normalize_path(&relative))
}

fn validate_skill_file_path(relative_path: &str) -> CommandResult<String> {
    let normalized = normalize_relative_path(relative_path)?;
    if normalized == SKILL_PRIMARY_FILE {
        return Ok(normalized);
    }
    if !is_supported_skill_file_path(&normalized) {
        return Err("仅支持访问 SKILL.md、references 和 templates 目录下的文件。".into());
    }
    if !is_skill_supporting_file_allowed(Path::new(&normalized)) {
        return Err("当前技能文件类型不允许访问。".into());
    }
    Ok(normalized)
}

fn resolve_reference_relative_path(reference_path: &str) -> CommandResult<String> {
    let normalized = normalize_relative_path(reference_path)?;
    let resolved = if normalized.starts_with("references/") {
        normalized
    } else {
        format!("references/{normalized}")
    };
    validate_skill_file_path(&resolved)
}

fn build_skill_virtual_path(skill_id: &str, relative_path: &str) -> String {
    format!("sqlite://skills/{skill_id}/{relative_path}")
}

fn collect_skill_entries_from_files(files: &SkillFiles, prefix: &str) -> Vec<SkillReferenceEntry> {
    let mut entries = files
        .iter()
        .filter(|(path, _)| path.starts_with(prefix))
        .map(|(path, content)| SkillReferenceEntry {
            extension: detect_extension(Path::new(path)),
            name: Path::new(path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string()),
            path: path.clone(),
            size: content.len() as u64,
        })
        .collect::<Vec<_>>();
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    entries
}

fn build_skill_manifest_from_files(
    skill_id: &str,
    files: &SkillFiles,
    source_kind: &str,
    is_builtin: bool,
) -> CommandResult<SkillManifest> {
    let raw_markdown = files
        .get(SKILL_PRIMARY_FILE)
        .cloned()
        .ok_or_else(|| "技能缺少 SKILL.md。".to_string())?;
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
    let (frontmatter_errors, frontmatter_warnings) =
        validate_frontmatter(frontmatter_object, skill_id);
    errors.extend(frontmatter_errors);
    warnings.extend(frontmatter_warnings);

    let references = collect_skill_entries_from_files(files, SKILL_REFERENCES_PREFIX);
    let templates = collect_skill_entries_from_files(files, SKILL_TEMPLATES_PREFIX);
    if references
        .iter()
        .chain(templates.iter())
        .any(|entry| !is_skill_supporting_file_allowed(Path::new(&entry.path)))
    {
        errors.push("references 与 templates 目录包含不允许导入的可执行文件。".into());
    }
    if parsed_markdown.body.trim().is_empty() {
        warnings.push("SKILL.md 正文为空，运行时可能无法提供有效技能说明。".into());
    }

    let name =
        read_string_field(frontmatter_object, "name").unwrap_or_else(|| skill_id.to_string());
    // 中文显示名:可选,不参与校验。优先 frontmatter.displayName,其次 metadata.displayName。
    let display_name = read_string_field(frontmatter_object, "displayName")
        .or_else(|| read_metadata_string_field(frontmatter_object, "displayName"));
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

    Ok(SkillManifest {
        author,
        body: parsed_markdown.body,
        default_enabled: is_builtin,
        description,
        discovered_at: current_timestamp(),
        display_name,
        frontmatter: parsed_markdown.frontmatter,
        frontmatter_raw: parsed_markdown.frontmatter_raw,
        id: skill_id.to_string(),
        install_path: Some(format!("sqlite://skills/{skill_id}")),
        is_builtin,
        name,
        raw_markdown,
        references,
        references_path: files
            .keys()
            .any(|path| path.starts_with(SKILL_REFERENCES_PREFIX))
            .then(|| build_skill_virtual_path(skill_id, SKILL_REFERENCES_DIR)),
        templates,
        templates_path: files
            .keys()
            .any(|path| path.starts_with(SKILL_TEMPLATES_PREFIX))
            .then(|| build_skill_virtual_path(skill_id, SKILL_TEMPLATES_DIR)),
        skill_file_path: Some(build_skill_virtual_path(skill_id, SKILL_PRIMARY_FILE)),
        source_kind: source_kind.into(),
        suggested_tools,
        tags,
        validation: SkillValidation {
            errors: errors.clone(),
            is_valid: errors.is_empty(),
            warnings,
        },
        version,
    })
}

// CP-E：技能存储改真实文件。manifest 不再持久化，按需从文件 + .skill-meta.json 重建。
// source_kind/is_builtin 从 meta 读取；meta 缺失（异常）时按已安装、非内置兜底。

fn save_skill_record(
    store: &SkillStore,
    skill_id: &str,
    files: &SkillFiles,
    source_kind: &str,
    is_builtin: bool,
) -> CommandResult<()> {
    store.write_files(
        skill_id,
        files,
        &SkillMeta {
            source_kind: source_kind.to_string(),
            is_builtin,
        },
    )
}

fn load_skill_record(
    store: &SkillStore,
    skill_id: &str,
) -> CommandResult<Option<(SkillManifest, SkillFiles)>> {
    if !store.exists(skill_id) {
        return Ok(None);
    }
    let files = store.read_files(skill_id)?;
    if !files.contains_key(SKILL_PRIMARY_FILE) {
        return Ok(None);
    }
    let meta = store.read_meta(skill_id)?.unwrap_or(SkillMeta {
        source_kind: SKILL_SOURCE_INSTALLED.to_string(),
        is_builtin: false,
    });
    let manifest =
        build_skill_manifest_from_files(skill_id, &files, &meta.source_kind, meta.is_builtin)?;
    Ok(Some((manifest, files)))
}

fn load_all_skill_records(store: &SkillStore) -> CommandResult<Vec<(SkillManifest, SkillFiles)>> {
    let mut records = Vec::new();
    for skill_id in store.list_ids()? {
        if let Some(record) = load_skill_record(store, &skill_id)? {
            records.push(record);
        }
    }
    Ok(records)
}

fn delete_skill_record(store: &SkillStore, skill_id: &str) -> CommandResult<()> {
    store.delete(skill_id)
}

fn collect_embedded_skill_files(skill_id: &str) -> SkillFiles {
    let prefix = format!("{skill_id}/");
    EMBEDDED_SKILL_FILES
        .iter()
        .filter(|file| file.path.starts_with(&prefix))
        .filter_map(|file| {
            file.path.strip_prefix(&prefix).map(|relative_path| {
                (
                    relative_path.to_string(),
                    normalize_text_content(file.content),
                )
            })
        })
        .collect()
}

fn embedded_skill_ids() -> Vec<String> {
    let mut ids = EMBEDDED_SKILL_FILES
        .iter()
        .filter_map(|file| file.path.split('/').next())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    ids
}

fn current_builtin_skills_sync_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

fn current_builtin_skills_sync_signature() -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for file in EMBEDDED_SKILL_FILES {
        for byte in file.path.bytes().chain([0]).chain(file.content.bytes()) {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("{}:{hash:016x}", EMBEDDED_SKILL_FILES.len())
}

fn read_app_state_string(connection: &Connection, key: &str) -> CommandResult<Option<String>> {
    Ok(connection
        .query_row(
            "SELECT value_json FROM app_state WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?
        .and_then(|raw| serde_json::from_str::<String>(&raw).ok())
        .filter(|value| !value.is_empty()))
}

fn write_app_state_string(connection: &Connection, key: &str, value: &str) -> CommandResult<()> {
    let value_json = serde_json::to_string(value).map_err(error_to_string)?;
    connection
        .execute(
            r#"
            INSERT INTO app_state (key, value_json, updated_at)
            VALUES (?1, ?2, strftime('%s', 'now'))
            ON CONFLICT(key) DO UPDATE
            SET value_json = excluded.value_json,
                updated_at = excluded.updated_at
            "#,
            params![key, value_json],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn has_missing_embedded_skill_record(store: &SkillStore) -> CommandResult<bool> {
    for skill_id in embedded_skill_ids() {
        if !store.exists(&skill_id) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn sync_builtin_skills_to_database(
    app: &AppHandle,
) -> CommandResult<BuiltinSkillsInitializationResult> {
    let store = SkillStore::from_app(app)?;
    let mut initialized_skill_ids = Vec::new();
    let mut skipped_skill_ids = Vec::new();
    for skill_id in embedded_skill_ids() {
        if let Some((existing, _)) = load_skill_record(&store, &skill_id)? {
            if existing.source_kind == SKILL_SOURCE_INSTALLED {
                skipped_skill_ids.push(skill_id);
                continue;
            }
        }

        let files = collect_embedded_skill_files(&skill_id);
        let manifest =
            build_skill_manifest_from_files(&skill_id, &files, SKILL_SOURCE_BUILTIN, true)?;
        if !manifest.validation.is_valid {
            let error_details = manifest.validation.errors.join("；");
            return Err(if error_details.is_empty() {
                format!("内置技能 {skill_id} 初始化失败。")
            } else {
                format!("内置技能 {skill_id} 初始化失败：{error_details}")
            });
        }
        save_skill_record(&store, &skill_id, &files, SKILL_SOURCE_BUILTIN, true)?;
        initialized_skill_ids.push(skill_id);
    }

    Ok(BuiltinSkillsInitializationResult {
        initialized_skill_ids,
        skipped_skill_ids,
    })
}

fn ensure_builtin_skills_seeded(app: &AppHandle) -> CommandResult<()> {
    sync_builtin_skills_if_needed(app).map(|_| ())
}

fn sync_builtin_skills_if_needed(
    app: &AppHandle,
) -> CommandResult<BuiltinSkillsInitializationResult> {
    let connection = open_database(app)?;
    let current_version = current_builtin_skills_sync_version(app);
    let current_signature = current_builtin_skills_sync_signature();
    let saved_version = read_app_state_string(&connection, BUILTIN_SKILLS_SYNC_VERSION_KEY)?;
    let saved_signature = read_app_state_string(&connection, BUILTIN_SKILLS_SYNC_SIGNATURE_KEY)?;
    drop(connection);
    let store = SkillStore::from_app(app)?;
    let has_missing_embedded_skill = has_missing_embedded_skill_record(&store)?;

    let needs_sync = saved_version.as_deref() != Some(current_version.as_str())
        || saved_signature.as_deref() != Some(current_signature.as_str())
        || has_missing_embedded_skill;

    if !needs_sync {
        return Ok(BuiltinSkillsInitializationResult {
            initialized_skill_ids: Vec::new(),
            skipped_skill_ids: Vec::new(),
        });
    }

    let result = sync_builtin_skills_to_database(app)?;

    let connection = open_database(app)?;
    write_app_state_string(
        &connection,
        BUILTIN_SKILLS_SYNC_VERSION_KEY,
        &current_version,
    )?;
    write_app_state_string(
        &connection,
        BUILTIN_SKILLS_SYNC_SIGNATURE_KEY,
        &current_signature,
    )?;
    Ok(result)
}

fn scan_all_skills(
    app: &AppHandle,
    registry: Option<&ToolCancellationRegistry>,
    request_id: Option<&str>,
) -> CommandResult<Vec<SkillManifest>> {
    if let Some(registry) = registry {
        registry.check(request_id)?;
    }
    ensure_builtin_skills_seeded(app)?;
    if let Some(registry) = registry {
        registry.check(request_id)?;
    }

    let store = SkillStore::from_app(app)?;
    let mut manifests = load_all_skill_records(&store)?
        .into_iter()
        .map(|(manifest, _)| manifest)
        .collect::<Vec<_>>();
    manifests.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(manifests)
}

fn read_skill_package(
    app: &AppHandle,
    skill_id: &str,
) -> CommandResult<(SkillManifest, SkillFiles)> {
    ensure_builtin_skills_seeded(app)?;
    let store = SkillStore::from_app(app)?;
    load_skill_record(&store, skill_id)?.ok_or_else(|| "未找到对应技能。".into())
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

fn save_skill_files(
    app: &AppHandle,
    skill_id: &str,
    files: &SkillFiles,
    source_kind: &str,
    is_builtin: bool,
) -> CommandResult<()> {
    // 写盘前先校验 manifest 可构建（保持与旧逻辑一致的失败前置）。
    build_skill_manifest_from_files(skill_id, files, source_kind, is_builtin)?;
    let store = SkillStore::from_app(app)?;
    save_skill_record(&store, skill_id, files, source_kind, is_builtin)
}

fn create_skill_record(app: &AppHandle, name: &str, description: &str) -> CommandResult<()> {
    let safe_name = validate_reference_name(name)?;
    let trimmed_description = description.trim();
    if trimmed_description.is_empty() {
        return Err("技能简介不能为空。".into());
    }
    if trimmed_description.chars().count() > 1024 {
        return Err("技能简介长度不能超过 1024 个字符。".into());
    }

    let store = SkillStore::from_app(app)?;
    if load_skill_record(&store, &safe_name)?.is_some() {
        return Err("已存在同名技能。".into());
    }

    let files = SkillFiles::from([(
        SKILL_PRIMARY_FILE.to_string(),
        build_skill_markdown_template(&safe_name, trimmed_description),
    )]);
    let manifest =
        build_skill_manifest_from_files(&safe_name, &files, SKILL_SOURCE_INSTALLED, false)?;
    if !manifest.validation.is_valid {
        let error_details = manifest.validation.errors.join("；");
        return Err(if error_details.is_empty() {
            "新建技能失败。".into()
        } else {
            format!("新建技能失败：{error_details}")
        });
    }
    save_skill_record(&store, &safe_name, &files, SKILL_SOURCE_INSTALLED, false)
}

fn create_reference_file(app: &AppHandle, skill_id: &str, name: &str) -> CommandResult<String> {
    let safe_name = validate_reference_name(name)?;
    let (manifest, mut files) = read_skill_package(app, skill_id)?;
    if manifest.source_kind != SKILL_SOURCE_INSTALLED {
        return Err("仅支持为已安装技能创建参考文献。".into());
    }

    let relative_path = format!("references/{safe_name}.md");
    if files.contains_key(&relative_path) {
        return Err("已存在同名参考文献文件。".into());
    }

    files.insert(
        relative_path.clone(),
        format!("# {safe_name}\n\n在这里记录与技能相关的参考内容。\n"),
    );
    save_skill_files(app, skill_id, &files, SKILL_SOURCE_INSTALLED, false)?;
    Ok(relative_path)
}

fn write_skill_content(
    app: &AppHandle,
    skill_id: &str,
    relative_path: &str,
    content: &str,
) -> CommandResult<()> {
    let path = validate_skill_file_path(relative_path)?;
    let (_, mut files) = read_skill_package(app, skill_id)?;
    files.insert(path, normalize_text_content(content));
    save_skill_files(app, skill_id, &files, SKILL_SOURCE_INSTALLED, false)
}

fn resolve_skill_reference_pointer(content: &str) -> Option<(String, String)> {
    let lines = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    if lines.len() != 1 {
        return None;
    }

    let target = lines[0].strip_prefix("../../")?;
    let parts = target.split('/').collect::<Vec<_>>();
    if parts.len() < 3 || !validate_skill_name(parts[0]) {
        return None;
    }
    if parts[1] != SKILL_REFERENCES_DIR && parts[1] != SKILL_TEMPLATES_DIR {
        return None;
    }

    Some((parts[0].to_string(), parts[1..].join("/")))
}

fn read_skill_content_inner(
    app: &AppHandle,
    skill_id: &str,
    relative_path: &str,
    depth: usize,
) -> CommandResult<String> {
    let path = validate_skill_file_path(relative_path)?;
    let (_, files) = read_skill_package(app, skill_id)?;
    let content = files
        .get(&path)
        .cloned()
        .ok_or_else(|| "未找到对应技能文件。".to_string())?;

    if depth < 4 {
        if let Some((target_skill_id, target_relative_path)) =
            resolve_skill_reference_pointer(&content)
        {
            return read_skill_content_inner(
                app,
                &target_skill_id,
                &target_relative_path,
                depth + 1,
            );
        }
    }

    Ok(content)
}

fn read_skill_content(
    app: &AppHandle,
    skill_id: &str,
    relative_path: &str,
) -> CommandResult<String> {
    read_skill_content_inner(app, skill_id, relative_path, 0)
}

fn path_depth(path: &Path) -> usize {
    path.components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count()
}

fn validate_skill_archive_path(path: &Path) -> CommandResult<()> {
    let Some(first_component) = path.components().next() else {
        return Ok(());
    };
    if let Component::Normal(name) = first_component {
        let directory = name.to_string_lossy();
        if (directory == SKILL_REFERENCES_DIR || directory == SKILL_TEMPLATES_DIR)
            && !is_skill_supporting_file_allowed(path)
        {
            return Err("references 与 templates 目录中存在不允许导入的文件类型。".into());
        }
    }
    Ok(())
}

fn read_skill_files_from_archive<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> CommandResult<SkillFiles> {
    if archive.is_empty() {
        return Err("ZIP 压缩包为空。".into());
    }
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("ZIP 内文件数量过多。".into());
    }
    let mut safe_paths = Vec::new();
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

    let skill_files = safe_paths
        .iter()
        .filter(|path| {
            path.file_name()
                .map(|name| name == SKILL_PRIMARY_FILE)
                .unwrap_or(false)
        })
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
            if preview.is_empty() {
                "无可用文件".into()
            } else {
                preview
            }
        ));
    }
    if skill_files.len() > 1 {
        let duplicate_files = skill_files
            .iter()
            .map(|path| normalize_path(path))
            .collect::<Vec<_>>()
            .join("，");
        return Err(format!(
            "ZIP 中检测到多个 SKILL.md，当前仅支持单技能包导入。检测到：{duplicate_files}"
        ));
    }

    let root_prefix = skill_files[0]
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let mut files = SkillFiles::new();

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(error_to_string)?;
        if entry.is_dir() {
            continue;
        }

        let Some(safe_path) = entry.enclosed_name() else {
            continue;
        };
        if !root_prefix.as_os_str().is_empty() && !safe_path.starts_with(&root_prefix) {
            continue;
        }
        let relative_path = if root_prefix.as_os_str().is_empty() {
            safe_path.to_path_buf()
        } else {
            safe_path
                .strip_prefix(&root_prefix)
                .map_err(error_to_string)?
                .to_path_buf()
        };
        if relative_path.as_os_str().is_empty() {
            continue;
        }

        validate_skill_archive_path(&relative_path)?;
        let normalized_path = normalize_relative_path(&normalize_path(&relative_path))?;
        let mut content = String::new();
        entry
            .read_to_string(&mut content)
            .map_err(|_| "技能包仅支持 UTF-8 文本文件。".to_string())?;
        files.insert(normalized_path, normalize_text_content(&content));
    }

    Ok(files)
}

fn derive_skill_id(files: &SkillFiles, file_name: &str) -> String {
    files
        .get(SKILL_PRIMARY_FILE)
        .and_then(|raw| parse_skill_markdown(raw).ok())
        .and_then(|parsed| {
            parsed
                .frontmatter
                .as_ref()
                .and_then(Value::as_object)
                .and_then(|frontmatter| read_string_field(Some(frontmatter), "name"))
        })
        .unwrap_or_else(|| {
            Path::new(file_name)
                .file_stem()
                .and_then(|name| name.to_str())
                .map(sanitize_skill_id_fallback)
                .unwrap_or_else(|| sanitize_skill_id_fallback("skill"))
        })
}

fn install_skill_archive(
    app: &AppHandle,
    file_name: &str,
    archive_bytes: Vec<u8>,
) -> CommandResult<Vec<SkillManifest>> {
    let mut archive = ZipArchive::new(Cursor::new(archive_bytes)).map_err(error_to_string)?;
    let files = read_skill_files_from_archive(&mut archive)?;
    let skill_id = derive_skill_id(&files, file_name);
    let manifest =
        build_skill_manifest_from_files(&skill_id, &files, SKILL_SOURCE_INSTALLED, false)?;
    if !manifest.validation.is_valid {
        let error_details = manifest.validation.errors.join("；");
        let warning_details = manifest.validation.warnings.join("；");
        return Err(
            match (error_details.is_empty(), warning_details.is_empty()) {
                (false, false) => {
                    format!("技能包校验失败：{error_details}。警告：{warning_details}")
                }
                (false, true) => format!("技能包校验失败：{error_details}"),
                (true, false) => format!("技能包校验失败，警告：{warning_details}"),
                (true, true) => "技能包校验失败。".into(),
            },
        );
    }

    let store = SkillStore::from_app(app)?;
    if load_skill_record(&store, &manifest.id)?.is_some() {
        return Err("已存在同名技能，请先移除旧技能后再导入。".into());
    }
    save_skill_record(&store, &manifest.id, &files, SKILL_SOURCE_INSTALLED, false)?;
    scan_all_skills(app, None, None)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn scan_installed_skills(
    app: AppHandle,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<Vec<SkillManifest>> {
    registry.begin(requestId.as_deref());
    let result = scan_all_skills(&app, Some(&registry), requestId.as_deref());
    registry.finish(requestId.as_deref());
    result
}

#[tauri::command]
pub fn initialize_builtin_skills(
    app: AppHandle,
) -> CommandResult<BuiltinSkillsInitializationResult> {
    sync_builtin_skills_if_needed(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_skill_detail(app: AppHandle, skillId: String) -> CommandResult<SkillManifest> {
    read_skill_package(&app, &skillId).map(|(manifest, _)| manifest)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_skill_reference_content(
    app: AppHandle,
    skillId: String,
    referencePath: String,
) -> CommandResult<String> {
    let reference_path = resolve_reference_relative_path(&referencePath)?;
    read_skill_content(&app, &skillId, &reference_path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_skill_file_content(
    app: AppHandle,
    skillId: String,
    relativePath: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    registry.begin(requestId.as_deref());
    let result = (|| {
        registry.check(requestId.as_deref())?;
        read_skill_content(&app, &skillId, &relativePath)
    })();
    registry.finish(requestId.as_deref());
    result
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_skill_file_content(
    app: AppHandle,
    skillId: String,
    relativePath: String,
    content: String,
) -> CommandResult<Vec<SkillManifest>> {
    write_skill_content(&app, &skillId, &relativePath, &content)?;
    scan_all_skills(&app, None, None)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_skill(
    app: AppHandle,
    name: String,
    description: String,
) -> CommandResult<Vec<SkillManifest>> {
    create_skill_record(&app, &name, &description)?;
    scan_all_skills(&app, None, None)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_skill_reference_file(
    app: AppHandle,
    skillId: String,
    name: String,
) -> CommandResult<Vec<SkillManifest>> {
    create_reference_file(&app, &skillId, &name)?;
    scan_all_skills(&app, None, None)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_installed_skill(
    app: AppHandle,
    skillId: String,
) -> CommandResult<Vec<SkillManifest>> {
    let store = SkillStore::from_app(&app)?;
    let Some((manifest, _)) = load_skill_record(&store, &skillId)? else {
        return Err("未找到可删除的已安装技能。".into());
    };
    if manifest.source_kind != SKILL_SOURCE_INSTALLED {
        return Err("仅支持删除已安装技能。".into());
    }
    delete_skill_record(&store, &skillId)?;
    scan_all_skills(&app, None, None)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn import_skill_zip(
    app: AppHandle,
    fileName: String,
    archiveBytes: Vec<u8>,
) -> CommandResult<Vec<SkillManifest>> {
    if Path::new(&fileName)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("zip"))
        != Some(true)
    {
        return Err("仅支持导入 .zip 技能包。".into());
    }
    if archiveBytes.is_empty() {
        return Err("ZIP 压缩包为空。".into());
    }

    install_skill_archive(&app, &fileName, archiveBytes)
}

// —— skills_root 文件访问命令（供 pi loadSkills 的 ExecutionEnv 转发）——
// path 相对 app_data_dir/skills/，后端做 .. 越界校验并锁在该目录内。

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFsEntry {
    name: String,
    is_dir: bool,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFsInfo {
    kind: String,
    size: u64,
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn skill_fs_read(app: AppHandle, path: String) -> CommandResult<String> {
    SkillStore::from_app(&app)?.root_read(&path)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn skill_fs_file_info(app: AppHandle, path: String) -> CommandResult<Option<SkillFsInfo>> {
    Ok(SkillStore::from_app(&app)?
        .root_file_info(&path)?
        .map(|(kind, size)| SkillFsInfo { kind, size }))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn skill_fs_list_dir(app: AppHandle, path: String) -> CommandResult<Vec<SkillFsEntry>> {
    Ok(SkillStore::from_app(&app)?
        .root_list_dir(&path)?
        .into_iter()
        .map(|(name, is_dir, size)| SkillFsEntry { name, is_dir, size })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_manifest_defaults_missing_suggested_tools_to_empty_list() {
        let manifest = serde_json::from_str::<SkillManifest>(
            r##"{
                "author": "tester",
                "body": "Legacy skill body",
                "defaultEnabled": true,
                "description": "Legacy skill description",
                "discoveredAt": 1,
                "id": "legacy-skill",
                "installPath": "sqlite://skills/legacy-skill",
                "isBuiltin": true,
                "name": "Legacy Skill",
                "rawMarkdown": "# Legacy skill",
                "references": [],
                "sourceKind": "builtin-package",
                "tags": [],
                "validation": {
                    "errors": [],
                    "isValid": true,
                    "warnings": []
                },
                "version": "1.0.0"
            }"##,
        )
        .expect("legacy manifest without suggestedTools should deserialize");

        assert!(manifest.suggested_tools.is_empty());
    }
}
