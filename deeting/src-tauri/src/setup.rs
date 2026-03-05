use crate::modules::code_mode::CodeModeState;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::process::ProcessManager;
use crate::modules::mcp::types::McpSourceStatus;
use crate::modules::mcp::McpRuntimeState;
use crate::modules::memory::MemoryState;
use crate::modules::monitor::MonitorState;
use crate::modules::providers::ProviderState;
use crate::modules::sandbox::SandboxState;
use crate::state::AppState;
use crate::utils::*;
use log::warn;
use std::sync::Arc;
use tauri::{App, AppHandle, Manager};

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
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
    let boxrun_home_dir = resolve_boxrun_home_dir(app)?;

    let state = tauri::async_runtime::block_on(async {
        let database_url = resolve_database_url(app)?;

        // MCP 初始化
        let store = Arc::new(crate::modules::mcp::store::McpStore::new(&database_url).await?);
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
        let sandbox_state = SandboxState::new(boxrun_home_dir.clone());
        let code_mode_state = CodeModeState::new(&database_url)
            .await
            .map_err(|e| McpError::Storage(e.to_string()))?;
        let monitor_state = MonitorState::new(&database_url, provider_state.store.clone())
            .await
            .map_err(|e| McpError::Storage(e.to_string()))?;

        Ok::<_, McpError>(AppState::new(
            mcp_state,
            provider_state,
            memory_state,
            sandbox_state,
            code_mode_state,
            monitor_state,
        ))
    })
    .map_err(|err| Box::<dyn std::error::Error>::from(err))?;

    let sync_state = state.clone();
    app.manage(state);
    let sync_state_for_mcp = sync_state.clone();
    let app_handle_for_mcp_tasks = app.handle().clone();

    // Spawning background tasks
    spawn_background_tasks(app_handle_for_mcp_tasks, sync_state_for_mcp);

    let sandbox_state = sync_state.sandbox.clone();
    tauri::async_runtime::spawn(async move {
        sandbox_state.manager.start_background_worker().await;
    });

    let summary_worker_state = sync_state.clone();
    tauri::async_runtime::spawn(async move {
        crate::modules::mcp::commands::start_local_conversation_summary_worker(
            summary_worker_state.mcp,
        )
        .await;
    });

    let periodic_worker_state = sync_state.clone();
    tauri::async_runtime::spawn(async move {
        crate::modules::mcp::commands::start_local_periodic_worker(periodic_worker_state.mcp).await;
    });

    // Setup Tray
    crate::tray::setup_tray(app)?;

    // Setup Global Shortcuts
    setup_shortcuts(app)?;

    Ok(())
}

fn spawn_background_tasks(handle: AppHandle, sync_state: AppState) {
    tauri::async_runtime::spawn(async move {
        let mcp = &sync_state.mcp;
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
        match crate::modules::mcp::commands::sync_source_inner(mcp, source.clone(), None).await {
            Ok(tools) => {
                let _ = mcp
                    .store
                    .update_source_status(&source.id, McpSourceStatus::Active, Some(now_rfc3339()))
                    .await;

                // Index tools for semantic search
                let app_state_clone = sync_state.clone();
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
        if let Ok(assistants) = sync_state.mcp.store.list_local_assistants().await {
            let app_state_clone = sync_state.clone();
            tauri::async_runtime::spawn(async move {
                crate::modules::mcp::commands::index_local_assistants(
                    &app_state_clone,
                    &assistants,
                )
                .await;
            });
        }

        // Register and index all local skills (Official & User)
        let app_state_for_skills = sync_state.clone();
        let app_handle_for_skills = handle.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::modules::mcp::commands::register_local_skills_inner(
                app_handle_for_skills,
                &app_state_for_skills,
            )
            .await;
        });

        let app_state_for_knowledge_index = sync_state.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = crate::modules::mcp::commands::rebuild_local_knowledge_vector_index(
                &app_state_for_knowledge_index,
            )
            .await
            {
                warn!("local knowledge vector index bootstrap failed: {}", err);
            }
        });
    });
}

fn setup_shortcuts(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    const MAIN_WINDOW_SHORTCUT: &str = "CommandOrControl+Shift+D";
    let shortcut_manager = app.global_shortcut();
    if shortcut_manager.is_registered(MAIN_WINDOW_SHORTCUT) {
        let _ = shortcut_manager.unregister(MAIN_WINDOW_SHORTCUT);
    }
    if let Err(err) = shortcut_manager.on_shortcut(MAIN_WINDOW_SHORTCUT, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }
    }) {
        warn!(
            "global shortcut registration skipped ({MAIN_WINDOW_SHORTCUT}): {}",
            err
        );
    }
    Ok(())
}
