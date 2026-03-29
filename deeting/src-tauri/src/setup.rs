use crate::modules::browser_agent::BrowserAgentState;
use crate::modules::code_mode::CodeModeState;
use crate::modules::im::runtime::spawn_im_runtime_worker;
use crate::modules::im::wechat::WechatState;
use crate::modules::knowledge::KnowledgeState;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::process::ProcessManager;
use crate::modules::mcp::McpRuntimeState;
use crate::modules::memory::MemoryState;
use crate::modules::monitor::MonitorState;
use crate::modules::providers::ProviderState;
use crate::modules::sandbox::SandboxState;
use crate::state::AppState;
use crate::utils::*;
use log::warn;
use mcp_core::types::McpSourceStatus;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{App, AppHandle, Listener, Manager};
use tauri_plugin_log::{Target, TargetKind};

const DESKTOP_RUNTIME_DEBUG_LOG_TARGET_PREFIXES: &[&str] =
    &["app_lib::modules::mcp::commands::runtime::tool_execution"];
const DESKTOP_UI_READY_EVENT: &str = "desktop-ui-ready";

fn should_skip_file_log_for_target(target: &str) -> bool {
    let normalized = target.trim();
    DESKTOP_RUNTIME_DEBUG_LOG_TARGET_PREFIXES
        .iter()
        .any(|prefix| normalized.starts_with(prefix))
}

fn ensure_rustls_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

fn log_startup_phase(phase: &str, started_at: Instant) {
    let elapsed_ms = started_at.elapsed().as_millis();
    if elapsed_ms >= 500 {
        log::warn!("desktop_startup phase={} took_ms={}", phase, elapsed_ms);
    } else {
        log::info!("desktop_startup phase={} took_ms={}", phase, elapsed_ms);
    }
}

fn reveal_main_window(app: &AppHandle, source: &str, is_revealed: &AtomicBool) {
    if is_revealed.swap(true, Ordering::SeqCst) {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        log::info!("desktop_startup window_revealed source={}", source);
    } else {
        log::warn!(
            "desktop_startup window_reveal_skipped source={} reason=main_window_missing",
            source
        );
    }
}

fn register_startup_window_reveal(app: &App) {
    let startup_window_revealed = Arc::new(AtomicBool::new(false));
    let startup_window_revealed_for_event = startup_window_revealed.clone();
    let app_handle_for_ready_event = app.handle().clone();
    app.listen(DESKTOP_UI_READY_EVENT, move |_event| {
        reveal_main_window(
            &app_handle_for_ready_event,
            "frontend_ready",
            startup_window_revealed_for_event.as_ref(),
        );
    });

    let startup_window_revealed_for_fallback = startup_window_revealed.clone();
    let app_handle_for_startup_fallback = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(12)).await;
        reveal_main_window(
            &app_handle_for_startup_fallback,
            "startup_fallback",
            startup_window_revealed_for_fallback.as_ref(),
        );
    });
}

pub fn setup_app(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let setup_started_at = Instant::now();
    ensure_rustls_crypto_provider();

    if cfg!(debug_assertions) {
        app.handle().plugin(
            tauri_plugin_log::Builder::default()
                .clear_targets()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None })
                        .filter(|metadata| !should_skip_file_log_for_target(metadata.target())),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )?;
    }

    register_startup_window_reveal(app);

    let handle = app.handle().clone();
    let cloud_base_url = resolve_cloud_base_url();
    let lancedb_uri = resolve_lancedb_uri(app)?;
    let boxrun_home_dir = resolve_boxrun_home_dir(app)?;

    let sync_state_started_at = Instant::now();
    let state = tauri::async_runtime::block_on(async {
        let phase_started_at = Instant::now();
        let database_url = resolve_database_url(app)?;
        log_startup_phase("resolve_database_url", phase_started_at);

        let phase_started_at = Instant::now();
        let read_options = SqliteConnectOptions::from_str(&database_url)
            .map_err(|err| McpError::Storage(err.to_string()))?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(10))
            .pragma("synchronous", "NORMAL")
            .pragma("mmap_size", "268435456");
        log_startup_phase("build_read_sqlite_options", phase_started_at);

        let phase_started_at = Instant::now();
        let write_options = SqliteConnectOptions::from_str(&database_url)
            .map_err(|err| McpError::Storage(err.to_string()))?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(30))
            .pragma("synchronous", "NORMAL");
        log_startup_phase("build_write_sqlite_options", phase_started_at);

        let phase_started_at = Instant::now();
        let global_pool = SqlitePoolOptions::new()
            .max_connections(10)
            .connect_with(read_options)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        log_startup_phase("connect_read_pool", phase_started_at);

        // Single-connection pool: serializes all transactional writes at the
        // application level so concurrent workers never fight for SQLite's
        // single-writer lock. Eliminates "database is locked" errors.
        let phase_started_at = Instant::now();
        let global_write_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(write_options)
            .await
            .map_err(|err| McpError::Storage(err.to_string()))?;
        log_startup_phase("connect_write_pool", phase_started_at);

        // MCP 初始化
        let phase_started_at = Instant::now();
        let store = Arc::new(
            crate::modules::mcp::store::McpStore::with_pool_and_write_pool(
                global_pool.clone(),
                global_write_pool,
                &database_url,
            )?,
        );
        log_startup_phase("build_mcp_store", phase_started_at);
        let phase_started_at = Instant::now();
        store.init().await?;
        log_startup_phase("init_mcp_store", phase_started_at);
        let phase_started_at = Instant::now();
        store.ensure_local_source().await?;
        log_startup_phase("ensure_local_source", phase_started_at);
        let phase_started_at = Instant::now();
        store.ensure_cloud_source(&cloud_base_url).await?;
        log_startup_phase("ensure_cloud_source", phase_started_at);
        let phase_started_at = Instant::now();
        crate::modules::code_mode::core_tool_contracts::sync_core_tool_registry_entries(
            store.as_ref(),
        )
        .await
        .map_err(McpError::Storage)?;
        log_startup_phase("sync_core_tool_registry_entries", phase_started_at);
        let phase_started_at = Instant::now();
        let process_manager = ProcessManager::new(store.clone(), handle);
        let mcp_state = McpRuntimeState::new(store, process_manager, cloud_base_url);
        log_startup_phase("build_mcp_runtime_state", phase_started_at);

        // Knowledge 初始化
        let phase_started_at = Instant::now();
        let knowledge_state = KnowledgeState::with_pool(global_pool.clone()).await?;
        log_startup_phase("init_knowledge_state", phase_started_at);

        // Providers 初始化
        let phase_started_at = Instant::now();
        let provider_state = ProviderState::with_pool_and_proxy(
            global_pool.clone(),
            &database_url,
            Some(mcp_state.store.clone()),
            Some(mcp_state.transport.cloud_base_url.clone()),
        )
        .await
        .map_err(|e| McpError::Storage(e.to_string()))?;
        log_startup_phase("init_provider_state", phase_started_at);

        // Memory 初始化 (with shared embedding capability)
        let phase_started_at = Instant::now();
        let memory_state = MemoryState::with_options(
            &lancedb_uri,
            None,
            Some(provider_state.embedding.clone()),
            Some(global_pool.clone()),
        )
        .await
        .map_err(|e| McpError::Storage(e.to_string()))?;
        log_startup_phase("init_memory_state", phase_started_at);

        let phase_started_at = Instant::now();
        let browser_agent_state = BrowserAgentState::new();
        log_startup_phase("build_browser_agent_state", phase_started_at);

        let phase_started_at = Instant::now();
        if let Err(err) = browser_agent_state
            .service
            .ensure_started(mcp_state.store.as_ref())
            .await
        {
            warn!("browser agent bridge startup skipped: {}", err);
        }
        log_startup_phase("start_browser_agent_bridge", phase_started_at);

        let phase_started_at = Instant::now();
        let sandbox_state = SandboxState::new(boxrun_home_dir.clone());
        log_startup_phase("build_sandbox_state", phase_started_at);
        let phase_started_at = Instant::now();
        let code_mode_state = CodeModeState::with_pool(global_pool.clone())
            .await
            .map_err(|e| McpError::Storage(e.to_string()))?;
        log_startup_phase("init_code_mode_state", phase_started_at);

        let phase_started_at = Instant::now();
        let monitor_state = MonitorState::with_pool(
            global_pool.clone(),
            provider_state.store.clone(),
            Some(mcp_state.store.clone()),
        )
        .await
        .map_err(|e| McpError::Storage(e.to_string()))?;
        log_startup_phase("init_monitor_state", phase_started_at);

        let phase_started_at = Instant::now();
        let wechat_state = WechatState::with_pool(global_pool.clone(), &database_url)
            .await
            .map_err(|e| McpError::Storage(e.to_string()))?;
        log_startup_phase("init_wechat_state", phase_started_at);
        monitor_state
            .attach_wechat_state(std::sync::Arc::new(wechat_state.clone()))
            .await;

        let phase_started_at = Instant::now();
        Ok::<_, McpError>(AppState::new(
            mcp_state,
            browser_agent_state,
            knowledge_state,
            provider_state,
            memory_state,
            sandbox_state,
            code_mode_state,
            monitor_state,
            wechat_state,
        ))
        .inspect(|_| log_startup_phase("build_app_state", phase_started_at))
    })
    .map_err(|err| Box::<dyn std::error::Error>::from(err))?;
    log_startup_phase("sync_state_construction_total", sync_state_started_at);

    let sync_state = state.clone();
    app.manage(state);
    crate::state::set_global_app_state(sync_state.clone());
    crate::state::set_global_app_handle(app.handle().clone());
    spawn_capability_registry_bootstrap(sync_state.clone());

    let sync_state_for_mcp = sync_state.clone();
    let app_handle_for_mcp_tasks = app.handle().clone();

    // Spawning background tasks
    spawn_background_tasks(app_handle_for_mcp_tasks, sync_state_for_mcp);

    let sandbox_state = sync_state.sandbox.clone();
    tauri::async_runtime::spawn(async move {
        sandbox_state.manager.start_background_worker().await;
    });

    // Memory embedding backfill (fire-and-forget)
    let memory_service = sync_state.memory.service.clone();
    tauri::async_runtime::spawn(async move {
        // Small delay to let the app finish initializing
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        crate::modules::memory::backfill::run_embedding_backfill(memory_service).await;
    });

    let summary_worker_state = sync_state.clone();
    tauri::async_runtime::spawn(async move {
        crate::modules::conversations::summary_workers::start_local_conversation_summary_worker(
            summary_worker_state,
        )
        .await;
    });

    let periodic_worker_state = sync_state.clone();
    tauri::async_runtime::spawn(async move {
        crate::modules::conversations::summary_workers::start_local_periodic_worker(
            periodic_worker_state.mcp,
        )
        .await;
    });

    let gateway_state = sync_state.clone();
    let gateway_app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        match gateway_state
            .mcp
            .transport
            .local_gateway
            .start(gateway_state.clone(), gateway_app_handle)
            .await
        {
            Ok(url) => log::info!("Local Gateway started successfully at {}", url),
            Err(e) => log::error!("Failed to start Local Gateway: {}", e),
        }
    });

    let im_state = sync_state.clone();
    let im_app_handle = app.handle().clone();
    spawn_im_runtime_worker(im_state, im_app_handle);

    // Temporarily disable automatic platform model sync on desktop startup.
    // The manual sync command remains available if we need to re-run it later.

    // Setup Tray
    crate::tray::setup_tray(app)?;

    // Setup Global Shortcuts
    setup_shortcuts(app)?;

    log_startup_phase("setup_app_total", setup_started_at);

    Ok(())
}

fn spawn_capability_registry_bootstrap(sync_state: AppState) {
    tauri::async_runtime::spawn(async move {
        let mcp_store = sync_state.mcp.store.clone();

        let phase_started_at = Instant::now();
        match mcp_store.sync_all_mcp_tool_registry_entries().await {
            Ok(_) => log_startup_phase(
                "background_sync_all_mcp_tool_registry_entries",
                phase_started_at,
            ),
            Err(err) => warn!("background mcp tool registry sync failed: {}", err),
        }

        let phase_started_at = Instant::now();
        match mcp_store.sync_all_assistant_registry_entries().await {
            Ok(_) => log_startup_phase(
                "background_sync_all_assistant_registry_entries",
                phase_started_at,
            ),
            Err(err) => warn!("background assistant registry sync failed: {}", err),
        }
    });
}

fn spawn_background_tasks(_handle: AppHandle, sync_state: AppState) {
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
        match crate::modules::mcp::commands::runtime::source_sync::sync_source_inner(
            mcp,
            source.clone(),
            None,
        )
        .await
        {
            Ok(tools) => {
                let _ = mcp
                    .store
                    .update_source_status(&source.id, McpSourceStatus::Active, Some(now_rfc3339()))
                    .await;

                // Index tools for semantic search
                let app_state_clone = sync_state.clone();
                let tools_clone = tools.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::modules::knowledge::tool_index::index_mcp_tools(
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
                crate::modules::assistants::commands::index_local_assistants(
                    &app_state_clone,
                    &assistants,
                )
                .await;
            });
        }

        if let Ok(custom_agents) =
            crate::modules::custom_task_agents::store::list_custom_task_agents(
                sync_state.mcp.store.as_ref(),
            )
            .await
        {
            let app_state_clone = sync_state.clone();
            tauri::async_runtime::spawn(async move {
                let _ = crate::modules::custom_task_agents::indexing::index_custom_task_agents(
                    &app_state_clone,
                    &custom_agents,
                )
                .await;
            });
        }

        // Temporarily disable automatic local skill registration/indexing on app startup.
        // Keep manual skill sync/register commands available for explicit user-triggered maintenance.

        // Temporarily disable automatic knowledge vector index rebuild on app startup.
        // Keep the manual rebuild command available for explicit user-triggered maintenance.
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
