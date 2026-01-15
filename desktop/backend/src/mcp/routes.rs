use std::convert::Infallible;
use std::path::PathBuf;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use futures_util::StreamExt;
use tokio_stream::wrappers::BroadcastStream;

use crate::state::AppState;
use crate::mcp::{
    CreateSourceRequest, CreateSourceResponse, ExtractedToolFields, ImportConfigRequest,
    ImportConfigResponse, ListSourcesResponse, ListToolsResponse, McpConfigPayload, McpConflictStatus,
    McpError, McpSource, McpSourceStatus, McpSourceType, McpTool, McpToolStatus, NewSource,
    SyncSourceRequest, SyncSourceResponse, ToolLogsResponse, ToolUpsert, UpdateToolConfigRequest,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/sources", get(list_sources).post(create_source))
        .route("/sources/:id/sync", post(sync_source))
        .route("/tools", get(list_tools))
        .route("/tools/import", post(import_config))
        .route("/tools/:id/start", post(start_tool))
        .route("/tools/:id/stop", post(stop_tool))
        .route("/tools/:id/config", patch(apply_pending_update))
        .route("/tools/:id/logs", get(tool_logs))
        .route("/tools/:id/logs/stream", get(tool_logs_stream))
}

async fn list_sources(
    State(state): State<AppState>,
) -> Result<Json<ListSourcesResponse>, McpError> {
    let sources = state.store.list_sources().await?;
    Ok(Json(ListSourcesResponse { sources }))
}

async fn create_source(
    State(state): State<AppState>,
    Json(payload): Json<CreateSourceRequest>,
) -> Result<Json<CreateSourceResponse>, McpError> {
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
        .await?;
    Ok(Json(CreateSourceResponse { source }))
}

async fn sync_source(
    State(state): State<AppState>,
    Path(source_id): Path<String>,
    Json(payload): Json<SyncSourceRequest>,
) -> Result<Json<SyncSourceResponse>, McpError> {
    let source = state
        .store
        .get_source(&source_id)
        .await?
        .ok_or_else(|| McpError::NotFound(format!("source {source_id} not found")))?;

    state
        .store
        .update_source_status(&source_id, McpSourceStatus::Syncing, None)
        .await?;

    let result = sync_source_inner(&state, source, payload.auth_token).await;
    match result {
        Ok(tools) => {
            state
                .store
                .update_source_status(&source_id, McpSourceStatus::Active, Some(now_rfc3339()?))
                .await?;
            Ok(Json(SyncSourceResponse { tools }))
        }
        Err(err) => {
            state
                .store
                .update_source_status(&source_id, McpSourceStatus::Error, None)
                .await?;
            Err(err)
        }
    }
}

async fn list_tools(State(state): State<AppState>) -> Result<Json<ListToolsResponse>, McpError> {
    let tools = state.store.list_tools().await?;
    Ok(Json(ListToolsResponse { tools }))
}

async fn import_config(
    State(state): State<AppState>,
    Json(payload): Json<ImportConfigRequest>,
) -> Result<Json<ImportConfigResponse>, McpError> {
    let source = if let Some(source_id) = payload.source_id {
        state
            .store
            .get_source(&source_id)
            .await?
            .ok_or_else(|| McpError::NotFound(format!("source {source_id} not found")))?
    } else {
        state.store.ensure_local_source().await?
    };

    let tools = apply_config_payload(&state, &source, payload.config).await?;
    Ok(Json(ImportConfigResponse { tools }))
}

async fn start_tool(
    State(state): State<AppState>,
    Path(tool_id): Path<String>,
) -> Result<Json<McpTool>, McpError> {
    let tool = state
        .store
        .get_tool(&tool_id)
        .await?
        .ok_or_else(|| McpError::NotFound(format!("tool {tool_id} not found")))?;
    state.process_manager.start_tool(tool.clone()).await?;
    let updated = state
        .store
        .get_tool(&tool_id)
        .await?
        .ok_or_else(|| McpError::NotFound(format!("tool {tool_id} not found")))?;
    Ok(Json(updated))
}

async fn stop_tool(
    State(state): State<AppState>,
    Path(tool_id): Path<String>,
) -> Result<Json<McpTool>, McpError> {
    state.process_manager.stop_tool(&tool_id).await?;
    let updated = state
        .store
        .get_tool(&tool_id)
        .await?
        .ok_or_else(|| McpError::NotFound(format!("tool {tool_id} not found")))?;
    Ok(Json(updated))
}

async fn apply_pending_update(
    State(state): State<AppState>,
    Path(tool_id): Path<String>,
    Json(payload): Json<UpdateToolConfigRequest>,
) -> Result<Json<McpTool>, McpError> {
    if !payload.apply_pending {
        return Err(McpError::Validation(
            "apply_pending must be true".to_string(),
        ));
    }

    let tool = state
        .store
        .get_tool(&tool_id)
        .await?
        .ok_or_else(|| McpError::NotFound(format!("tool {tool_id} not found")))?;
    let source_id = tool
        .source_id
        .clone()
        .ok_or_else(|| McpError::Validation("tool missing source_id".to_string()))?;
    let pending_json = state
        .store
        .get_pending_config_json(&tool_id)
        .await?
        .ok_or_else(|| McpError::Validation("no pending config".to_string()))?;

    let pending_value: serde_json::Value = serde_json::from_str(&pending_json)?;
    let pending_payload: crate::mcp::McpToolConfigPayload =
        serde_json::from_value(pending_value.clone())?;
    let extracted = state
        .store
        .extract_tool_fields(&tool.name, &pending_payload);
    let config_hash = state.store.compute_config_hash(&pending_value)?;

    let updated = state
        .store
        .upsert_tool(ToolUpsert {
            id: Some(tool.id.clone()),
            source_id,
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

    Ok(Json(updated))
}

async fn tool_logs(
    State(state): State<AppState>,
    Path(tool_id): Path<String>,
) -> Result<Json<ToolLogsResponse>, McpError> {
    let entries = state.process_manager.logs(&tool_id).await;
    Ok(Json(ToolLogsResponse { entries }))
}

async fn tool_logs_stream(
    State(state): State<AppState>,
    Path(tool_id): Path<String>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let receiver = state.process_manager.subscribe_logs(&tool_id).await;
    let stream = BroadcastStream::new(receiver).filter_map(|result| async {
        match result {
            Ok(entry) => Event::default()
                .json_data(entry)
                .ok()
                .map(Ok),
            Err(_) => None,
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

async fn sync_source_inner(
    state: &AppState,
    source: McpSource,
    auth_token: Option<String>,
) -> Result<Vec<McpTool>, McpError> {
    let payload = match source.source_type {
        McpSourceType::Local => {
            let path = expand_path(&source.path_or_url);
            let content = tokio::fs::read_to_string(&path).await?;
            serde_json::from_str::<McpConfigPayload>(&content)?
        }
        _ => {
            let client = reqwest::Client::new();
            let mut request = client.get(&source.path_or_url);
            if let Some(token) = auth_token {
                request = request.bearer_auth(token);
            }
            let response = request
                .send()
                .await
                .map_err(|err| McpError::Process(err.to_string()))?;
            if !response.status().is_success() {
                return Err(McpError::Process(format!(
                    "sync failed with status {}",
                    response.status()
                )));
            }
            response.json::<McpConfigPayload>().await?
        }
    };

    apply_config_payload(state, &source, payload).await
}

async fn apply_config_payload(
    state: &AppState,
    source: &McpSource,
    payload: McpConfigPayload,
) -> Result<Vec<McpTool>, McpError> {
    let mut tools = Vec::with_capacity(payload.mcp_servers.len());
    let is_read_only = source.source_type != McpSourceType::Local || source.is_read_only;

    for (name, config_payload) in payload.mcp_servers {
        let config_value = state.store.build_config_json(&name, &config_payload)?;
        let config_hash = state.store.compute_config_hash(&config_value)?;
        let config_json = serde_json::to_string(&config_value)?;
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

fn expand_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return PathBuf::from(home).join(stripped);
        }
    }
    PathBuf::from(path)
}

fn now_rfc3339() -> Result<String, McpError> {
    Ok(time::OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339)?)
}
