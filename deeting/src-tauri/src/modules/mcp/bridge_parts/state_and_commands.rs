use std::collections::HashMap;
use std::sync::Arc;

use futures_util::StreamExt;
use log::warn;
use serde::Serialize;
use tauri::Emitter;
use tokio::sync::{Mutex, RwLock};

#[derive(Default)]
pub struct McpBridgeState {
    base_url: Arc<RwLock<String>>,
    streams: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
    client: reqwest::Client,
}

impl McpBridgeState {
    pub fn new(default_base_url: String) -> Self {
        Self {
            base_url: Arc::new(RwLock::new(default_base_url)),
            streams: Arc::new(Mutex::new(HashMap::new())),
            client: reqwest::Client::new(),
        }
    }

    async fn get_base_url(&self) -> String {
        self.base_url.read().await.clone()
    }

    async fn set_base_url(&self, url: String) {
        let mut base_url = self.base_url.write().await;
        *base_url = url;
    }
}

#[derive(Serialize)]
struct LogFallbackPayload {
    tool_id: String,
    raw: String,
}

use crate::state::AppState;

#[tauri::command]
pub async fn set_mcp_backend_url(
    state: tauri::State<'_, AppState>,
    url: String,
) -> Result<(), String> {
    let state = &state.mcp.bridge;
    state.set_base_url(url).await;
    Ok(())
}

#[tauri::command]
pub async fn start_mcp_log_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    tool_id: String,
) -> Result<(), String> {
    let state = &state.mcp.bridge;
    let mut streams = state.streams.lock().await;
    if streams.contains_key(&tool_id) {
        return Ok(());
    }

    let base_url = state.get_base_url().await;
    let client = state.client.clone();
    let tool_id_clone = tool_id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        if let Err(err) = stream_logs(&client, &base_url, &tool_id_clone, &app).await {
            warn!("mcp log stream failed for {}: {}", tool_id_clone, err);
        }
    });

    streams.insert(tool_id, handle);
    Ok(())
}

#[tauri::command]
pub async fn stop_mcp_log_stream(
    state: tauri::State<'_, AppState>,
    tool_id: String,
) -> Result<(), String> {
    let state = &state.mcp.bridge;
    let mut streams = state.streams.lock().await;
    if let Some(handle) = streams.remove(&tool_id) {
        handle.abort();
    }
    Ok(())
}

