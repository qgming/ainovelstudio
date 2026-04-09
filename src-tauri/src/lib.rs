mod skills;
mod workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            workspace::pick_book_directory,
            workspace::read_workspace_tree,
            workspace::read_text_file,
            workspace::write_text_file,
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
