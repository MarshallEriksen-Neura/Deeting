use serde::Deserialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Listener, Manager};

const TRAY_LOCALE_EVENT: &str = "desktop-locale-changed";

#[derive(Deserialize)]
struct TrayLocalePayload {
    locale: Option<String>,
}

pub fn desktop_prefers_zh() -> bool {
    std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LC_MESSAGES"))
        .or_else(|_| std::env::var("LANG"))
        .map(|value| value.to_lowercase().starts_with("zh"))
        .unwrap_or(false)
}

pub fn tray_labels_for_locale(locale: &str) -> (&'static str, &'static str) {
    if locale.to_lowercase().starts_with("zh") {
        ("显示主窗口", "退出 Deeting")
    } else {
        ("Show Window", "Quit Deeting")
    }
}

pub fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let default_locale = if desktop_prefers_zh() { "zh-CN" } else { "en" };
    let (show_label, quit_label) = tray_labels_for_locale(default_locale);
    let show_i = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

    let show_i_for_locale = show_i.clone();
    let quit_i_for_locale = quit_i.clone();
    let fallback_locale = default_locale.to_string();

    app.listen(TRAY_LOCALE_EVENT, move |event| {
        let locale = serde_json::from_str::<TrayLocalePayload>(event.payload())
            .ok()
            .and_then(|payload| payload.locale)
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| fallback_locale.clone());
        let (show_text, quit_text) = tray_labels_for_locale(&locale);
        let _ = show_i_for_locale.set_text(show_text);
        let _ = quit_i_for_locale.set_text(quit_text);
    });

    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Deeting")
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "quit" => {
                app.exit(0);
            }
            "show" => {
                show_main_window(app);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
