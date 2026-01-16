use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::mcp::error::McpError;
use crate::mcp::process::ProcessManager;
use crate::mcp::store::{expand_path, ExtractedToolFields, McpStore, NewSource, ToolUpsert};
use crate::mcp::types::{
    CreateSourceRequest, ImportConfigRequest, McpConfigPayload, McpConflictStatus, McpLogEntry,
    McpSource, McpSourceStatus, McpSourceType, McpTool, McpToolConfigPayload, McpToolStatus,
    McpTrustLevel, ResolveConflictRequest, SyncSourceRequest, UpdateToolConfigRequest,
};
use crate::mcp::McpRuntimeState;

#[derive(Debug, Deserialize)]
struct CloudToolSummary {
    id: String,
    identifier: String,
    name: String,
    description: String,
    avatar_url: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
    author: Option<String>,
    is_official: Option<bool>,
    install_manifest: CloudInstallManifest,
}

#[derive(Debug, Deserialize)]
struct CloudInstallManifest {
    runtime: Option<String>,
    command: String,
    args: Vec<String>,
    env_config: Option<Vec<serde_json::Map<String, serde_json::Value>>>,
}

#[derive(Debug, Deserialize)]
struct CloudSubscriptionItem {
    id: String,
    market_tool_id: String,
    config_hash_snapshot: Option<String>,
    tool: CloudToolSummary,
}

#[tauri::command]
pub async fn set_cloud_base_url(
    state: State<'_, McpRuntimeState>,
    url: String,
) -> Result<(), String> {
    let mut base = state.cloud_base_url.write().await;
    *base = url;
    Ok(())
}

#[tauri::command]
pub async fn list_mcp_sources(state: State<'_, McpRuntimeState>) -> Result<Vec<McpSource>, String> {
    state.store.list_sources().await.map_err(to_string)
}

#[tauri::command]
pub async fn create_mcp_source(
    state: State<'_, McpRuntimeState>,
    payload: CreateSourceRequest,
) -> Result<McpSource, String> {
    let source = state
        .store
        .insert_source(NewSource {
            name: payload.name,
            source_type: payload.source_type,
            path_or_url: payload.path_or_url,
            trust_level: payload.trust_level,
            status: McpSourceStatus::Active,
            last_synced_at: None,
            is_read_only: payload.is_read_only.unwrap_or(false),
        })
        .await
        .map_err(to_string)?;
    Ok(source)
}

#[tauri::command]
pub async fn sync_mcp_source(
    state: State<'_, McpRuntimeState>,
    source_id: String,
    payload: SyncSourceRequest,
) -> Result<Vec<McpTool>, String> {
    let source = state
        .store
        .get_source(&source_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| to_string(McpError::NotFound(format!("source {source_id} not found"))))?;

    state
        .store
        .update_source_status(&source_id, McpSourceStatus::Syncing, None)
        .await
        .map_err(to_string)?;

    let result = sync_source_inner(&state, source, payload.auth_token).await;
    match result {
        Ok(tools) => {
            state
                .store
                .update_source_status(&source_id, McpSourceStatus::Active, Some(now_rfc3339()))
                .await
                .map_err(to_string)?;
            Ok(tools)
        }
        Err(err) => {
            state
                .store
                .update_source_status(&source_id, McpSourceStatus::Error, None)
                .await
                .map_err(to_string)?;
            Err(to_string(err))
        }
    }
}

#[tauri::command]
pub async fn list_mcp_tools(state: State<'_, McpRuntimeState>) -> Result<Vec<McpTool>, String> {
    state.store.list_tools().await.map_err(to_string)
}

#[tauri::command]
pub async fn import_mcp_config(
    state: State<'_, McpRuntimeState>,
    payload: ImportConfigRequest,
) -> Result<Vec<McpTool>, String> {
    let source = if let Some(source_id) = payload.source_id {
        state
            .store
            .get_source(&source_id)
            .await
            .map_err(to_string)?
            .ok_or_else(|| to_string(McpError::NotFound(format!("source {source_id} not found"))))?
    } else {
        state.store.ensure_local_source().await.map_err(to_string)?
    };

    apply_config_payload(&state, &source, payload.config)
        .await
        .map_err(to_string)
}

#[tauri::command]
pub async fn start_mcp_tool(
    app: AppHandle,
    state: State<'_, McpRuntimeState>,
    tool_id: String,
) -> Result<McpTool, String> {
    let tool = state
        .store
        .get_tool(&tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| to_string(McpError::NotFound(format!("tool {tool_id} not found"))))?;

    let missing = missing_required_env(&tool).unwrap_or_default();
    if !missing.is_empty() {
        let message = format!("missing required env: {}", missing.join(", "));
        state
            .store
            .set_tool_status(&tool_id, McpToolStatus::Pending, None, Some(message.clone()))
            .await
            .map_err(to_string)?;
        app.emit_all(&format!("mcp-log://{}", tool_id), McpLogEntry {
            timestamp: now_rfc3339(),
            stream: crate::mcp::types::McpLogStream::Event,
            message,
        }).ok();
        return Err("missing required env".to_string());
    }

    state
        .process_manager
        .start_tool(tool.clone())
        .await
        .map_err(to_string)?;
    let updated = state
        .store
        .get_tool(&tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| to_string(McpError::NotFound(format!("tool {tool_id} not found"))))?;
    Ok(updated)
}

#[tauri::command]
pub async fn stop_mcp_tool(
    state: State<'_, McpRuntimeState>,
    tool_id: String,
) -> Result<McpTool, String> {
    state
        .process_manager
        .stop_tool(&tool_id)
        .await
        .map_err(to_string)?;
    let updated = state
        .store
        .get_tool(&tool_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| to_string(McpError::NotFound(format!("tool {tool_id} not found"))))?;
    Ok(updated)
}

#[tauri::command]
pub async fn apply_pending_config(
    state: State<'_, McpRuntimeState>,
    tool_id: String,
    payload: UpdateToolConfigRequest,
) -> Result<McpTool, String> {
    if !payload.apply_pending {
        return Err("apply_pending must be true".to_string());
    }
    apply_pending_update(&state, &tool_id).await.map_err(to_string)
}

#[tauri::command]
pub async fn resolve_mcp_conflict(
    state: State<'_, McpRuntimeState>,
    tool_id: String,
    payload: ResolveConflictRequest,
) -> Result<McpTool, String> {
    match payload.action.as_str() {
        "update" => apply_pending_update(&state, &tool_id).await.map_err(to_string),
        "keep" => {
            state.store.clear_pending_update(&tool_id).await.map_err(to_string)?;
            state
                .store
                .get_tool(&tool_id)
                .await
                .map_err(to_string)?
                .ok_or_else(|| to_string(McpError::NotFound(format!("tool {tool_id} not found"))))
        }
        _ => Err("invalid action".to_string()),
    }
}

#[tauri::command]
pub async fn get_mcp_logs(
    state: State<'_, McpRuntimeState>,
    tool_id: String,
) -> Result<Vec<McpLogEntry>, String> {
    Ok(state.process_manager.logs(&tool_id).await)
}

#[tauri::command]
pub async fn clear_mcp_logs(
    state: State<'_, McpRuntimeState>,
    tool_id: String,
) -> Result<(), String> {
    state.process_manager.clear_logs(&tool_id).await;
    Ok(())
}

#[tauri::command]
pub async fn sync_cloud_subscriptions(
    app: AppHandle,
    state: State<'_, McpRuntimeState>,
    access_token: String,
) -> Result<Vec<McpTool>, String> {
    let base_url = state.cloud_base_url.read().await.clone();
    let url = format!("{}/api/v1/mcp/subscriptions", base_url.trim_end_matches('/'));
    let response = state
        .client
        .get(&url)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|err| McpError::Network(err.to_string()))
        .map_err(to_string)?;

    if !response.status().is_success() {
        return Err(format!("cloud sync failed: {}", response.status()));
    }

    let subs: Vec<CloudSubscriptionItem> = response
        .json()
        .await
        .map_err(|err| McpError::Network(err.to_string()))
        .map_err(to_string)?;

    let cloud_source = state.store.ensure_cloud_source(&base_url).await.map_err(to_string)?;
    let mut seen_identifiers = HashSet::new();

    for sub in subs.iter() {
        let tool = &sub.tool;
        seen_identifiers.insert(tool.identifier.clone());
        let config_json = build_cloud_config_json(tool)?;
        let config_hash = state
            .store
            .compute_config_hash(&config_json)
            .map_err(to_string)?;
        let config_json_text = serde_json::to_string(&config_json)
            .map_err(|err| McpError::Storage(err.to_string()))
            .map_err(to_string)?;

        let extracted = ExtractedToolFields {
            name: tool.name.clone(),
            description: tool.description.clone(),
            command: Some(tool.install_manifest.command.clone()),
            args: Some(tool.install_manifest.args.clone()),
            env: None,
            capabilities: vec![],
        };

        let name_conflict = state
            .store
            .has_name_conflict(&extracted.name, &cloud_source.id)
            .await
            .map_err(to_string)?;

        let existing = state
            .store
            .get_tool_by_source_identifier(&cloud_source.id, &tool.identifier)
            .await
            .map_err(to_string)?;

        match existing {
            Some(existing_tool) => {
                if existing_tool.config_hash == config_hash {
                    continue;
                }
                let conflict_status = if name_conflict {
                    McpConflictStatus::Conflict
                } else {
                    McpConflictStatus::UpdateAvailable
                };
                state
                    .store
                    .mark_tool_pending_update(
                        &existing_tool.id,
                        config_json_text.clone(),
                        config_hash.clone(),
                        conflict_status,
                    )
                    .await
                    .map_err(to_string)?;
            }
            None => {
                let tool_upsert = ToolUpsert {
                    id: None,
                    source_id: cloud_source.id.clone(),
                    identifier: Some(tool.identifier.clone()),
                    name: extracted.name,
                    source_type: McpSourceType::Cloud,
                    status: McpToolStatus::Pending,
                    ping_ms: None,
                    capabilities: extracted.capabilities,
                    description: extracted.description,
                    error: None,
                    command: extracted.command,
                    args: extracted.args,
                    env: extracted.env,
                    config_json: config_json_text.clone(),
                    config_hash: config_hash.clone(),
                    pending_config_json: None,
                    pending_config_hash: None,
                    conflict_status: if name_conflict {
                        McpConflictStatus::Conflict
                    } else {
                        McpConflictStatus::None
                    },
                    is_read_only: true,
                };
                state.store.upsert_tool(tool_upsert).await.map_err(to_string)?;
            }
        }
    }

    let all_tools = state.store.list_tools().await.map_err(to_string)?;
    for tool in all_tools.iter().filter(|t| t.source_id.as_deref() == Some(&cloud_source.id)) {
        let Some(identifier) = tool.identifier.clone() else { continue };
        if !seen_identifiers.contains(&identifier) {
            let _ = state
                .store
                .set_tool_status(&tool.id, McpToolStatus::Orphaned, None, Some("cloud subscription removed".to_string()))
                .await;
            app.emit_all(&format!("mcp-log://{}", tool.id), McpLogEntry {
                timestamp: now_rfc3339(),
                stream: crate::mcp::types::McpLogStream::Event,
                message: "cloud subscription removed".to_string(),
            }).ok();
        }
    }

    state.store.list_tools().await.map_err(to_string)
}

async fn sync_source_inner(
    state: &McpRuntimeState,
    source: McpSource,
    auth_token: Option<String>,
) -> Result<Vec<McpTool>, McpError> {
    let payload = match source.source_type {
        McpSourceType::Local => {
            let path = expand_path(&source.path_or_url);
            let content = tokio::fs::read_to_string(&path)
                .await
                .map_err(|err| McpError::Storage(err.to_string()))?;
            serde_json::from_str::<McpConfigPayload>(&content)
                .map_err(|err| McpError::Storage(err.to_string()))?
        }
        _ => {
            let mut request = state.client.get(&source.path_or_url);
            if let Some(token) = auth_token {
                request = request.bearer_auth(token);
            }
            let response = request
                .send()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;
            if !response.status().is_success() {
                return Err(McpError::Network(format!(
                    "sync failed with status {}",
                    response.status()
                )));
            }
            response
                .json::<McpConfigPayload>()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?
        }
    };

    apply_config_payload(state, &source, payload).await
}

async fn apply_config_payload(
    state: &McpRuntimeState,
    source: &McpSource,
    payload: McpConfigPayload,
) -> Result<Vec<McpTool>, McpError> {
    let mut tools = Vec::with_capacity(payload.mcp_servers.len());
    let is_read_only = source.source_type != McpSourceType::Local || source.is_read_only;

    for (name, config_payload) in payload.mcp_servers {
        let config_value = state.store.build_config_json(&name, &config_payload)?;
        let config_hash = state.store.compute_config_hash(&config_value)?;
        let config_json = serde_json::to_string(&config_value)
            .map_err(|err| McpError::Storage(err.to_string()))?;
        let extracted: ExtractedToolFields = state.store.extract_tool_fields(&name, &config_payload);
        let name_conflict = state
            .store
            .has_name_conflict(&name, &source.id)
            .await?;

        let existing = state
            .store
            .get_tool_by_source_name(&source.id, &name)
            .await?;

        let tool = match existing {
            Some(existing_tool) => {
                if existing_tool.config_hash == config_hash {
                    existing_tool
                } else if is_read_only {
                    let conflict_status = if name_conflict {
                        McpConflictStatus::Conflict
                    } else {
                        McpConflictStatus::UpdateAvailable
                    };
                    state
                        .store
                        .mark_tool_pending_update(
                            &existing_tool.id,
                            config_json,
                            config_hash,
                            conflict_status,
                        )
                        .await?;
                    state
                        .store
                        .get_tool(&existing_tool.id)
                        .await?
                        .ok_or_else(|| McpError::NotFound("tool missing after update".to_string()))?
                } else {
                    state
                        .store
                        .upsert_tool(ToolUpsert {
                            id: Some(existing_tool.id.clone()),
                            source_id: source.id.clone(),
                            identifier: existing_tool.identifier.clone(),
                            name: extracted.name,
                            source_type: source.source_type.clone(),
                            status: existing_tool.status.clone(),
                            ping_ms: existing_tool.ping_ms,
                            capabilities: extracted.capabilities,
                            description: extracted.description,
                            error: existing_tool.error.clone(),
                            command: extracted.command,
                            args: extracted.args,
                            env: extracted.env,
                            config_json,
                            config_hash,
                            pending_config_json: None,
                            pending_config_hash: None,
                            conflict_status: if name_conflict {
                                McpConflictStatus::Conflict
                            } else {
                                McpConflictStatus::None
                            },
                            is_read_only,
                        })
                        .await?
                }
            }
            None => state
                .store
                .upsert_tool(ToolUpsert {
                    id: None,
                    source_id: source.id.clone(),
                    identifier: None,
                    name: extracted.name,
                    source_type: source.source_type.clone(),
                    status: McpToolStatus::Stopped,
                    ping_ms: None,
                    capabilities: extracted.capabilities,
                    description: extracted.description,
                    error: None,
                    command: extracted.command,
                    args: extracted.args,
                    env: extracted.env,
                    config_json,
                    config_hash,
                    pending_config_json: None,
                    pending_config_hash: None,
                    conflict_status: if name_conflict {
                        McpConflictStatus::Conflict
                    } else {
                        McpConflictStatus::None
                    },
                    is_read_only,
                })
                .await?,
        };

        tools.push(tool);
    }

    Ok(tools)
}

async fn apply_pending_update(
    state: &McpRuntimeState,
    tool_id: &str,
) -> Result<McpTool, McpError> {
    let tool = state
        .store
        .get_tool(tool_id)
        .await?
        .ok_or_else(|| McpError::NotFound(format!("tool {tool_id} not found")))?;
    let source_id = tool
        .source_id
        .clone()
        .ok_or_else(|| McpError::Validation("tool missing source_id".to_string()))?;
    let pending_json = state
        .store
        .get_pending_config_json(tool_id)
        .await?
        .ok_or_else(|| McpError::Validation("no pending config".to_string()))?;

    let pending_value: serde_json::Value =
        serde_json::from_str(&pending_json).map_err(|err| McpError::Storage(err.to_string()))?;
    let pending_payload: McpToolConfigPayload =
        serde_json::from_value(pending_value.clone()).map_err(|err| McpError::Storage(err.to_string()))?;
    let extracted = state
        .store
        .extract_tool_fields(&tool.name, &pending_payload);
    let config_hash = state.store.compute_config_hash(&pending_value)?;

    let updated = state
        .store
        .upsert_tool(ToolUpsert {
            id: Some(tool.id.clone()),
            source_id,
            identifier: tool.identifier.clone(),
            name: extracted.name,
            source_type: tool.source_type.clone(),
            status: tool.status.clone(),
            ping_ms: tool.ping_ms,
            capabilities: extracted.capabilities,
            description: extracted.description,
            error: tool.error.clone(),
            command: extracted.command,
            args: extracted.args,
            env: extracted.env,
            config_json: pending_json,
            config_hash,
            pending_config_json: None,
            pending_config_hash: None,
            conflict_status: McpConflictStatus::None,
            is_read_only: tool.is_read_only,
        })
        .await?;

    Ok(updated)
}

fn build_cloud_config_json(tool: &CloudToolSummary) -> Result<serde_json::Value, String> {
    let mut map = serde_json::Map::new();
    map.insert("identifier".to_string(), serde_json::Value::String(tool.identifier.clone()));
    map.insert("name".to_string(), serde_json::Value::String(tool.name.clone()));
    map.insert("description".to_string(), serde_json::Value::String(tool.description.clone()));
    map.insert("command".to_string(), serde_json::Value::String(tool.install_manifest.command.clone()));
    map.insert(
        "args".to_string(),
        serde_json::Value::Array(tool.install_manifest.args.iter().cloned().map(serde_json::Value::String).collect()),
    );
    if let Some(runtime) = &tool.install_manifest.runtime {
        map.insert("runtime".to_string(), serde_json::Value::String(runtime.clone()));
    }
    if let Some(env_config) = &tool.install_manifest.env_config {
        map.insert("env_config".to_string(), serde_json::Value::Array(
            env_config.iter().cloned().map(serde_json::Value::Object).collect()
        ));
    }
    if let Some(tags) = &tool.tags {
        map.insert("tags".to_string(), serde_json::Value::Array(
            tags.iter().cloned().map(serde_json::Value::String).collect()
        ));
    }
    if let Some(category) = &tool.category {
        map.insert("category".to_string(), serde_json::Value::String(category.clone()));
    }
    if let Some(author) = &tool.author {
        map.insert("author".to_string(), serde_json::Value::String(author.clone()));
    }
    if let Some(is_official) = tool.is_official {
        map.insert("is_official".to_string(), serde_json::Value::Bool(is_official));
    }
    if let Some(avatar_url) = &tool.avatar_url {
        map.insert("avatar_url".to_string(), serde_json::Value::String(avatar_url.clone()));
    }
    Ok(serde_json::Value::Object(map))
}

fn missing_required_env(tool: &McpTool) -> Option<Vec<String>> {
    let config: serde_json::Value = serde_json::from_str(&tool.config_json).ok()?;
    let env_config = config.get("env_config")?.as_array()?;
    let env = tool.env.as_ref();
    let mut missing = Vec::new();
    for item in env_config {
        let key = item.get("key").and_then(|v| v.as_str()).unwrap_or("");
        let required = item.get("required").and_then(|v| v.as_bool()).unwrap_or(false);
        if !required || key.is_empty() {
            continue;
        }
        let present = env.and_then(|env| env.get(key)).map(|v| !v.is_empty()).unwrap_or(false);
        if !present {
            missing.push(key.to_string());
        }
    }
    Some(missing)
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "".to_string())
}

fn to_string(err: McpError) -> String {
    err.to_string()
}

pub fn default_cloud_source_name() -> &'static str {
    "Deeting Cloud"
}

pub fn default_local_source_path() -> PathBuf {
    expand_path("~/.config/deeting/mcp.json")
}
