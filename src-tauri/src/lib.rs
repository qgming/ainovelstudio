mod agents;
mod chat;
mod config;
mod db;
mod skills;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            agents::pick_agent_archive,
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
            config::initialize_default_agent_config,
            config::read_default_agent_config,
            config::write_default_agent_config,
            workspace::pick_book_directory,
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
            workspace::delete_workspace_entry,
            skills::pick_skill_archive,
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
