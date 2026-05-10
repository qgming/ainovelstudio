pub(crate) mod app_control;
pub(crate) mod cancellation;
#[cfg(desktop)]
pub(crate) mod tray;

#[cfg(desktop)]
pub(crate) use app_control::show_main_window;
#[cfg(desktop)]
pub(crate) use app_control::{hide_main_window, terminate_application};
#[cfg(not(desktop))]
pub(crate) use app_control::{hide_main_window, terminate_application, update_tray_ai_status};
pub(crate) use cancellation::ToolCancellationRegistry;
#[cfg(desktop)]
pub(crate) use tray::{
    handle_tray_icon_event, handle_tray_menu_event, setup_tray, update_tray_ai_status,
};
