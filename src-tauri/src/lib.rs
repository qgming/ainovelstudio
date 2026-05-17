mod app;
mod domains;
mod infrastructure;

#[cfg(desktop)]
use crate::app::{handle_tray_icon_event, handle_tray_menu_event, setup_tray};
use crate::app::{
    hide_main_window, terminate_application, update_tray_ai_status, ToolCancellationRegistry,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(ToolCancellationRegistry::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let builder = builder
        .setup(|app| {
            crate::infrastructure::db::open_database(app.handle())
                .map_err(|error| std::io::Error::new(std::io::ErrorKind::Other, error))?;
            setup_tray(app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| handle_tray_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(handle_tray_icon_event);

    builder
        .invoke_handler(tauri::generate_handler![
            domains::book_workspace::commands::cancel_tool_request,
            domains::book_workspace::commands::cancel_tool_requests,
            update_tray_ai_status,
            terminate_application,
            hide_main_window,
            domains::chat::commands::initialize_chat_storage,
            domains::chat::commands::create_chat_session,
            domains::chat::commands::switch_chat_session,
            domains::chat::commands::delete_chat_session,
            domains::chat::commands::rename_chat_session,
            domains::chat::commands::set_chat_draft,
            domains::chat::commands::load_chat_entries,
            domains::chat::commands::append_chat_entry,
            domains::chat::commands::update_chat_entry,
            domains::chat::commands::delete_chat_entry,
            domains::chat::commands::append_compaction_entry,
            domains::chat::commands::read_skill_preferences,
            domains::chat::commands::write_skill_preferences,
            domains::chat::commands::clear_skill_preferences,
            domains::chat::commands::read_agent_settings,
            domains::chat::commands::write_agent_settings,
            domains::chat::commands::clear_agent_settings,
            infrastructure::provider_proxy::fetch_provider_models,
            infrastructure::provider_proxy::probe_provider_connection,
            infrastructure::provider_proxy::forward_provider_request,
            infrastructure::provider_proxy::stream_provider_request,
            infrastructure::provider_proxy::cancel_provider_stream,
            infrastructure::update_manifest::fetch_update_manifest,
            domains::chat::default_agent_config::initialize_default_agent_config,
            domains::chat::default_agent_config::read_default_agent_config,
            domains::chat::default_agent_config::reset_default_agent_config,
            domains::chat::default_agent_config::write_default_agent_config,
            domains::data_sync::read_data_sync_settings,
            domains::data_sync::write_data_sync_settings,
            domains::data_sync::test_data_sync_connection,
            domains::data_sync::export_app_data_backup,
            domains::data_sync::import_app_data_backup,
            domains::data_sync::upload_app_data_backup_via_webdav,
            domains::data_sync::download_app_data_backup_via_webdav,
            domains::usage::commands::read_usage_logs,
            domains::usage::commands::read_usage_summary,
            domains::usage::commands::read_usage_daily_stats,
            domains::debug::commands::read_ai_call_logs,
            domains::debug::commands::clear_ai_call_logs,
            domains::book_workspace::commands::pick_book_directory,
            domains::book_workspace::commands::open_book_folder,
            domains::book_workspace::commands::sync_book_folder_to_workspace,
            domains::book_workspace::commands::sync_changed_book_folder_to_workspace,
            domains::book_workspace::commands::list_book_workspaces,
            domains::book_workspace::commands::get_book_workspace_summary,
            domains::book_workspace::commands::get_book_workspace_summary_by_id,
            domains::book_workspace::commands::import_book_zip,
            domains::book_workspace::commands::export_book_zip,
            domains::book_workspace::commands::delete_book_workspace,
            domains::book_workspace::commands::ensure_book_workspace_template,
            domains::book_workspace::commands::read_workspace_tree,
            domains::book_workspace::commands::read_text_file,
            domains::book_workspace::commands::write_text_file,
            domains::book_workspace::commands::search_workspace_content,
            domains::book_workspace::commands::read_text_file_line,
            domains::book_workspace::commands::replace_text_file_line,
            domains::book_workspace::commands::create_book_workspace,
            domains::book_workspace::commands::create_workspace_directory,
            domains::book_workspace::commands::create_workspace_text_file,
            domains::book_workspace::commands::rename_workspace_entry,
            domains::book_workspace::commands::move_workspace_entry,
            domains::book_workspace::commands::delete_workspace_entry,
            domains::skills::commands::scan_installed_skills,
            domains::skills::commands::initialize_builtin_skills,
            domains::skills::commands::reset_builtin_skills,
            domains::skills::commands::read_skill_detail,
            domains::skills::commands::read_skill_reference_content,
            domains::skills::commands::read_skill_file_content,
            domains::skills::commands::write_skill_file_content,
            domains::skills::commands::create_skill,
            domains::skills::commands::create_skill_reference_file,
            domains::skills::commands::delete_installed_skill,
            domains::skills::commands::import_skill_zip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
