mod agents;
mod app_control;
mod chat;
mod config;
mod db;
mod embedded_resources;
mod provider_proxy;
mod skills;
mod usage;
mod workspace;
mod workspace_db;

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
    tauri::Builder::default()
        .manage(ToolCancellationRegistry::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            workspace::cancel_tool_request,
            workspace::cancel_tool_requests,
            terminate_application,
            agents::scan_installed_agents,
            agents::initialize_builtin_agents,
            agents::read_agent_detail,
            agents::read_agent_file_content,
            agents::write_agent_file_content,
            agents::create_agent,
            agents::delete_installed_agent,
            agents::import_agent_zip,
            chat::initialize_chat_storage,
            chat::create_chat_session,
            chat::switch_chat_session,
            chat::delete_chat_session,
            chat::rename_chat_session,
            chat::set_chat_draft,
            chat::append_chat_message,
            chat::update_chat_message,
            chat::delete_chat_message,
            chat::read_skill_preferences,
            chat::write_skill_preferences,
            chat::clear_skill_preferences,
            chat::read_agent_preferences,
            chat::write_agent_preferences,
            chat::clear_agent_preferences,
            chat::read_agent_settings,
            chat::write_agent_settings,
            chat::clear_agent_settings,
            provider_proxy::fetch_provider_models,
            provider_proxy::probe_provider_connection,
            provider_proxy::forward_provider_request,
            config::initialize_default_agent_config,
            config::read_default_agent_config,
            config::write_default_agent_config,
            usage::read_usage_logs,
            workspace::pick_book_directory,
            workspace::list_book_workspaces,
            workspace::get_book_workspace_summary,
            workspace::get_book_workspace_summary_by_id,
            workspace::import_book_zip,
            workspace::export_book_zip,
            workspace::delete_book_workspace,
            workspace::read_workspace_tree,
            workspace::read_text_file,
            workspace::write_text_file,
            workspace::search_workspace_content,
            workspace::read_text_file_line,
            workspace::replace_text_file_line,
            workspace::create_book_workspace,
            workspace::create_workspace_directory,
            workspace::create_workspace_text_file,
            workspace::rename_workspace_entry,
            workspace::move_workspace_entry,
            workspace::delete_workspace_entry,
            skills::scan_installed_skills,
            skills::initialize_builtin_skills,
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
