use tauri::AppHandle;

#[tauri::command]
pub fn terminate_application(app: AppHandle) {
    app.exit(0);
}
