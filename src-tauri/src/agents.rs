use crate::{
    db::open_database, embedded_resources::EMBEDDED_AGENT_FILES, ToolCancellationRegistry,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, State};
use zip::ZipArchive;

type CommandResult<T> = Result<T, String>;
type AgentFiles = HashMap<String, String>;

const MAX_ARCHIVE_ENTRIES: usize = 200;
const MAX_ARCHIVE_FILE_SIZE: u64 = 5 * 1024 * 1024;
const MAX_ARCHIVE_TOTAL_SIZE: u64 = 20 * 1024 * 1024;
const MAX_ARCHIVE_DEPTH: usize = 8;
const MAX_COMPRESSION_RATIO: u64 = 200;
const PRIMARY_AGENT_FILES: [&str; 2] = ["manifest.json", "AGENTS.md"];
const AGENT_SOURCE_BUILTIN: &str = "builtin-package";
const AGENT_SOURCE_INSTALLED: &str = "installed-package";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentValidation {
    errors: Vec<String>,
    is_valid: bool,
    warnings: Vec<String>,
}

#[derive(Clone, Deserialize, Serialize)]
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
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    install_path: Option<String>,
    is_builtin: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    manifest_file_path: Option<String>,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    source_kind: String,
    suggested_tools: Vec<String>,
    tags: Vec<String>,
    validation: AgentValidation,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_file_path: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentPackageManifest {
    id: String,
    name: String,
    description: String,
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    dispatch_hint: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    suggested_tools: Vec<String>,
    #[serde(default)]
    default_enabled: Option<bool>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    author: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltinAgentsInitializationResult {
    initialized_agent_ids: Vec<String>,
    skipped_agent_ids: Vec<String>,
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

fn sanitize_agent_id_fallback(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|char| {
            if char.is_ascii_lowercase() || char.is_ascii_digit() {
                char
            } else if char.is_ascii_uppercase() {
                char.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();

    let collapsed = sanitized
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    let trimmed = collapsed.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "agent".into()
    } else {
        trimmed.chars().take(64).collect()
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

fn validate_optional_text_field(
    value: Option<&str>,
    max_length: usize,
    field_name: &str,
    errors: &mut Vec<String>,
) {
    if let Some(value) = value {
        if value.chars().count() > max_length {
            errors.push(format!("{field_name} 长度不能超过 {max_length} 个字符。"));
        }
    }
}

fn validate_manifest(
    manifest: &AgentPackageManifest,
    agent_id: &str,
) -> (Vec<String>, Vec<String>) {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();

    if !validate_agent_name(&manifest.id) {
        errors.push("manifest.json 中的 id 格式不合法：仅支持小写字母、数字和连字符，长度 1-64，且不能以连字符开头或结尾，也不能包含连续的 --。".into());
    } else if manifest.id != agent_id {
        errors.push("manifest.json 中的 id 必须与代理 ID 保持一致。".into());
    }

    if manifest.name.trim().is_empty() {
        errors.push("manifest.json 缺少必填字段：name。".into());
    }

    if manifest.description.trim().is_empty() {
        errors.push("manifest.json 缺少必填字段：description。".into());
    } else if manifest.description.chars().count() > 1024 {
        errors.push("manifest.json 中的 description 长度不能超过 1024 个字符。".into());
    }
    validate_optional_text_field(
        manifest.role.as_deref(),
        64,
        "manifest.json 中的 role",
        &mut errors,
    );
    validate_optional_text_field(
        manifest.dispatch_hint.as_deref(),
        500,
        "manifest.json 中的 dispatchHint",
        &mut errors,
    );

    if manifest
        .role
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        warnings.push("建议填写 manifest.json.role，用于主代理委派。".into());
    }
    if manifest
        .dispatch_hint
        .as_deref()
        .is_none_or(|value| value.trim().is_empty())
    {
        warnings.push("建议填写 manifest.json.dispatchHint，用于说明何时委派该代理。".into());
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

fn validate_agent_file_path(relative_path: &str) -> CommandResult<String> {
    let normalized = normalize_relative_path(relative_path)?;
    if !PRIMARY_AGENT_FILES.contains(&normalized.as_str()) {
        return Err("仅允许访问 manifest.json 和 AGENTS.md。".into());
    }
    Ok(normalized)
}

fn build_agent_virtual_path(agent_id: &str, relative_path: &str) -> String {
    format!("sqlite://agents/{agent_id}/{relative_path}")
}

fn build_agent_manifest_from_files(
    agent_id: &str,
    files: &AgentFiles,
    source_kind: &str,
    is_builtin: bool,
) -> CommandResult<AgentManifest> {
    let manifest_text = files
        .get("manifest.json")
        .cloned()
        .ok_or_else(|| "代理目录缺少 manifest.json。".to_string())?;
    let body = files
        .get("AGENTS.md")
        .cloned()
        .ok_or_else(|| "代理目录缺少 AGENTS.md。".to_string())?;
    let package_manifest = serde_json::from_str::<AgentPackageManifest>(&manifest_text)
        .map_err(|error| format!("manifest.json 解析失败：{error}"))?;

    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let (manifest_errors, manifest_warnings) = validate_manifest(&package_manifest, agent_id);
    errors.extend(manifest_errors);
    warnings.extend(manifest_warnings);

    if body.trim().is_empty() {
        warnings.push("AGENTS.md 正文为空，运行时可能无法提供有效代理说明。".into());
    }

    Ok(AgentManifest {
        author: package_manifest.author,
        body,
        default_enabled: package_manifest.default_enabled.unwrap_or(is_builtin),
        description: package_manifest.description,
        discovered_at: current_timestamp(),
        dispatch_hint: package_manifest.dispatch_hint,
        id: package_manifest.id,
        install_path: Some(format!("sqlite://agents/{agent_id}")),
        is_builtin,
        manifest_file_path: Some(build_agent_virtual_path(agent_id, "manifest.json")),
        name: package_manifest.name,
        role: package_manifest.role,
        source_kind: source_kind.into(),
        suggested_tools: package_manifest.suggested_tools,
        tags: package_manifest.tags,
        validation: AgentValidation {
            errors: errors.clone(),
            is_valid: errors.is_empty(),
            warnings,
        },
        version: package_manifest.version,
        agent_file_path: Some(build_agent_virtual_path(agent_id, "AGENTS.md")),
    })
}

fn serialize_json<T: Serialize>(value: &T) -> CommandResult<String> {
    serde_json::to_string(value).map_err(error_to_string)
}

fn canonicalize_agent_files(files: &AgentFiles) -> AgentFiles {
    files
        .iter()
        .filter(|(path, _)| PRIMARY_AGENT_FILES.contains(&path.as_str()))
        .map(|(path, content)| (path.clone(), content.clone()))
        .collect()
}

fn save_agent_record(
    connection: &Connection,
    manifest: &AgentManifest,
    files: &AgentFiles,
) -> CommandResult<()> {
    let normalized_files = canonicalize_agent_files(files);
    connection
        .execute(
            r#"
            INSERT INTO agent_packages (id, source_kind, is_builtin, manifest_json, files_json, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(id) DO UPDATE
            SET source_kind = excluded.source_kind,
                is_builtin = excluded.is_builtin,
                manifest_json = excluded.manifest_json,
                files_json = excluded.files_json,
                updated_at = excluded.updated_at
            "#,
            params![
                manifest.id,
                manifest.source_kind,
                if manifest.is_builtin { 1 } else { 0 },
                serialize_json(manifest)?,
                serialize_json(&normalized_files)?,
                current_timestamp() as i64,
            ],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn load_agent_record(
    connection: &Connection,
    agent_id: &str,
) -> CommandResult<Option<(AgentManifest, AgentFiles)>> {
    connection
        .query_row(
            "SELECT manifest_json, files_json FROM agent_packages WHERE id = ?1",
            params![agent_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(error_to_string)?
        .map(|(manifest_raw, files_raw)| {
            let manifest =
                serde_json::from_str::<AgentManifest>(&manifest_raw).map_err(error_to_string)?;
            let files = serde_json::from_str::<AgentFiles>(&files_raw).map_err(error_to_string)?;
            Ok((manifest, files))
        })
        .transpose()
}

fn load_all_agent_records(
    connection: &Connection,
) -> CommandResult<Vec<(AgentManifest, AgentFiles)>> {
    let mut statement = connection
        .prepare("SELECT manifest_json, files_json FROM agent_packages")
        .map_err(error_to_string)?;
    let mut rows = statement.query([]).map_err(error_to_string)?;
    let mut records = Vec::new();
    while let Some(row) = rows.next().map_err(error_to_string)? {
        let manifest_raw = row.get::<_, String>(0).map_err(error_to_string)?;
        let files_raw = row.get::<_, String>(1).map_err(error_to_string)?;
        let manifest =
            serde_json::from_str::<AgentManifest>(&manifest_raw).map_err(error_to_string)?;
        let files = serde_json::from_str::<AgentFiles>(&files_raw).map_err(error_to_string)?;
        records.push((manifest, files));
    }
    Ok(records)
}

fn delete_agent_record(connection: &Connection, agent_id: &str) -> CommandResult<()> {
    connection
        .execute(
            "DELETE FROM agent_packages WHERE id = ?1",
            params![agent_id],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn collect_embedded_agent_files(agent_id: &str) -> AgentFiles {
    let prefix = format!("{agent_id}/");
    EMBEDDED_AGENT_FILES
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

fn embedded_agent_ids() -> Vec<String> {
    let mut ids = EMBEDDED_AGENT_FILES
        .iter()
        .filter_map(|file| file.path.split('/').next())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    ids
}

fn sync_builtin_agents_to_database(
    app: &AppHandle,
) -> CommandResult<BuiltinAgentsInitializationResult> {
    let connection = open_database(app)?;
    let mut initialized_agent_ids = Vec::new();
    let mut skipped_agent_ids = Vec::new();
    for agent_id in embedded_agent_ids() {
        if let Some((existing, _)) = load_agent_record(&connection, &agent_id)? {
            if existing.source_kind == AGENT_SOURCE_INSTALLED {
                skipped_agent_ids.push(agent_id);
                continue;
            }
        }

        let files = collect_embedded_agent_files(&agent_id);
        let manifest =
            build_agent_manifest_from_files(&agent_id, &files, AGENT_SOURCE_BUILTIN, true)?;
        if !manifest.validation.is_valid {
            let error_details = manifest.validation.errors.join("；");
            return Err(if error_details.is_empty() {
                format!("内置代理 {agent_id} 初始化失败。")
            } else {
                format!("内置代理 {agent_id} 初始化失败：{error_details}")
            });
        }
        save_agent_record(&connection, &manifest, &files)?;
        initialized_agent_ids.push(agent_id);
    }

    Ok(BuiltinAgentsInitializationResult {
        initialized_agent_ids,
        skipped_agent_ids,
    })
}

fn ensure_builtin_agents_seeded(app: &AppHandle) -> CommandResult<()> {
    sync_builtin_agents_to_database(app).map(|_| ())
}

fn scan_all_agents(
    app: &AppHandle,
    registry: Option<&ToolCancellationRegistry>,
    request_id: Option<&str>,
) -> CommandResult<Vec<AgentManifest>> {
    if let Some(registry) = registry {
        registry.check(request_id)?;
    }
    ensure_builtin_agents_seeded(app)?;
    if let Some(registry) = registry {
        registry.check(request_id)?;
    }

    let connection = open_database(app)?;
    let mut manifests = load_all_agent_records(&connection)?
        .into_iter()
        .map(|(manifest, _)| manifest)
        .collect::<Vec<_>>();
    manifests.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(manifests)
}

fn read_agent_package(
    app: &AppHandle,
    agent_id: &str,
) -> CommandResult<(AgentManifest, AgentFiles)> {
    ensure_builtin_agents_seeded(app)?;
    let connection = open_database(app)?;
    load_agent_record(&connection, agent_id)?.ok_or_else(|| "未找到对应代理。".into())
}

fn build_agent_manifest_template(name: &str, description: &str) -> String {
    serde_json::to_string_pretty(&serde_json::json!({
        "id": name,
        "name": name,
        "description": description,
        "role": name,
        "dispatchHint": "当任务与该代理专长高度相关时优先委派。",
        "tags": ["writing"],
        "suggestedTools": [],
        "defaultEnabled": false,
        "version": "1.0.0"
    }))
    .unwrap_or_else(|_| {
        format!(
            "{{\n  \"id\": \"{name}\",\n  \"name\": \"{name}\",\n  \"description\": \"{description}\",\n  \"defaultEnabled\": false,\n  \"version\": \"1.0.0\"\n}}"
        )
    })
}

fn build_agent_markdown_template(name: &str) -> String {
    format!(
        "# {name}\n\n你是一名写作代理，负责根据用户需求产出可直接使用的小说内容。\n\n## 工作方式\n- 先理解任务目标与约束。\n- 明确当前章节或片段需要达成的效果。\n- 输出可直接采用的写作结果，并说明关键改动理由。\n"
    )
}

fn save_agent_files(
    app: &AppHandle,
    agent_id: &str,
    files: &AgentFiles,
    source_kind: &str,
    is_builtin: bool,
) -> CommandResult<()> {
    let manifest = build_agent_manifest_from_files(agent_id, files, source_kind, is_builtin)?;
    let connection = open_database(app)?;
    save_agent_record(&connection, &manifest, files)
}

fn create_agent_record(app: &AppHandle, name: &str, description: &str) -> CommandResult<()> {
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

    let connection = open_database(app)?;
    if load_agent_record(&connection, safe_name)?.is_some() {
        return Err("已存在同名代理。".into());
    }

    let files = AgentFiles::from([
        (
            "manifest.json".to_string(),
            build_agent_manifest_template(safe_name, trimmed_description),
        ),
        (
            "AGENTS.md".to_string(),
            build_agent_markdown_template(safe_name),
        ),
    ]);
    let manifest =
        build_agent_manifest_from_files(safe_name, &files, AGENT_SOURCE_INSTALLED, false)?;
    if !manifest.validation.is_valid {
        let error_details = manifest.validation.errors.join("；");
        return Err(if error_details.is_empty() {
            "新建代理失败。".into()
        } else {
            format!("新建代理失败：{error_details}")
        });
    }
    save_agent_record(&connection, &manifest, &files)
}

fn write_agent_content(
    app: &AppHandle,
    agent_id: &str,
    relative_path: &str,
    content: &str,
) -> CommandResult<()> {
    let path = validate_agent_file_path(relative_path)?;
    let (_, mut files) = read_agent_package(app, agent_id)?;
    files.insert(path, normalize_text_content(content));
    save_agent_files(app, agent_id, &files, AGENT_SOURCE_INSTALLED, false)
}

fn read_agent_content(
    app: &AppHandle,
    agent_id: &str,
    relative_path: &str,
) -> CommandResult<String> {
    let path = validate_agent_file_path(relative_path)?;
    let (_, files) = read_agent_package(app, agent_id)?;
    files
        .get(&path)
        .cloned()
        .ok_or_else(|| "未找到对应代理文件。".into())
}

fn path_depth(path: &Path) -> usize {
    path.components()
        .filter(|component| matches!(component, Component::Normal(_)))
        .count()
}

fn read_agent_files_from_archive<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> CommandResult<AgentFiles> {
    if archive.len() == 0 {
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

    let manifest_files = safe_paths
        .iter()
        .filter(|path| {
            path.file_name()
                .map(|name| name == "manifest.json")
                .unwrap_or(false)
        })
        .cloned()
        .collect::<Vec<_>>();

    if manifest_files.is_empty() {
        let preview = safe_paths
            .iter()
            .take(8)
            .map(|path| normalize_path(path))
            .collect::<Vec<_>>()
            .join("，");
        return Err(format!(
            "ZIP 中未找到 manifest.json。压缩包内检测到的文件示例：{}",
            if preview.is_empty() {
                "无可用文件".into()
            } else {
                preview
            }
        ));
    }
    if manifest_files.len() > 1 {
        let duplicate_files = manifest_files
            .iter()
            .map(|path| normalize_path(path))
            .collect::<Vec<_>>()
            .join("，");
        return Err(format!(
            "ZIP 中检测到多个 manifest.json，当前仅支持单代理包导入。检测到：{}",
            duplicate_files
        ));
    }

    let root_prefix = manifest_files[0]
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let mut files = AgentFiles::new();

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

        let normalized_path = normalize_relative_path(&normalize_path(&relative_path))?;
        let mut content = String::new();
        entry
            .read_to_string(&mut content)
            .map_err(|_| "代理包仅支持 UTF-8 文本文件。".to_string())?;
        files.insert(normalized_path, normalize_text_content(&content));
    }

    Ok(files)
}

fn derive_agent_id(files: &AgentFiles, file_name: &str) -> String {
    files
        .get("manifest.json")
        .and_then(|content| serde_json::from_str::<AgentPackageManifest>(content).ok())
        .map(|manifest| manifest.id)
        .unwrap_or_else(|| {
            Path::new(file_name)
                .file_stem()
                .and_then(|name| name.to_str())
                .map(sanitize_agent_id_fallback)
                .unwrap_or_else(|| sanitize_agent_id_fallback("agent"))
        })
}

fn install_agent_archive(
    app: &AppHandle,
    file_name: &str,
    archive_bytes: Vec<u8>,
) -> CommandResult<Vec<AgentManifest>> {
    let mut archive = ZipArchive::new(Cursor::new(archive_bytes)).map_err(error_to_string)?;
    let files = read_agent_files_from_archive(&mut archive)?;
    let agent_id = derive_agent_id(&files, file_name);
    let manifest =
        build_agent_manifest_from_files(&agent_id, &files, AGENT_SOURCE_INSTALLED, false)?;
    if !manifest.validation.is_valid {
        let error_details = manifest.validation.errors.join("；");
        return Err(if error_details.is_empty() {
            "代理包校验失败。".into()
        } else {
            format!("代理包校验失败：{error_details}")
        });
    }

    let connection = open_database(app)?;
    if load_agent_record(&connection, &manifest.id)?.is_some() {
        return Err("已存在同名代理，请先移除旧代理后再导入。".into());
    }
    save_agent_record(&connection, &manifest, &files)?;
    scan_all_agents(app, None, None)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn scan_installed_agents(
    app: AppHandle,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<Vec<AgentManifest>> {
    registry.begin(requestId.as_deref());
    let result = scan_all_agents(&app, Some(&registry), requestId.as_deref());
    registry.finish(requestId.as_deref());
    result
}

#[tauri::command]
pub fn initialize_builtin_agents(
    app: AppHandle,
) -> CommandResult<BuiltinAgentsInitializationResult> {
    sync_builtin_agents_to_database(&app)
}

fn reset_builtin_agents_in_database(
    app: &AppHandle,
) -> CommandResult<BuiltinAgentsInitializationResult> {
    let connection = open_database(app)?;
    connection
        .execute("DELETE FROM agent_packages", [])
        .map_err(error_to_string)?;
    drop(connection);
    crate::chat::clear_agent_preferences(app.clone())?;
    sync_builtin_agents_to_database(app)
}

#[tauri::command]
pub fn reset_builtin_agents(app: AppHandle) -> CommandResult<BuiltinAgentsInitializationResult> {
    reset_builtin_agents_in_database(&app)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_agent_detail(app: AppHandle, agentId: String) -> CommandResult<AgentManifest> {
    read_agent_package(&app, &agentId).map(|(manifest, _)| manifest)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_agent_file_content(
    app: AppHandle,
    agentId: String,
    relativePath: String,
    requestId: Option<String>,
    registry: State<'_, ToolCancellationRegistry>,
) -> CommandResult<String> {
    registry.begin(requestId.as_deref());
    let result = (|| {
        registry.check(requestId.as_deref())?;
        read_agent_content(&app, &agentId, &relativePath)
    })();
    registry.finish(requestId.as_deref());
    result
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_agent_file_content(
    app: AppHandle,
    agentId: String,
    relativePath: String,
    content: String,
) -> CommandResult<Vec<AgentManifest>> {
    write_agent_content(&app, &agentId, &relativePath, &content)?;
    scan_all_agents(&app, None, None)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn create_agent(
    app: AppHandle,
    name: String,
    description: String,
) -> CommandResult<Vec<AgentManifest>> {
    create_agent_record(&app, &name, &description)?;
    scan_all_agents(&app, None, None)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn delete_installed_agent(
    app: AppHandle,
    agentId: String,
) -> CommandResult<Vec<AgentManifest>> {
    let connection = open_database(&app)?;
    let Some((manifest, _)) = load_agent_record(&connection, &agentId)? else {
        return Err("未找到可删除的已安装代理。".into());
    };
    if manifest.source_kind != AGENT_SOURCE_INSTALLED {
        return Err("仅支持删除已安装代理。".into());
    }
    delete_agent_record(&connection, &agentId)?;
    scan_all_agents(&app, None, None)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn import_agent_zip(
    app: AppHandle,
    fileName: String,
    archiveBytes: Vec<u8>,
) -> CommandResult<Vec<AgentManifest>> {
    if Path::new(&fileName)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("zip"))
        != Some(true)
    {
        return Err("仅支持导入 .zip 代理包。".into());
    }
    if archiveBytes.is_empty() {
        return Err("ZIP 压缩包为空。".into());
    }

    install_agent_archive(&app, &fileName, archiveBytes)
}
