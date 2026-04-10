use serde::Serialize;
use std::{fs, path::{Path, PathBuf}};
use tauri::{path::BaseDirectory, AppHandle, Manager};

type CommandResult<T> = Result<T, String>;

const DEFAULT_AGENT_FILE_NAME: &str = "AGENTS.md";
const DEFAULT_AGENT_TEMPLATE: &str = include_str!("../resources/config/AGENTS.md");

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultAgentConfigDocument {
    initialized_from_builtin: bool,
    markdown: String,
    path: String,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn normalize_markdown(content: &str) -> String {
    content.replace("\r\n", "\n")
}

fn ensure_user_config_root(app: &AppHandle) -> CommandResult<PathBuf> {
    let root = app.path().app_data_dir().map_err(error_to_string)?.join("config");
    fs::create_dir_all(&root).map_err(error_to_string)?;
    Ok(root)
}

fn resolve_builtin_config_root(app: &AppHandle) -> Option<PathBuf> {
    ["config", "resources/config"]
        .into_iter()
        .filter_map(|relative_path| app.path().resolve(relative_path, BaseDirectory::Resource).ok())
        .find(|path| path.exists() && path.is_dir())
}

fn read_builtin_default_agent_markdown(app: &AppHandle) -> CommandResult<String> {
    if let Some(root) = resolve_builtin_config_root(app) {
        let file_path = root.join(DEFAULT_AGENT_FILE_NAME);
        if file_path.exists() && file_path.is_file() {
            return fs::read_to_string(file_path)
                .map(|content| normalize_markdown(&content))
                .map_err(error_to_string);
        }
    }

    Ok(normalize_markdown(DEFAULT_AGENT_TEMPLATE))
}

fn ensure_user_default_agent_file(app: &AppHandle) -> CommandResult<(PathBuf, bool)> {
    let user_root = ensure_user_config_root(app)?;
    let file_path = user_root.join(DEFAULT_AGENT_FILE_NAME);
    if file_path.exists() {
        return Ok((file_path, false));
    }

    let markdown = read_builtin_default_agent_markdown(app)?;
    fs::write(&file_path, markdown).map_err(error_to_string)?;
    Ok((file_path, true))
}

fn build_document(path: PathBuf, markdown: String, initialized_from_builtin: bool) -> DefaultAgentConfigDocument {
    DefaultAgentConfigDocument {
        initialized_from_builtin,
        markdown,
        path: normalize_path(&path),
    }
}

#[tauri::command]
pub fn initialize_default_agent_config(app: AppHandle) -> CommandResult<DefaultAgentConfigDocument> {
    let (file_path, initialized_from_builtin) = ensure_user_default_agent_file(&app)?;
    let markdown = fs::read_to_string(&file_path)
        .map(|content| normalize_markdown(&content))
        .map_err(error_to_string)?;
    Ok(build_document(file_path, markdown, initialized_from_builtin))
}

#[tauri::command]
pub fn read_default_agent_config(app: AppHandle) -> CommandResult<DefaultAgentConfigDocument> {
    let (file_path, _initialized) = ensure_user_default_agent_file(&app)?;
    let markdown = fs::read_to_string(&file_path)
        .map(|content| normalize_markdown(&content))
        .map_err(error_to_string)?;
    Ok(build_document(file_path, markdown, false))
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_default_agent_config(app: AppHandle, content: String) -> CommandResult<DefaultAgentConfigDocument> {
    let (file_path, _initialized) = ensure_user_default_agent_file(&app)?;
    let markdown = normalize_markdown(&content);
    fs::write(&file_path, &markdown).map_err(error_to_string)?;
    Ok(build_document(file_path, markdown, false))
}

#[tauri::command]
pub fn reset_default_agent_config(app: AppHandle) -> CommandResult<DefaultAgentConfigDocument> {
    let (file_path, _initialized) = ensure_user_default_agent_file(&app)?;
    let markdown = read_builtin_default_agent_markdown(&app)?;
    fs::write(&file_path, &markdown).map_err(error_to_string)?;
    Ok(build_document(file_path, markdown, false))
}
