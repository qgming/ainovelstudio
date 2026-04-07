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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
