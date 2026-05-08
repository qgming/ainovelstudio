mod app_control;
mod chat;
mod config;
mod data_management;
mod db;
mod embedded_resources;
mod provider_proxy;
mod skills;
mod usage;
mod workspace;

use crate::app_control::terminate_application;
use std::{collections::HashSet, sync::Mutex};

pub struct ToolCancellationRegistry {
    cancelled: Mutex<HashSet<String>>,
}

impl Default for ToolCancellationRegistry {
    fn default() -> Self {
        Self {
            cancelled: Mutex::new(HashSet::new()),
        }
    }
}

impl ToolCancellationRegistry {
    pub fn begin(&self, request_id: Option<&str>) {
        let _ = request_id;
    }

    pub fn cancel(&self, request_id: &str) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.insert(request_id.to_string());
        }
    }

    pub fn clear(&self, request_id: &str) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.remove(request_id);
        }
    }

    pub fn check(&self, request_id: Option<&str>) -> Result<(), String> {
        let Some(request_id) = request_id else {
            return Ok(());
        };

        let cancelled = self
            .cancelled
            .lock()
            .map_err(|_| "取消状态访问失败。".to_string())?;
        if cancelled.contains(request_id) {
            return Err("Tool execution aborted.".into());
        }

        Ok(())
    }

    pub fn finish(&self, request_id: Option<&str>) {
        if let Some(request_id) = request_id {
            self.clear(request_id);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(ToolCancellationRegistry::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .invoke_handler(tauri::generate_handler![
            workspace::book::commands::cancel_tool_request,
            workspace::book::commands::cancel_tool_requests,
            terminate_application,
            chat::initialize_chat_storage,
            chat::create_chat_session,
            chat::switch_chat_session,
            chat::delete_chat_session,
            chat::rename_chat_session,
            chat::set_chat_draft,
            chat::load_chat_entries,
            chat::append_chat_entry,
            chat::update_chat_entry,
            chat::delete_chat_entry,
            chat::append_compaction_entry,
            chat::read_skill_preferences,
            chat::write_skill_preferences,
            chat::clear_skill_preferences,
            chat::read_agent_settings,
            chat::write_agent_settings,
            chat::clear_agent_settings,
            provider_proxy::fetch_provider_models,
            provider_proxy::probe_provider_connection,
            provider_proxy::forward_provider_request,
            config::initialize_default_agent_config,
            config::read_default_agent_config,
            config::write_default_agent_config,
            data_management::read_data_sync_settings,
            data_management::write_data_sync_settings,
            data_management::test_data_sync_connection,
            data_management::export_app_data_backup,
            data_management::import_app_data_backup,
            data_management::upload_app_data_backup_via_webdav,
            data_management::download_app_data_backup_via_webdav,
            usage::read_usage_logs,
            workspace::book::commands::pick_book_directory,
            workspace::book::commands::list_book_workspaces,
            workspace::book::commands::get_book_workspace_summary,
            workspace::book::commands::get_book_workspace_summary_by_id,
            workspace::book::commands::import_book_zip,
            workspace::book::commands::export_book_zip,
            workspace::book::commands::delete_book_workspace,
            workspace::book::commands::read_workspace_tree,
            workspace::book::commands::read_text_file,
            workspace::book::commands::write_text_file,
            workspace::book::commands::search_workspace_content,
            workspace::book::commands::read_text_file_line,
            workspace::book::commands::replace_text_file_line,
            workspace::book::commands::create_book_workspace,
            workspace::book::commands::create_workspace_directory,
            workspace::book::commands::create_workspace_text_file,
            workspace::book::commands::rename_workspace_entry,
            workspace::book::commands::move_workspace_entry,
            workspace::book::commands::delete_workspace_entry,
            skills::scan_installed_skills,
            skills::initialize_builtin_skills,
            skills::reset_builtin_skills,
            skills::read_skill_detail,
            skills::read_skill_reference_content,
            skills::read_skill_file_content,
            skills::write_skill_file_content,
            skills::create_skill,
            skills::create_skill_reference_file,
            skills::delete_installed_skill,
            skills::import_skill_zip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
