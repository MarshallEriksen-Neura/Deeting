pub mod commands;
pub mod modules;
pub mod setup;
pub mod state;
pub mod tray;
pub mod utils;

use tauri::{Emitter, Manager};

fn should_register_runtime_deep_links(
    is_linux: bool,
    is_windows: bool,
    is_debug: bool,
) -> bool {
    is_linux || (is_windows && is_debug)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_single_instance::Builder::new()
                .callback(|app, _argv, _cwd| {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(any(target_os = "linux", windows))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                if should_register_runtime_deep_links(
                    cfg!(target_os = "linux"),
                    cfg!(windows),
                    cfg!(debug_assertions),
                ) {
                    app.deep_link().register_all()?;
                }
            }

            setup::setup_app(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent default close; let frontend decide (minimize to tray or quit)
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .invoke_handler(commands::generate_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::should_register_runtime_deep_links;

    #[test]
    fn runtime_registration_is_enabled_for_linux() {
        assert!(should_register_runtime_deep_links(true, false, false));
    }

    #[test]
    fn runtime_registration_is_enabled_for_windows_debug() {
        assert!(should_register_runtime_deep_links(false, true, true));
    }

    #[test]
    fn runtime_registration_is_disabled_for_windows_release() {
        assert!(!should_register_runtime_deep_links(false, true, false));
    }
}
