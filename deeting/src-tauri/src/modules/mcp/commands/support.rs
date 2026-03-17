pub(crate) use std::collections::{HashMap, HashSet};
pub(crate) use std::path::Path;
pub(crate) use std::process::Stdio;
pub(crate) use std::time::Duration;

pub(crate) use log::warn;
pub(crate) use mcp_session::context::LocalConversationChatContext;
pub(crate) use serde::{Deserialize, Serialize};
pub(crate) use serde_json::Value;
pub(crate) use tauri::{AppHandle, Emitter, Manager, State};
pub(crate) use tokio::io::AsyncWriteExt;
pub(crate) use uuid::Uuid;

pub(crate) use crate::modules::code_mode::types::ExecuteLocalCodeModeRequest;
pub(crate) use crate::modules::mcp::error::McpError;
pub(crate) use crate::modules::mcp::store::expand_path;
pub(crate) use crate::modules::mcp::types::*;
pub(crate) use crate::modules::mcp::McpRuntimeState;
pub(crate) use crate::state::AppState;
pub(crate) use mcp_storage::types::{NewSource, ToolUpsert};

pub(crate) const DESKTOP_CONFIG_SCOUT_BASE_URL_KEY: &str = "scout.base_url";
pub(crate) const SCOUT_SERVICE_URL_ENV_KEY: &str = "SCOUT_SERVICE_URL";

pub(crate) async fn resolve_effective_desktop_scout_base_url(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<Option<String>, McpError> {
    let configured = store
        .get_desktop_config(DESKTOP_CONFIG_SCOUT_BASE_URL_KEY)
        .await?;
    if let Some(normalized) = configured
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
    {
        return Ok(Some(normalized));
    }

    let runtime_env = std::env::var(SCOUT_SERVICE_URL_ENV_KEY)
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty());
    Ok(runtime_env)
}
