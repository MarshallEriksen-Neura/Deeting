pub mod modules;
pub mod state;

use std::path::Path;
use std::sync::Arc;
use log::warn;
use tauri::Manager;
use crate::modules::mcp::error::McpError;
use crate::modules::mcp::process::ProcessManager;
use crate::modules::mcp::store::{expand_path, McpStore};
use crate::modules::mcp::types::McpSourceStatus;
use crate::modules::mcp::McpRuntimeState;
use crate::modules::providers::ProviderState;
use crate::state::AppState;

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
        let database_url = resolve_database_url(app)?;
        
        // MCP 初始化
        let store: Arc<McpStore> = Arc::new(McpStore::new(&database_url).await?);
        store.init().await?;
        store.ensure_local_source().await?;
        store.ensure_cloud_source(&cloud_base_url).await?;
        let process_manager = ProcessManager::new(store.clone(), handle);
        let mcp_state = McpRuntimeState::new(
          store,
          process_manager,
          cloud_base_url,
        );

        // Providers 初始化
        let provider_state = ProviderState::new(&database_url).await
            .map_err(|e| McpError::Storage(e.to_string()))?;

        Ok::<_, McpError>(AppState::new(mcp_state, provider_state))
      })
      .map_err(|err| Box::<dyn std::error::Error>::from(err))?;

      let sync_state = state.clone();
      app.manage(state);

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
          Ok(_) => {
            let _ = mcp
              .store
              .update_source_status(&source.id, McpSourceStatus::Active, Some(now_rfc3339()))
              .await;
          }
          Err(err) => {
            let _ = mcp
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
      // MCP Commands
      crate::modules::mcp::commands::set_cloud_base_url,
      crate::modules::mcp::commands::list_mcp_sources,
      crate::modules::mcp::commands::create_mcp_source,
      crate::modules::mcp::commands::sync_mcp_source,
      crate::modules::mcp::commands::list_mcp_tools,
      crate::modules::mcp::commands::list_local_assistants,
      crate::modules::mcp::commands::create_local_assistant,
      crate::modules::mcp::commands::update_local_assistant,
      crate::modules::mcp::commands::delete_local_assistant,
      crate::modules::mcp::commands::list_assistant_messages,
      crate::modules::mcp::commands::append_assistant_message,
      crate::modules::mcp::commands::delete_assistant_messages,
      crate::modules::mcp::commands::import_mcp_config,
      crate::modules::mcp::commands::start_mcp_tool,
      crate::modules::mcp::commands::stop_mcp_tool,
      crate::modules::mcp::commands::update_mcp_tool_env,
      crate::modules::mcp::commands::apply_pending_config,
      crate::modules::mcp::commands::resolve_mcp_conflict,
      crate::modules::mcp::commands::get_mcp_logs,
      crate::modules::mcp::commands::clear_mcp_logs,
      crate::modules::mcp::commands::sync_cloud_subscriptions,
      crate::modules::mcp::bridge::set_mcp_backend_url,
      crate::modules::mcp::bridge::start_mcp_log_stream,
      crate::modules::mcp::bridge::stop_mcp_log_stream,

      // Provider Commands
      crate::modules::providers::commands::list_local_provider_instances,
      crate::modules::providers::commands::create_local_provider_instance,
      crate::modules::providers::commands::list_local_provider_models
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
    std::fs::create_dir_all(parent)
      .map_err(|err| McpError::Storage(err.to_string()))?;
  }
  Ok(path_to_sqlite_url(&absolute))
}

fn default_db_path<R: tauri::Runtime>(app: &tauri::App<R>) -> String {
  if let Ok(app_data_dir) = app.path().app_data_dir() {
    return app_data_dir.join("deeting.db").to_string_lossy().to_string();
  }
  if let Some(home) = non_empty_env("HOME") {
    return format!("{home}/.config/deeting/deeting.db");
  }
  if let Some(user_profile) = non_empty_env("USERPROFILE") {
    return format!("{user_profile}/.config/deeting/deeting.db");
  }
  "deeting.db".to_string()
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
