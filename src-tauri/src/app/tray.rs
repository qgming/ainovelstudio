use super::{hide_main_window, show_main_window};
use std::sync::{Mutex, OnceLock};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const TRAY_ID: &str = "ainovelstudio_tray";
const TRAY_AI_STATUS_ID: &str = "ai_status";
const TRAY_LIGHT_MODE_ID: &str = "light_mode";
const TRAY_SHOW_ID: &str = "show_main_window";
const TRAY_QUIT_ID: &str = "quit_application";

static TRAY_AI_STATUS: OnceLock<Mutex<String>> = OnceLock::new();

fn tray_ai_status() -> &'static Mutex<String> {
    TRAY_AI_STATUS.get_or_init(|| Mutex::new("空闲".into()))
}

fn read_tray_ai_status() -> String {
    tray_ai_status()
        .lock()
        .map(|status| status.clone())
        .unwrap_or_else(|_| "状态不可用".into())
}

fn write_tray_ai_status(status: &str) -> Result<(), String> {
    let mut current = tray_ai_status()
        .lock()
        .map_err(|_| "托盘 AI 状态访问失败。".to_string())?;
    *current = status.trim().chars().take(40).collect();
    if current.is_empty() {
        *current = "空闲".into();
    }
    Ok(())
}

fn create_tray_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let status_text = format!("AI 状态：{}", read_tray_ai_status());
    let status = MenuItem::with_id(app, TRAY_AI_STATUS_ID, status_text, false, None::<&str>)?;
    let show = MenuItem::with_id(app, TRAY_SHOW_ID, "显示主窗口", true, None::<&str>)?;
    let light = MenuItem::with_id(app, TRAY_LIGHT_MODE_ID, "进入轻量模式", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, TRAY_QUIT_ID, "退出", true, None::<&str>)?;
    let separator_a = PredefinedMenuItem::separator(app)?;
    let separator_b = PredefinedMenuItem::separator(app)?;
    Menu::with_items(
        app,
        &[&status, &separator_a, &show, &light, &separator_b, &quit],
    )
}

fn refresh_tray_menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_tooltip(Some(format!(
        "神笔写作 · AI 状态：{}",
        read_tray_ai_status()
    )))?;
    tray.set_menu(Some(create_tray_menu(app)?))
}

pub(crate) fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let menu = create_tray_menu(app)?;
    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(format!("神笔写作 · AI 状态：{}", read_tray_ai_status()))
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }
    tray_builder.build(app)?;
    Ok(())
}

pub(crate) fn handle_tray_menu_event(app: &tauri::AppHandle, item_id: &str) {
    match item_id {
        TRAY_SHOW_ID => show_main_window(app),
        TRAY_LIGHT_MODE_ID => {
            let _ = hide_main_window(app.clone());
        }
        TRAY_QUIT_ID => app.exit(0),
        _ => {}
    }
}

pub(crate) fn handle_tray_icon_event(app: &tauri::AppHandle, event: TrayIconEvent) {
    if matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
    ) {
        show_main_window(app);
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn update_tray_ai_status(app: tauri::AppHandle, statusLabel: String) -> Result<(), String> {
    write_tray_ai_status(&statusLabel)?;
    refresh_tray_menu(&app).map_err(|error| error.to_string())
}
