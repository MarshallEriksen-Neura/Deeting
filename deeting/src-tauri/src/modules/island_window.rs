//! Island 独立窗口管理
//!
//! 提供 Island 窗口的创建、显示/隐藏切换、尺寸与位置控制。

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

/// 在应用启动时预创建 Island 窗口（隐藏状态）。
pub fn create_island_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    WebviewWindowBuilder::new(app, "island", WebviewUrl::App("island".into()))
        .title("Deeting Island")
        .inner_size(380.0, 88.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .visible(false)
        .resizable(false)
        .skip_taskbar(true)
        .build()?;
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
