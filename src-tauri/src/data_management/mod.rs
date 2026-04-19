mod archive;
mod webdav;

use crate::db::open_database;
use archive::{
    build_backup_bundle, inspect_backup_archive, restore_backup_archive, BackupRestoreResult,
    ClientStateSnapshot,
};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

pub type CommandResult<T> = Result<T, String>;

const DATA_SYNC_SETTINGS_KEY: &str = "data.sync.settings";

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSyncSettingsDocument {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_remote_path")]
    pub remote_path: String,
    #[serde(default)]
    pub server_url: String,
    #[serde(default)]
    pub username: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSyncResult {
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_state: Option<ClientStateSnapshot>,
    pub local_updated_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_updated_at: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataSyncProbeResult {
    pub ok: bool,
    pub message: String,
}

fn error_to_string(error: impl ToString) -> String {
    error.to_string()
}

fn default_remote_path() -> String {
    "ainovelstudio".into()
}

fn normalize_settings(settings: DataSyncSettingsDocument) -> DataSyncSettingsDocument {
    let server_url = settings.server_url.trim().to_string();
    DataSyncSettingsDocument {
        enabled: !server_url.is_empty(),
        password: settings.password,
        remote_path: if settings.remote_path.trim().is_empty() {
            default_remote_path()
        } else {
            settings.remote_path.trim().to_string()
        },
        server_url,
        username: settings.username.trim().to_string(),
    }
}

fn get_state_value(connection: &rusqlite::Connection, key: &str) -> CommandResult<Option<Value>> {
    let raw = connection
        .query_row(
            "SELECT value_json FROM app_state WHERE key = ?1",
            params![key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(error_to_string)?;
    Ok(raw.and_then(|value| serde_json::from_str::<Value>(&value).ok()))
}

fn set_state_value(connection: &rusqlite::Connection, key: &str, value: &Value) -> CommandResult<()> {
    connection
        .execute(
            r#"
            INSERT INTO app_state (key, value_json, updated_at)
            VALUES (?1, ?2, strftime('%s', 'now'))
            ON CONFLICT(key) DO UPDATE
            SET value_json = excluded.value_json,
                updated_at = excluded.updated_at
            "#,
            params![key, value.to_string()],
        )
        .map_err(error_to_string)?;
    Ok(())
}

fn load_data_sync_settings(app: &AppHandle) -> CommandResult<DataSyncSettingsDocument> {
    let connection = open_database(app)?;
    let stored = get_state_value(&connection, DATA_SYNC_SETTINGS_KEY)?
        .and_then(|value| serde_json::from_value::<DataSyncSettingsDocument>(value).ok())
        .unwrap_or_default();
    Ok(normalize_settings(stored))
}

#[tauri::command]
pub fn read_data_sync_settings(app: AppHandle) -> CommandResult<DataSyncSettingsDocument> {
    load_data_sync_settings(&app)
}

#[tauri::command]
pub fn write_data_sync_settings(
    app: AppHandle,
    settings: DataSyncSettingsDocument,
) -> CommandResult<DataSyncSettingsDocument> {
    let normalized = normalize_settings(settings);
    let connection = open_database(&app)?;
    let value = serde_json::to_value(&normalized).map_err(error_to_string)?;
    set_state_value(&connection, DATA_SYNC_SETTINGS_KEY, &value)?;
    Ok(normalized)
}

#[tauri::command]
pub async fn test_data_sync_connection(
    settings: DataSyncSettingsDocument,
) -> CommandResult<DataSyncProbeResult> {
    let normalized = normalize_settings(settings);
    if normalized.server_url.trim().is_empty() {
        return Err("请先填写 WebDAV 地址。".into());
    }

    let result = webdav::probe_connection(&normalized).await?;
    Ok(DataSyncProbeResult {
        ok: result.ok,
        message: result.message,
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn export_app_data_backup(
    app: AppHandle,
    clientState: ClientStateSnapshot,
) -> CommandResult<Option<String>> {
    let bundle = build_backup_bundle(&app, clientState)?;

    #[cfg(desktop)]
    {
        let save_path = app
            .dialog()
            .file()
            .set_file_name("ainovelstudio-backup.zip")
            .add_filter("ZIP 压缩包", &["zip"])
            .blocking_save_file()
            .and_then(|path| path.into_path().ok());
        let Some(save_path) = save_path else {
            return Ok(None);
        };
        let final_path = match save_path.extension().and_then(|extension| extension.to_str()) {
            Some(extension) if extension.eq_ignore_ascii_case("zip") => save_path,
            _ => save_path.with_extension("zip"),
        };
        std::fs::write(&final_path, bundle.bytes).map_err(error_to_string)?;
        return Ok(Some(final_path.to_string_lossy().replace('\\', "/")));
    }

    #[cfg(mobile)]
    {
        let _ = bundle;
        Err("当前平台暂不支持导出本地备份。".into())
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn import_app_data_backup(
    app: AppHandle,
    fileName: String,
    archiveBytes: Vec<u8>,
) -> CommandResult<BackupRestoreResult> {
    if archiveBytes.is_empty() {
        return Err("备份文件为空。".into());
    }
    if !fileName.to_lowercase().ends_with(".zip") {
        return Err("仅支持导入 .zip 备份包。".into());
    }
    restore_backup_archive(&app, &archiveBytes)
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn sync_app_data_via_webdav(
    app: AppHandle,
    clientState: ClientStateSnapshot,
) -> CommandResult<DataSyncResult> {
    let settings = load_data_sync_settings(&app)?;
    if settings.server_url.trim().is_empty() {
        return Err("请先填写 WebDAV 地址。".into());
    }

    let local_bundle = build_backup_bundle(&app, clientState)?;
    let local_updated_at = local_bundle.manifest.composite_updated_at;
    let remote_archive = webdav::fetch_remote_archive(&settings).await?;

    let Some(remote_bytes) = remote_archive else {
        webdav::upload_remote_archive(&settings, &local_bundle.bytes).await?;
        return Ok(DataSyncResult {
            action: "uploaded".into(),
            client_state: None,
            local_updated_at,
            remote_updated_at: None,
        });
    };

    let remote_preview = inspect_backup_archive(&remote_bytes)?;
    let remote_updated_at = remote_preview.manifest.composite_updated_at;

    if remote_updated_at > local_updated_at {
        let restored = restore_backup_archive(&app, &remote_bytes)?;
        return Ok(DataSyncResult {
            action: "downloaded".into(),
            client_state: Some(restored.client_state),
            local_updated_at,
            remote_updated_at: Some(remote_updated_at),
        });
    }

    if local_updated_at > remote_updated_at {
        webdav::upload_remote_archive(&settings, &local_bundle.bytes).await?;
        return Ok(DataSyncResult {
            action: "uploaded".into(),
            client_state: None,
            local_updated_at,
            remote_updated_at: Some(remote_updated_at),
        });
    }

    Ok(DataSyncResult {
        action: "noop".into(),
        client_state: Some(remote_preview.client_state),
        local_updated_at,
        remote_updated_at: Some(remote_updated_at),
    })
}
