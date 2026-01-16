mod mcp;

use std::sync::Arc;

use log::warn;
use crate::mcp::error::McpError;
use crate::mcp::process::ProcessManager;
use crate::mcp::store::{expand_path, McpStore};
use crate::mcp::types::McpSourceStatus;
use crate::mcp::McpRuntimeState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
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
      let state = tauri::async_runtime::block_on(async {
        let database_url = resolve_database_url()?;
        let store = Arc::new(McpStore::new(&database_url).await?);
        store.init().await?;
        store.ensure_local_source().await?;
        store.ensure_cloud_source(&cloud_base_url).await?;
        let process_manager = ProcessManager::new(store.clone(), handle);
        Ok::<_, McpError>(McpRuntimeState::new(
          store,
          process_manager,
          cloud_base_url,
        ))
      })
      .map_err(|err| Box::<dyn std::error::Error>::from(err))?;
      let sync_state = state.clone();
      app.manage(state);
      tauri::async_runtime::spawn(async move {
        let source = match sync_state.store.ensure_local_source().await {
          Ok(source) => source,
          Err(err) => {
            warn!("mcp auto sync skipped: {}", err);
            return;
          }
        };
        let _ = sync_state
          .store
          .update_source_status(&source.id, McpSourceStatus::Syncing, None)
          .await;
        match crate::mcp::commands::sync_source_inner(&sync_state, source.clone(), None).await {
          Ok(_) => {
            let _ = sync_state
              .store
              .update_source_status(&source.id, McpSourceStatus::Active, Some(now_rfc3339()))
              .await;
          }
          Err(err) => {
            let _ = sync_state
              .store
              .update_source_status(&source.id, McpSourceStatus::Error, None)
              .await;
            warn!("mcp auto sync failed: {}", err);
          }
        }
      });
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      crate::mcp::commands::set_cloud_base_url,
      crate::mcp::commands::list_mcp_sources,
      crate::mcp::commands::create_mcp_source,
      crate::mcp::commands::sync_mcp_source,
      crate::mcp::commands::list_mcp_tools,
      crate::mcp::commands::list_local_assistants,
      crate::mcp::commands::create_local_assistant,
      crate::mcp::commands::update_local_assistant,
      crate::mcp::commands::delete_local_assistant,
      crate::mcp::commands::list_assistant_messages,
      crate::mcp::commands::append_assistant_message,
      crate::mcp::commands::delete_assistant_messages,
      crate::mcp::commands::import_mcp_config,
      crate::mcp::commands::start_mcp_tool,
      crate::mcp::commands::stop_mcp_tool,
      crate::mcp::commands::update_mcp_tool_env,
      crate::mcp::commands::apply_pending_config,
      crate::mcp::commands::resolve_mcp_conflict,
      crate::mcp::commands::get_mcp_logs,
      crate::mcp::commands::clear_mcp_logs,
      crate::mcp::commands::sync_cloud_subscriptions
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

fn resolve_database_url() -> Result<String, McpError> {
  let db_path = std::env::var("DESKTOP_DB_PATH").unwrap_or_else(|_| default_db_path());
  if db_path == ":memory:" {
    return Ok("sqlite::memory:".to_string());
  }
  if db_path.starts_with("sqlite:") {
    return Ok(db_path);
  }
  let expanded = expand_path(&db_path);
  if let Some(parent) = expanded.parent() {
    std::fs::create_dir_all(parent)
      .map_err(|err| McpError::Storage(err.to_string()))?;
  }
  Ok(format!("sqlite://{}", expanded.to_string_lossy()))
}

fn default_db_path() -> String {
  if let Ok(home) = std::env::var("HOME") {
    return format!("{home}/.config/deeting/deeting.db");
  }
  "deeting.db".to_string()
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
