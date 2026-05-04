//! Island 独立窗口管理
//!
//! 提供 Island 窗口的创建、显示/隐藏切换、尺寸与位置控制。

use tauri::window::Color;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

pub(crate) const ISLAND_TOGGLE_SHORTCUT_CONFIG_KEY: &str = "island.toggle_shortcut";
pub(crate) const DEFAULT_ISLAND_TOGGLE_SHORTCUT: &str = "CommandOrControl+Shift+I";

pub(crate) fn normalize_island_toggle_shortcut(raw: &str) -> Result<String, String> {
    let shortcut = raw.trim();
    if shortcut.is_empty() {
        return Err("island toggle shortcut is required".to_string());
    }
    if shortcut.chars().any(|ch| ch.is_control()) {
        return Err("island toggle shortcut contains invalid characters".to_string());
    }
    Ok(shortcut.to_string())
}

pub(crate) async fn resolve_island_toggle_shortcut(store: &McpStore) -> Result<String, McpError> {
    let configured = store
        .get_desktop_config(ISLAND_TOGGLE_SHORTCUT_CONFIG_KEY)
        .await?;

    Ok(configured
        .as_deref()
        .and_then(|value| normalize_island_toggle_shortcut(value).ok())
        .unwrap_or_else(|| DEFAULT_ISLAND_TOGGLE_SHORTCUT.to_string()))
}

/// 在应用启动时预创建 Island 窗口（隐藏状态）。
pub fn create_island_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    WebviewWindowBuilder::new(app, "island", WebviewUrl::App("island".into()))
        .title("Deeting Island")
        .inner_size(344.0, 60.0)
        .decorations(false)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .always_on_top(true)
        .visible(false)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .build()?;
    Ok(())
}

pub(crate) fn toggle_island_visibility(app: &AppHandle) -> Result<(), String> {
    if let Some(island) = app.get_webview_window("island") {
        let is_visible = island.is_visible().map_err(|e| e.to_string())?;
        if is_visible {
            island.hide().map_err(|e| e.to_string())?;
        } else {
            island.show().map_err(|e| e.to_string())?;
            island.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn unregister_island_toggle_shortcut(app: &AppHandle, shortcut: &str) {
    let manager = app.global_shortcut();
    if manager.is_registered(shortcut) {
        let _ = manager.unregister(shortcut);
    }
}

pub(crate) fn register_island_toggle_shortcut(
    app: &AppHandle,
    shortcut: &str,
) -> Result<(), String> {
    let shortcut = normalize_island_toggle_shortcut(shortcut)?;
    let manager = app.global_shortcut();
    manager
        .on_shortcut(shortcut.as_str(), |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Err(err) = toggle_island_visibility(app) {
                    log::warn!("island toggle shortcut failed: {err}");
                }
            }
        })
        .map_err(|err| err.to_string())
}

pub(crate) fn replace_island_toggle_shortcut(
    app: &AppHandle,
    previous_shortcut: &str,
    next_shortcut: &str,
) -> Result<(), String> {
    let previous_shortcut = normalize_island_toggle_shortcut(previous_shortcut)?;
    let next_shortcut = normalize_island_toggle_shortcut(next_shortcut)?;
    let manager = app.global_shortcut();

    if !previous_shortcut.eq_ignore_ascii_case(&next_shortcut)
        && manager.is_registered(next_shortcut.as_str())
    {
        return Err(format!("shortcut is already registered: {next_shortcut}"));
    }

    unregister_island_toggle_shortcut(app, previous_shortcut.as_str());

    if let Err(err) = register_island_toggle_shortcut(app, next_shortcut.as_str()) {
        if !previous_shortcut.eq_ignore_ascii_case(&next_shortcut) {
            let _ = register_island_toggle_shortcut(app, previous_shortcut.as_str());
        }
        return Err(err);
    }

    Ok(())
}

/// 隐藏主窗口，显示 Island 窗口。
#[tauri::command]
pub async fn hide_main_show_island(app: AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.hide().map_err(|e| e.to_string())?;
    }
    if let Some(island) = app.get_webview_window("island") {
        island.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 最小化主窗口，并确保 Island 窗口隐藏。
#[tauri::command]
pub async fn minimize_main_hide_island(app: AppHandle) -> Result<(), String> {
    if let Some(island) = app.get_webview_window("island") {
        island.hide().map_err(|e| e.to_string())?;
    }
    if let Some(main) = app.get_webview_window("main") {
        main.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 还原主窗口，隐藏 Island 窗口。
#[tauri::command]
pub async fn show_main_hide_island(app: AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.unminimize().map_err(|e| e.to_string())?;
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    if let Some(island) = app.get_webview_window("island") {
        island.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 设置 Island 窗口尺寸（collapsed ↔ expanded 切换）。
#[tauri::command]
pub async fn set_island_size(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    if let Some(island) = app.get_webview_window("island") {
        island
            .set_size(LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 设置 Island 窗口位置。
#[tauri::command]
pub async fn set_island_position(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    if let Some(island) = app.get_webview_window("island") {
        island
            .set_position(LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_island_toggle_shortcut, DEFAULT_ISLAND_TOGGLE_SHORTCUT,
        ISLAND_TOGGLE_SHORTCUT_CONFIG_KEY,
    };

    #[test]
    fn normalize_island_toggle_shortcut_trims_valid_shortcuts() {
        assert_eq!(
            normalize_island_toggle_shortcut("  CommandOrControl+Shift+I  ").unwrap(),
            "CommandOrControl+Shift+I"
        );
        assert_eq!(DEFAULT_ISLAND_TOGGLE_SHORTCUT, "CommandOrControl+Shift+I");
        assert_eq!(ISLAND_TOGGLE_SHORTCUT_CONFIG_KEY, "island.toggle_shortcut");
    }

    #[test]
    fn normalize_island_toggle_shortcut_rejects_empty_values() {
        assert!(normalize_island_toggle_shortcut("").is_err());
    }
}
