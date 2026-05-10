use tauri::AppHandle;
#[cfg(desktop)]
use tauri::Manager;

#[tauri::command]
pub fn terminate_application(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
#[cfg(desktop)]
pub fn hide_main_window(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window.hide().map_err(|error| error.to_string())
}

#[tauri::command]
#[cfg(mobile)]
pub fn hide_main_window(_app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
#[cfg(not(desktop))]
#[allow(non_snake_case)]
pub fn update_tray_ai_status(_app: AppHandle, _statusLabel: String) -> Result<(), String> {
    Ok(())
}

#[cfg(desktop)]
pub fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}
