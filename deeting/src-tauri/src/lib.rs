pub mod modules;
pub mod state;

use crate::modules::code_mode::CodeModeState;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::process::ProcessManager;
use crate::modules::mcp::store::{expand_path, McpStore};
use crate::modules::mcp::types::McpSourceStatus;
use crate::modules::mcp::McpRuntimeState;
use crate::modules::memory::MemoryState;
use crate::modules::providers::ProviderState;
use crate::modules::sandbox::SandboxState;
use crate::state::AppState;
use log::warn;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use tauri::Emitter;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::ShortcutState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = shortcut; // suppress unused warning
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let handle = app.handle().clone();
            let cloud_base_url = resolve_cloud_base_url();
            let lancedb_uri = resolve_lancedb_uri(app)?;
            let boxlite_home_dir = resolve_boxlite_home_dir(app)?;
            let state = tauri::async_runtime::block_on(async {
                let database_url = resolve_database_url(app)?;

                // MCP 初始化
                let store: Arc<McpStore> = Arc::new(McpStore::new(&database_url).await?);
                store.init().await?;
                store.ensure_local_source().await?;
                store.ensure_cloud_source(&cloud_base_url).await?;
                let process_manager = ProcessManager::new(store.clone(), handle);
                let mcp_state = McpRuntimeState::new(store, process_manager, cloud_base_url);

                // Providers 初始化
                let provider_state = ProviderState::new(&database_url)
                    .await
                    .map_err(|e| McpError::Storage(e.to_string()))?;
                let memory_state = MemoryState::new(&lancedb_uri)
                    .await
                    .map_err(|e| McpError::Storage(e.to_string()))?;
                let sandbox_state = SandboxState::new(boxlite_home_dir.clone());
                let code_mode_state = CodeModeState::new(&database_url)
                    .await
                    .map_err(|e| McpError::Storage(e.to_string()))?;

                Ok::<_, McpError>(AppState::new(
                    mcp_state,
                    provider_state,
                    memory_state,
                    sandbox_state,
                    code_mode_state,
                ))
            })
            .map_err(|err| Box::<dyn std::error::Error>::from(err))?;

            let sync_state = state.clone();
            app.manage(state);
            let sync_state_for_mcp = sync_state.clone();

            tauri::async_runtime::spawn(async move {
                let mcp = &sync_state_for_mcp.mcp;
                let source = match mcp.store.ensure_local_source().await {
                    Ok(source) => source,
                    Err(err) => {
                        warn!("mcp auto sync skipped: {}", err);
                        return;
                    }
                };
                let _ = mcp
                    .store
                    .update_source_status(&source.id, McpSourceStatus::Syncing, None)
                    .await;
                match crate::modules::mcp::commands::sync_source_inner(mcp, source.clone(), None)
                    .await
                {
                    Ok(tools) => {
                        let _ = mcp
                            .store
                            .update_source_status(
                                &source.id,
                                McpSourceStatus::Active,
                                Some(now_rfc3339()),
                            )
                            .await;

                        // Index tools for semantic search
                        let app_state_clone = sync_state_for_mcp.clone();
                        let tools_clone = tools.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = crate::modules::mcp::commands::index_mcp_tools(
                                &app_state_clone,
                                &tools_clone,
                            )
                            .await;
                        });
                    }
                    Err(err) => {
                        let _ = mcp
                            .store
                            .update_source_status(&source.id, McpSourceStatus::Error, None)
                            .await;
                        warn!("mcp auto sync failed: {}", err);
                    }
                }

                // Index existing assistants for semantic search
                if let Ok(assistants) = sync_state_for_mcp.mcp.store.list_local_assistants().await {
                    let app_state_clone = sync_state_for_mcp.clone();
                    tauri::async_runtime::spawn(async move {
                        crate::modules::mcp::commands::index_local_assistants(
                            &app_state_clone,
                            &assistants,
                        )
                        .await;
                    });
                }

                // Register and index all local skills (Official & User)
                let app_state_for_skills = sync_state_for_mcp.clone();
                let app_handle_for_skills = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::modules::mcp::commands::register_local_skills(
                        app_handle_for_skills,
                        tauri::State::from(&app_state_for_skills),
                    )
                    .await;
                });

                });

                let app_state_for_knowledge_index = sync_state_for_mcp.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(err) =
                        crate::modules::mcp::commands::rebuild_local_knowledge_vector_index(
                            &app_state_for_knowledge_index,
                        )
                        .await
                    {
                        warn!("local knowledge vector index bootstrap failed: {}", err);
                    }
                });
            });
            let sandbox_state = sync_state.sandbox.clone();
            tauri::async_runtime::spawn(async move {
                sandbox_state.manager.start_background_worker().await;
            });
            let summary_worker_state = sync_state.clone();
            tauri::async_runtime::spawn(async move {
                crate::modules::mcp::commands::start_local_conversation_summary_worker(
                    summary_worker_state,
                )
                .await;
            });
            let periodic_worker_state = sync_state.clone();
            tauri::async_runtime::spawn(async move {
                crate::modules::mcp::commands::start_local_periodic_worker(periodic_worker_state)
                    .await;
            });

            // ── System Tray ──────────────────────────────────────────
            let show_i = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Deeting", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .menu_on_left_click(false)
                .tooltip("Deeting")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── Global Shortcut: Cmd/Ctrl+Shift+D ────────────────────
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            app.global_shortcut().on_shortcut("CommandOrControl+Shift+D", |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            })?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Prevent default close; let frontend decide (minimize to tray or quit)
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            // MCP Commands
            crate::modules::mcp::commands::set_cloud_base_url,
            crate::modules::mcp::commands::list_mcp_sources,
            crate::modules::mcp::commands::create_mcp_source,
            crate::modules::mcp::commands::sync_mcp_source,
            crate::modules::mcp::commands::list_mcp_tools,
            crate::modules::mcp::commands::list_local_assistants,
            crate::modules::mcp::commands::list_local_assistant_entities,
            crate::modules::mcp::commands::list_local_assistant_versions,
            crate::modules::mcp::commands::list_local_assistant_tags,
            crate::modules::mcp::commands::list_local_assistant_installs,
            crate::modules::mcp::commands::install_local_assistant,
            crate::modules::mcp::commands::update_local_assistant_install,
            crate::modules::mcp::commands::uninstall_local_assistant,
            crate::modules::mcp::commands::rate_local_assistant,
            crate::modules::mcp::commands::record_local_assistant_routing_trial,
            crate::modules::mcp::commands::record_local_assistant_routing_feedback,
            crate::modules::mcp::commands::get_local_assistant_routing_report,
            crate::modules::mcp::commands::create_local_trace_feedback,
            crate::modules::mcp::commands::list_local_gateway_logs,
            crate::modules::mcp::commands::get_local_gateway_log_stats,
            crate::modules::mcp::commands::get_local_knowledge_tree,
            crate::modules::mcp::commands::get_local_knowledge_stats,
            crate::modules::mcp::commands::create_local_knowledge_folder,
            crate::modules::mcp::commands::update_local_knowledge_folder,
            crate::modules::mcp::commands::delete_local_knowledge_folder,
            crate::modules::mcp::commands::list_local_user_documents,
            crate::modules::mcp::commands::create_local_user_document,
            crate::modules::mcp::commands::get_local_user_document,
            crate::modules::mcp::commands::update_local_user_document,
            crate::modules::mcp::commands::delete_local_user_document,
            crate::modules::mcp::commands::retry_local_user_document,
            crate::modules::mcp::commands::list_local_user_document_chunks,
            crate::modules::mcp::commands::list_local_admin_conversations,
            crate::modules::mcp::commands::get_local_admin_conversation,
            crate::modules::mcp::commands::list_local_admin_conversation_messages,
            crate::modules::mcp::commands::list_local_admin_conversation_summaries,
            crate::modules::mcp::commands::list_local_conversation_summary_jobs,
            crate::modules::mcp::commands::list_local_conversation_summary_idle_tasks,
            crate::modules::mcp::commands::get_local_conversation_summary_queue_stats,
            crate::modules::mcp::commands::trigger_local_conversation_summary_job,
            crate::modules::mcp::commands::retry_local_conversation_summary_job,
            crate::modules::mcp::commands::retry_local_conversation_summary_jobs,
            crate::modules::mcp::commands::create_local_assistant,
            crate::modules::mcp::commands::update_local_assistant,
            crate::modules::mcp::commands::delete_local_assistant,
            crate::modules::mcp::commands::list_assistant_messages,
            crate::modules::mcp::commands::append_assistant_message,
            crate::modules::mcp::commands::preview_local_assistant,
            crate::modules::mcp::commands::delete_assistant_messages,
            crate::modules::mcp::commands::list_local_conversations,
            crate::modules::mcp::commands::create_local_conversation,
            crate::modules::mcp::commands::archive_local_conversation,
            crate::modules::mcp::commands::close_local_conversation,
            crate::modules::mcp::commands::unarchive_local_conversation,
            crate::modules::mcp::commands::rename_local_conversation,
            crate::modules::mcp::commands::list_local_conversation_history,
            crate::modules::mcp::commands::get_local_conversation_window,
            crate::modules::mcp::commands::append_local_conversation_message,
            crate::modules::mcp::commands::delete_local_conversation_message,
            crate::modules::mcp::commands::clear_local_conversation,
            crate::modules::mcp::commands::send_local_conversation_message,
            crate::modules::mcp::commands::regenerate_local_conversation_reply,
            crate::modules::mcp::commands::import_mcp_config,
            crate::modules::mcp::commands::start_mcp_tool,
            crate::modules::mcp::commands::stop_mcp_tool,
            crate::modules::mcp::commands::update_mcp_tool_env,
            crate::modules::mcp::commands::apply_pending_config,
            crate::modules::mcp::commands::resolve_mcp_conflict,
            crate::modules::mcp::commands::get_mcp_logs,
            crate::modules::mcp::commands::clear_mcp_logs,
            crate::modules::mcp::commands::sync_cloud_subscriptions,
            crate::modules::mcp::commands::register_local_skills,
            crate::modules::mcp::commands::sync_official_skills_index,
            crate::modules::mcp::bridge::set_mcp_backend_url,
            crate::modules::mcp::bridge::start_mcp_log_stream,
            crate::modules::mcp::bridge::stop_mcp_log_stream,
            // Provider Commands
            crate::modules::providers::commands::list_local_provider_presets,
            crate::modules::providers::commands::get_local_user_secretary,
            crate::modules::providers::commands::update_local_user_secretary,
            crate::modules::providers::commands::get_local_user_embedding_config,
            crate::modules::providers::commands::update_local_user_embedding_config,
            crate::modules::providers::commands::replace_local_provider_presets,
            crate::modules::providers::commands::list_local_provider_instances,
            crate::modules::providers::commands::create_local_provider_instance,
            crate::modules::providers::commands::update_local_provider_instance,
            crate::modules::providers::commands::delete_local_provider_instance,
            crate::modules::providers::commands::list_local_provider_models,
            crate::modules::providers::commands::sync_local_provider_models,
            crate::modules::providers::commands::quick_add_local_provider_models,
            crate::modules::providers::commands::update_local_provider_model,
            crate::modules::providers::commands::test_local_provider_model,
            crate::modules::providers::commands::get_local_bandit_arm_state,
            crate::modules::providers::commands::list_local_bandit_arm_states,
            crate::modules::providers::commands::record_local_bandit_feedback,
            // Local Memory Commands
            crate::modules::memory::commands::append_local_memory,
            crate::modules::memory::commands::list_local_memories,
            crate::modules::memory::commands::delete_local_memory,
            crate::modules::memory::commands::clear_local_memories,
            // Local Code Mode Commands
            crate::modules::code_mode::commands::get_local_code_mode_bridge_status,
            crate::modules::code_mode::commands::execute_local_code_mode,
            crate::modules::code_mode::commands::list_local_code_mode_executions,
            crate::modules::code_mode::commands::get_local_code_mode_execution,
            crate::modules::code_mode::commands::replay_local_code_mode_execution,
            crate::modules::code_mode::commands::sync_local_code_mode_executions
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn resolve_database_url<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<String, McpError> {
    let db_path = non_empty_env("DESKTOP_DB_PATH").unwrap_or_else(|| default_db_path(app));
    if db_path == ":memory:" {
        return Ok("sqlite::memory:".to_string());
    }
    if db_path.starts_with("sqlite:") {
        return Ok(db_path);
    }
    let expanded = expand_path(&db_path);
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        std::env::current_dir()
            .map_err(|err| McpError::Storage(err.to_string()))?
            .join(expanded)
    };
    if let Some(parent) = absolute.parent() {
        std::fs::create_dir_all(parent).map_err(|err| McpError::Storage(err.to_string()))?;
    }
    Ok(path_to_sqlite_url(&absolute))
}

fn default_db_path<R: tauri::Runtime>(app: &tauri::App<R>) -> String {
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        return app_data_dir
            .join("deeting.db")
            .to_string_lossy()
            .to_string();
    }
    if let Some(home) = non_empty_env("HOME") {
        return format!("{home}/.config/deeting/deeting.db");
    }
    if let Some(user_profile) = non_empty_env("USERPROFILE") {
        return format!("{user_profile}/.config/deeting/deeting.db");
    }
    "deeting.db".to_string()
}

fn resolve_lancedb_uri<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<String, McpError> {
    let path = non_empty_env("DESKTOP_LANCEDB_PATH").unwrap_or_else(|| default_lancedb_path(app));
    let expanded = expand_path(&path);
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        std::env::current_dir()
            .map_err(|err| McpError::Storage(err.to_string()))?
            .join(expanded)
    };
    std::fs::create_dir_all(&absolute).map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(absolute.to_string_lossy().to_string())
}

fn resolve_boxlite_home_dir<R: tauri::Runtime>(app: &tauri::App<R>) -> Result<PathBuf, McpError> {
    if let Some(path) = non_empty_env("BOXLITE_HOME") {
        let expanded = expand_path(&path);
        let absolute = if expanded.is_absolute() {
            expanded
        } else {
            std::env::current_dir()
                .map_err(|err| McpError::Storage(err.to_string()))?
                .join(expanded)
        };
        std::fs::create_dir_all(&absolute).map_err(|err| McpError::Storage(err.to_string()))?;
        return Ok(absolute);
    }

    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let path = app_data_dir.join("boxlite");
        std::fs::create_dir_all(&path).map_err(|err| McpError::Storage(err.to_string()))?;
        return Ok(path);
    }
    if let Some(home) = non_empty_env("HOME") {
        let path = PathBuf::from(format!("{home}/.boxlite"));
        std::fs::create_dir_all(&path).map_err(|err| McpError::Storage(err.to_string()))?;
        return Ok(path);
    }
    if let Some(user_profile) = non_empty_env("USERPROFILE") {
        let path = PathBuf::from(format!("{user_profile}/.boxlite"));
        std::fs::create_dir_all(&path).map_err(|err| McpError::Storage(err.to_string()))?;
        return Ok(path);
    }
    let path = PathBuf::from(".boxlite");
    std::fs::create_dir_all(&path).map_err(|err| McpError::Storage(err.to_string()))?;
    Ok(path)
}

fn default_lancedb_path<R: tauri::Runtime>(app: &tauri::App<R>) -> String {
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        return app_data_dir
            .join("memory_lancedb")
            .to_string_lossy()
            .to_string();
    }
    if let Some(home) = non_empty_env("HOME") {
        return format!("{home}/.config/deeting/memory_lancedb");
    }
    if let Some(user_profile) = non_empty_env("USERPROFILE") {
        return format!("{user_profile}/.config/deeting/memory_lancedb");
    }
    "memory_lancedb".to_string()
}

fn non_empty_env(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn path_to_sqlite_url(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    format!("sqlite:{normalized}")
}

fn resolve_cloud_base_url() -> String {
    std::env::var("NEXT_PUBLIC_API_BASE_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8000".to_string())
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "".to_string())
}

#[cfg(test)]
mod tests {
    use super::path_to_sqlite_url;
    use std::path::PathBuf;

    #[test]
    fn sqlite_url_for_relative_path_keeps_filename() {
        let path = PathBuf::from("deeting.db");
        let url = path_to_sqlite_url(&path);
        assert_eq!(url, "sqlite:deeting.db");
    }

    #[test]
    fn sqlite_url_for_absolute_path_matches_sqlx_format() {
        let path = if cfg!(windows) {
            PathBuf::from(r"C:\Users\timeline\.config\deeting\deeting.db")
        } else {
            PathBuf::from("/home/timeline/.config/deeting/deeting.db")
        };
        let url = path_to_sqlite_url(&path);
        if cfg!(windows) {
            assert_eq!(url, "sqlite:C:/Users/timeline/.config/deeting/deeting.db");
        } else {
            assert_eq!(url, "sqlite:/home/timeline/.config/deeting/deeting.db");
        }
    }
}
