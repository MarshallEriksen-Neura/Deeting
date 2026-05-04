use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::modules::mcp::error::McpError;
use crate::modules::mcp::store::McpStore;

pub(crate) const SELECTION_ASSISTANT_SHORTCUT_CONFIG_KEY: &str =
    "selection_assistant.wake_shortcut";
pub(crate) const DEFAULT_SELECTION_ASSISTANT_SHORTCUT: &str = "CommandOrControl+Shift+Space";

pub(crate) fn normalize_selection_assistant_shortcut(raw: &str) -> Result<String, String> {
    let shortcut = raw.trim();
    if shortcut.is_empty() {
        return Err("selection assistant shortcut is required".to_string());
    }
    if shortcut.chars().any(|ch| ch.is_control()) {
        return Err("selection assistant shortcut contains invalid characters".to_string());
    }
    Ok(shortcut.to_string())
}

pub(crate) async fn resolve_selection_assistant_shortcut(
    store: &McpStore,
) -> Result<String, McpError> {
    let configured = store
        .get_desktop_config(SELECTION_ASSISTANT_SHORTCUT_CONFIG_KEY)
        .await?;

    Ok(configured
        .as_deref()
        .and_then(|value| normalize_selection_assistant_shortcut(value).ok())
        .unwrap_or_else(|| DEFAULT_SELECTION_ASSISTANT_SHORTCUT.to_string()))
}

pub(crate) fn unregister_selection_assistant_shortcut(app: &AppHandle, shortcut: &str) {
    let manager = app.global_shortcut();
    if manager.is_registered(shortcut) {
        let _ = manager.unregister(shortcut);
    }
}

pub(crate) fn register_selection_assistant_shortcut(
    app: &AppHandle,
    shortcut: &str,
) -> Result<(), String> {
    let shortcut = normalize_selection_assistant_shortcut(shortcut)?;
    let manager = app.global_shortcut();
    manager
        .on_shortcut(shortcut.as_str(), |app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let capture = tauri::async_runtime::spawn_blocking(
                        crate::modules::selection_assistant::capture::capture_active_selection,
                    )
                    .await
                    .unwrap_or_else(|err| {
                        log::warn!("selection assistant capture task failed: {err}");
                        crate::modules::selection_assistant::capture::unavailable_capture_result(
                            format!("capture task failed: {err}"),
                        )
                    });

                    if let Some(island) = app_handle.get_webview_window("island") {
                        let _ = island.show();
                        let _ = island.set_focus();
                    }
                    let _ = app_handle.emit("island:selection-captured", capture);
                });
            }
        })
        .map_err(|err| err.to_string())
}

pub(crate) fn replace_selection_assistant_shortcut(
    app: &AppHandle,
    previous_shortcut: &str,
    next_shortcut: &str,
) -> Result<(), String> {
    let previous_shortcut = normalize_selection_assistant_shortcut(previous_shortcut)?;
    let next_shortcut = normalize_selection_assistant_shortcut(next_shortcut)?;
    let manager = app.global_shortcut();

    if !previous_shortcut.eq_ignore_ascii_case(&next_shortcut)
        && manager.is_registered(next_shortcut.as_str())
    {
        return Err(format!("shortcut is already registered: {next_shortcut}"));
    }

    unregister_selection_assistant_shortcut(app, previous_shortcut.as_str());

    if let Err(err) = register_selection_assistant_shortcut(app, next_shortcut.as_str()) {
        if !previous_shortcut.eq_ignore_ascii_case(&next_shortcut) {
            let _ = register_selection_assistant_shortcut(app, previous_shortcut.as_str());
        }
        return Err(err);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_selection_assistant_shortcut, DEFAULT_SELECTION_ASSISTANT_SHORTCUT,
        SELECTION_ASSISTANT_SHORTCUT_CONFIG_KEY,
    };

    #[test]
    fn normalize_selection_assistant_shortcut_trims_valid_shortcuts() {
        assert_eq!(
            normalize_selection_assistant_shortcut("  Alt+Space  ").unwrap(),
            "Alt+Space"
        );
        assert_eq!(
            DEFAULT_SELECTION_ASSISTANT_SHORTCUT,
            "CommandOrControl+Shift+Space"
        );
        assert_eq!(
            SELECTION_ASSISTANT_SHORTCUT_CONFIG_KEY,
            "selection_assistant.wake_shortcut"
        );
    }

    #[test]
    fn normalize_selection_assistant_shortcut_rejects_empty_values() {
        assert!(normalize_selection_assistant_shortcut(" ").is_err());
    }
}
