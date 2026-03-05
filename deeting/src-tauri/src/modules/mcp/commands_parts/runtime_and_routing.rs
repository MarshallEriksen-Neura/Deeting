const LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT: &str = "local-embedding-rebuild-progress";

#[derive(Debug, Clone, Serialize)]
pub struct LocalEmbeddingRebuildProgress {
    pub phase: String,
    pub progress: i64,
    pub total: i64,
    pub processed: i64,
    pub indexed: i64,
    pub failed: i64,
    pub current: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LocalEmbeddingRebuildResponse {
    pub vector_dimension: i64,
    pub total: i64,
    pub indexed: i64,
    pub failed: i64,
}

fn emit_local_embedding_rebuild_progress(
    app: &AppHandle,
    phase: &str,
    total: usize,
    processed: usize,
    indexed: usize,
    failed: usize,
    current: Option<String>,
) {
    let progress = if total == 0 {
        100
    } else {
        ((processed.saturating_mul(100)) / total) as i64
    };
    let payload = LocalEmbeddingRebuildProgress {
        phase: phase.to_string(),
        progress,
        total: total as i64,
        processed: processed as i64,
        indexed: indexed as i64,
        failed: failed as i64,
        current,
    };
    let _ = app.emit(LOCAL_EMBEDDING_REBUILD_PROGRESS_EVENT, payload);
}

pub(crate) async fn rebuild_local_knowledge_vector_index(app_state: &AppState) -> Result<usize, String> {
    let files = app_state
        .mcp
        .store
        .list_local_user_documents(LocalUserDocumentListQuery {
            folder_id: None,
            status: None,
            q: None,
        })
        .await
        .map_err(to_string)?;
    let mut indexed = 0usize;
    for file in files {
        let text = format!(
            "name: {}\nstatus: {}\nsize: {}\nchunks: {}",
            file.name,
            file.status,
            file.size,
            file.chunks.unwrap_or(0)
        );
        if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            let _ = app_state
                .memory
                .store
                .upsert_asset(
                    file.id,
                    file.name,
                    format!("local knowledge file ({})", file.file_type),
                    "knowledge_file".to_string(),
                    "local_knowledge".to_string(),
                    None,
                    vector,
                    None,
                )
                .await;
            indexed = indexed.saturating_add(1);
        }
    }
    Ok(indexed)
}

#[tauri::command]
pub async fn rebuild_local_embedding_assets(
    app: AppHandle,
    app_state: State<'_, AppState>,
) -> Result<LocalEmbeddingRebuildResponse, String> {
    emit_local_embedding_rebuild_progress(&app, "prepare", 0, 0, 0, 0, None);

    let probe_vector = app_state
        .providers
        .embedding
        .embed_text("local_embedding_rebuild_probe")
        .await
        .map_err(to_string)?;
    let vector_dimension = probe_vector.len();
    if vector_dimension == 0 {
        return Err("embedding model returned empty vector".to_string());
    }

    app_state
        .memory
        .store
        .recreate_local_asset_table(vector_dimension as i32)
        .await
        .map_err(to_string)?;

    let tools = app_state.mcp.store.list_tools().await.map_err(to_string)?;
    let assistants = app_state
        .mcp
        .store
        .list_local_assistants()
        .await
        .map_err(to_string)?;
    let enabled_assistant_ids = app_state
        .mcp
        .store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let local_knowledge_files = app_state
        .mcp
        .store
        .list_local_user_documents(LocalUserDocumentListQuery {
            folder_id: None,
            status: None,
            q: None,
        })
        .await
        .map_err(to_string)?;

    let assistant_candidates = assistants
        .into_iter()
        .filter(|assistant| enabled_assistant_ids.contains(assistant.id.as_str()))
        .collect::<Vec<_>>();
    let total = tools.len() + assistant_candidates.len() + local_knowledge_files.len();
    let mut processed = 0usize;
    let mut indexed = 0usize;
    let mut failed = 0usize;

    for tool in tools {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_tools",
            total,
            processed,
            indexed,
            failed,
            Some(tool.name.clone()),
        );
        let text = format!("name: {}\ndescription: {}", tool.name, tool.description);
        let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            app_state
                .memory
                .store
                .upsert_asset(
                    tool.id,
                    tool.name,
                    tool.description,
                    "tool".to_string(),
                    "mcp".to_string(),
                    tool.identifier,
                    vector,
                    None,
                )
                .await
                .is_ok()
        } else {
            false
        };
        processed = processed.saturating_add(1);
        if upserted {
            indexed = indexed.saturating_add(1);
        } else {
            failed = failed.saturating_add(1);
        }
    }

    for assistant in assistant_candidates {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_assistants",
            total,
            processed,
            indexed,
            failed,
            Some(assistant.name.clone()),
        );
        let tags = if assistant.tags.is_empty() {
            String::new()
        } else {
            assistant.tags.join(", ")
        };
        let text = format!(
            "name: {}\ndescription: {}\ntags: {}",
            assistant.name,
            assistant.description.as_deref().unwrap_or(""),
            tags
        );
        let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            app_state
                .memory
                .store
                .upsert_asset(
                    assistant.id,
                    assistant.name,
                    assistant.description.unwrap_or_default(),
                    "assistant".to_string(),
                    "local_assistant".to_string(),
                    None,
                    vector,
                    None,
                )
                .await
                .is_ok()
        } else {
            false
        };
        processed = processed.saturating_add(1);
        if upserted {
            indexed = indexed.saturating_add(1);
        } else {
            failed = failed.saturating_add(1);
        }
    }

    for file in local_knowledge_files {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_knowledge",
            total,
            processed,
            indexed,
            failed,
            Some(file.name.clone()),
        );
        let text = format!(
            "name: {}\nstatus: {}\nsize: {}\nchunks: {}",
            file.name,
            file.status,
            file.size,
            file.chunks.unwrap_or(0)
        );
        let upserted = if let Ok(vector) = app_state.providers.embedding.embed_text(&text).await {
            app_state
                .memory
                .store
                .upsert_asset(
                    file.id,
                    file.name,
                    format!("local knowledge file ({})", file.file_type),
                    "knowledge_file".to_string(),
                    "local_knowledge".to_string(),
                    None,
                    vector,
                    None,
                )
                .await
                .is_ok()
        } else {
            false
        };
        processed = processed.saturating_add(1);
        if upserted {
            indexed = indexed.saturating_add(1);
        } else {
            failed = failed.saturating_add(1);
        }
    }

    emit_local_embedding_rebuild_progress(
        &app,
        "completed",
        total,
        processed,
        indexed,
        failed,
        None,
    );

    Ok(LocalEmbeddingRebuildResponse {
        vector_dimension: vector_dimension as i64,
        total: total as i64,
        indexed: indexed as i64,
        failed: failed as i64,
    })
}

async fn resolve_local_model_connection(
    app_state: &AppState,
    requested_model: &str,
    requested_provider_model_id: Option<&str>,
) -> Result<LocalModelConnection, String> {
    if let Some(provider_model_id) = requested_provider_model_id {
        let provider_model_id = provider_model_id.trim();
        if !provider_model_id.is_empty() {
            let model_uuid = Uuid::parse_str(provider_model_id).map_err(to_string)?;
            let model = app_state
                .providers
                .store
                .get_model(&model_uuid)
                .await
                .map_err(to_string)?
                .ok_or_else(|| "provider model not found".to_string())?;
            return Ok(LocalModelConnection {
                provider_model_id: model.id.to_string(),
                model_id: model.model_id,
            });
        }
    }

    let models = app_state
        .providers
        .store
        .list_active_models()
        .await
        .map_err(to_string)?;
    if models.is_empty() {
        return Err("no active provider model configured".to_string());
    }
    let requested = requested_model.trim().to_lowercase();
    let selected = models
        .iter()
        .find(|model| {
            if requested.is_empty() {
                return false;
            }
            model.model_id.eq_ignore_ascii_case(&requested)
                || model
                    .unified_model_id
                    .as_deref()
                    .map(|value| value.eq_ignore_ascii_case(&requested))
                    .unwrap_or(false)
                || model
                    .display_name
                    .as_deref()
                    .map(|value| value.eq_ignore_ascii_case(&requested))
                    .unwrap_or(false)
        })
        .cloned()
        .unwrap_or_else(|| models[0].clone());

    Ok(LocalModelConnection {
        provider_model_id: selected.id.to_string(),
        model_id: selected.model_id,
    })
}

async fn request_provider_chat_completion(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    messages: Vec<LocalChatInputMessage>,
    tools: Option<serde_json::Value>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
) -> Result<serde_json::Value, String> {
    let provider_model_uuid = Uuid::parse_str(provider_model_id).map_err(to_string)?;
    let model = app_state
        .providers
        .store
        .get_model(&provider_model_uuid)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider model not found".to_string())?;
    let connection = app_state
        .providers
        .store
        .get_instance_connection(&model.instance_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance not found".to_string())?;

    let endpoint = build_upstream_endpoint(
        &connection.base_url,
        &model.upstream_path,
        connection.protocol.as_deref(),
        connection.auto_append_v1,
    );
    let mut body = serde_json::json!({
        "model": if model_id.trim().is_empty() { model.model_id.clone() } else { model_id.to_string() },
        "messages": messages,
        "stream": false
    });
    if let Some(temperature) = temperature {
        body["temperature"] = serde_json::json!(temperature);
    }
    if let Some(max_tokens) = max_tokens {
        body["max_tokens"] = serde_json::json!(max_tokens);
    }
    if let Some(tools) = tools {
        body["tools_catalog"] = tools;
    }

    let mut request = reqwest::Client::new().post(&endpoint).json(&body);
    if let Some(secret_key) = connection.secret_key.as_deref() {
        if !secret_key.trim().is_empty() {
            request = apply_provider_auth_headers(request, connection.protocol.as_deref(), secret_key);
        }
    }

    let response = request.send().await.map_err(to_string)?;
    let status = response.status();
    let raw_text = response.text().await.map_err(to_string)?;
    let raw_json = serde_json::from_str::<serde_json::Value>(&raw_text).ok();
    if !status.is_success() {
        return Err(extract_upstream_error_message(
            status,
            raw_json.as_ref(),
            raw_text.as_str(),
        ));
    }
    let raw = raw_json.ok_or_else(|| {
        format!(
            "failed to parse upstream json response (status={}): {}",
            status.as_u16(),
            truncate_upstream_body(raw_text.as_str(), 300)
        )
    })?;
    Ok(normalize_chat_completion_response(raw))
}

fn normalize_chat_completion_response(raw: serde_json::Value) -> serde_json::Value {
    if raw.get("content").is_some() && raw.get("tool_calls").is_some() {
        return raw;
    }

    let mut content = raw
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let mut normalized_tool_calls = Vec::<serde_json::Value>::new();

    if let Some(choice) = raw
        .get("choices")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
    {
        if let Some(message) = choice.get("message") {
            if content.is_empty() {
                content = message
                    .get("content")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string();
            }
            if let Some(tool_calls) = message.get("tool_calls").and_then(|value| value.as_array()) {
                for call in tool_calls {
                    let function_name = call
                        .get("function")
                        .and_then(|value| value.get("name"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    let arguments = call
                        .get("function")
                        .and_then(|value| value.get("arguments"))
                        .and_then(|value| value.as_str())
                        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
                        .unwrap_or_else(|| serde_json::json!({}));
                    normalized_tool_calls.push(serde_json::json!({
                        "id": call.get("id").and_then(|value| value.as_str()).unwrap_or_default(),
                        "name": function_name,
                        "arguments": arguments
                    }));
                }
            }
        }
    }

    serde_json::json!({
        "content": content,
        "tool_calls": normalized_tool_calls
    })
}

fn build_upstream_endpoint(
    base_url: &str,
    upstream_path: &str,
    protocol: Option<&str>,
    auto_append_v1: Option<bool>,
) -> String {
    let mut base = base_url.trim().trim_end_matches('/').to_string();
    let mut path = upstream_path.trim().trim_start_matches('/').to_string();

    let protocol = protocol.unwrap_or("openai").trim().to_ascii_lowercase();
    if protocol.contains("openai") && !protocol.contains("azure") {
        let append_v1 = auto_append_v1.unwrap_or_else(|| !has_versioned_path(base.as_str()));
        if append_v1 && !base.ends_with("/v1") {
            base = format!("{base}/v1");
        }
    }

    if path.is_empty() {
        if base.ends_with("/v1") {
            return format!("{}/chat/completions", base);
        }
        return format!("{}/v1/chat/completions", base);
    }

    if base.ends_with("/v1") {
        if let Some((head, tail)) = path.split_once('/') {
            if head.eq_ignore_ascii_case("v1") {
                path = tail.to_string();
            }
        } else if path.eq_ignore_ascii_case("v1") {
            path.clear();
        }
    }

    if path.is_empty() {
        return base;
    }

    format!("{base}/{path}")
}

fn apply_provider_auth_headers(
    request: reqwest::RequestBuilder,
    protocol: Option<&str>,
    secret_key: &str,
) -> reqwest::RequestBuilder {
    let secret_key = secret_key.trim();
    if secret_key.is_empty() {
        return request;
    }

    let protocol = protocol.unwrap_or("openai").trim().to_ascii_lowercase();
    if protocol.contains("anthropic") || protocol.contains("claude") {
        return request
            .header("x-api-key", secret_key)
            .header("anthropic-version", "2023-06-01");
    }
    if protocol.contains("azure") {
        return request.header("api-key", secret_key);
    }
    if protocol.contains("gemini") || protocol.contains("google") || protocol.contains("vertex") {
        return request.header("x-goog-api-key", secret_key);
    }

    request.bearer_auth(secret_key)
}

fn extract_upstream_error_message(
    status: reqwest::StatusCode,
    raw_json: Option<&serde_json::Value>,
    raw_text: &str,
) -> String {
    if let Some(message) = raw_json
        .and_then(|value| value.pointer("/error/message").and_then(|v| v.as_str()))
        .or_else(|| raw_json.and_then(|value| value.get("error")).and_then(|v| v.as_str()))
        .or_else(|| raw_json.and_then(|value| value.get("message")).and_then(|v| v.as_str()))
        .or_else(|| raw_json.and_then(|value| value.get("detail")).and_then(|v| v.as_str()))
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return message.to_string();
    }

    let text = raw_text.trim();
    if !text.is_empty() {
        let lower = text.to_ascii_lowercase();
        if !lower.starts_with("<!doctype html") && !lower.starts_with("<html") {
            return truncate_upstream_body(text, 300);
        }
    }

    format!("upstream status {}", status.as_u16())
}

fn truncate_upstream_body(text: &str, max_len: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_len {
        return trimmed.to_string();
    }
    let head = trimmed.chars().take(max_len).collect::<String>();
    format!("{head}...")
}

fn has_versioned_path(base_url: &str) -> bool {
    let without_query = base_url.split('?').next().unwrap_or(base_url);
    let path = if let Some((_, rest)) = without_query.split_once("://") {
        if let Some(path_idx) = rest.find('/') {
            &rest[path_idx + 1..]
        } else {
            ""
        }
    } else {
        without_query.trim_start_matches('/')
    };

    let segments: Vec<&str> = path.split('/').filter(|segment| !segment.is_empty()).collect();
    for (idx, segment) in segments.iter().enumerate() {
        if is_version_segment(segment) {
            return true;
        }
        if segment.eq_ignore_ascii_case("api")
            && segments
                .get(idx + 1)
                .map(|next| is_version_segment(next))
                .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

fn is_version_segment(segment: &str) -> bool {
    let normalized = segment.trim();
    if normalized.len() < 2 {
        return false;
    }
    let mut chars = normalized.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if first != 'v' && first != 'V' {
        return false;
    }
    chars.all(|ch| ch.is_ascii_digit() || ch == '.')
}

async fn execute_local_mcp_tool(tool: &McpTool, arguments: &Value) -> Result<Value, String> {
    let command = tool
        .command
        .clone()
        .ok_or_else(|| format!("tool {} has no executable command", tool.name))?;
    let mut cmd = tokio::process::Command::new(command);
    if let Some(args) = &tool.args {
        cmd.args(args);
    }
    if let Some(env) = &tool.env {
        cmd.envs(env);
    }
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(to_string)?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload = serde_json::json!({
            "method": tool.name,
            "arguments": arguments
        });
        let payload_bytes = serde_json::to_vec(&payload).map_err(to_string)?;
        stdin.write_all(&payload_bytes).await.map_err(to_string)?;
    }

    let output = child.wait_with_output().await.map_err(to_string)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "tool execution failed (exit={}): {}",
            output.status, stderr
        ));
    }
    if output.stdout.is_empty() {
        return Ok(serde_json::json!({ "ok": true }));
    }
    match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
        Ok(parsed) => Ok(parsed),
        Err(_) => Ok(serde_json::json!({
            "ok": true,
            "raw": String::from_utf8_lossy(&output.stdout).to_string()
        })),
    }
}

pub(crate) async fn sync_source_inner(
    state: &McpRuntimeState,
    source: McpSource,
    auth_token: Option<String>,
) -> Result<Vec<McpTool>, McpError> {
    let tools = match source.source_type {
        McpSourceType::Local => {
            let path = expand_path(&source.path_or_url);
            let config_json = read_local_mcp_config(&path)?;
            let config: McpConfigPayload = serde_json::from_str(&config_json)
                .map_err(|err| McpError::Storage(err.to_string()))?;
            apply_config_payload(state, &source, config).await?
        }
        McpSourceType::Cloud | McpSourceType::Modelscope | McpSourceType::Github | McpSourceType::Url => {
            let mut request = state.client.get(&source.path_or_url);
            if let Some(token) = auth_token {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
            let response = request
                .send()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;

            if !response.status().is_success() {
                return Err(McpError::Network(format!(
                    "failed to fetch cloud config: {}",
                    response.status()
                )));
            }

            let config: McpConfigPayload = response
                .json()
                .await
                .map_err(|err| McpError::Network(err.to_string()))?;
            apply_config_payload(state, &source, config).await?
        }
    };

    Ok(tools)
}

fn read_local_mcp_config(path: &Path) -> Result<String, McpError> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
                std::fs::create_dir_all(parent)
                    .map_err(|create_err| McpError::Storage(create_err.to_string()))?;
            }
            let default_config = r#"{"mcpServers":{}}"#;
            std::fs::write(path, default_config)
                .map_err(|write_err| McpError::Storage(write_err.to_string()))?;
            Ok(default_config.to_string())
        }
        Err(err) => Err(McpError::Storage(err.to_string())),
    }
}

async fn apply_config_payload(
    state: &McpRuntimeState,
    source: &McpSource,
    payload: McpConfigPayload,
) -> Result<Vec<McpTool>, McpError> {
    let mut tools = Vec::new();
    let is_read_only = source.source_type == McpSourceType::Cloud;

    for (name, config) in payload.mcp_servers {
        let identifier = format!("{}/{}", source.id, name);
        let existing_tool = state
            .store
            .get_tool_by_source_name(&source.id, &name)
            .await?;

        let tool = match existing_tool {
            Some(existing_tool) => {
                let config_json = serde_json::to_string(&config).unwrap();
                let config_hash = hash_config(&config_json);

                if config_hash == existing_tool.config_hash {
                    state
                        .store
                        .set_tool_status(&existing_tool.id, McpToolStatus::Healthy, None, None)
                        .await?;
                    existing_tool
                } else {
                    state
                        .store
                        .upsert_tool(ToolUpsert {
                            id: Some(existing_tool.id.clone()),
                            source_id: source.id.clone(),
                            identifier: Some(identifier),
                            name: name.clone(),
                            source_type: source.source_type.clone(),
                            status: McpToolStatus::Healthy,
                            ping_ms: None,
                            capabilities: config.capabilities.clone().unwrap_or_default(),
                            description: config.description.clone().unwrap_or_default(),
                            error: None,
                            command: config.command.clone(),
                            args: config.args.clone(),
                            env: config.env.clone(),
                            config_json,
                            config_hash,
                            pending_config_json: None,
                            pending_config_hash: None,
                            conflict_status: McpConflictStatus::None,
                            is_read_only,
                            is_new: existing_tool.is_new,
                        })
                        .await?
                }
            }
            None => {
                let config_json = serde_json::to_string(&config).unwrap();
                let config_hash = hash_config(&config_json);

                state
                    .store
                    .upsert_tool(ToolUpsert {
                        id: None,
                        source_id: source.id.clone(),
                        identifier: Some(identifier),
                        name: name.clone(),
                        source_type: source.source_type.clone(),
                        status: McpToolStatus::Healthy,
                        ping_ms: None,
                        capabilities: config.capabilities.unwrap_or_default(),
                        description: config.description.unwrap_or_default(),
                        error: None,
                        command: config.command,
                        args: config.args,
                        env: config.env,
                        config_json,
                        config_hash,
                        pending_config_json: None,
                        pending_config_hash: None,
                        conflict_status: McpConflictStatus::None,
                        is_read_only,
                        is_new: true,
                    })
                    .await?
            }
        };
        tools.push(tool);
    }

    Ok(tools)
}

fn hash_config(config_json: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(config_json.as_bytes());
    hex::encode(hasher.finalize())
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

pub(crate) async fn start_local_conversation_summary_worker(state: McpRuntimeState) {
    let mut interval = tokio::time::interval(Duration::from_secs(
        LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
    ));
    loop {
        interval.tick().await;
        if let Err(err) = process_next_local_conversation_summary_job(&state).await {
            warn!("conversation summary worker error: {}", err);
        }
    }
}

pub(crate) async fn start_local_periodic_worker(state: McpRuntimeState) {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        if let Err(err) = state.store.dispatch_due_local_conversation_summary_idle_tasks().await {
            warn!("periodic worker dispatch idle task error: {}", err);
        }
        if let Err(err) = state
            .store
            .cleanup_old_local_conversation_summary_jobs(7 * 24 * 60 * 60)
            .await
        {
            warn!("periodic worker cleanup old jobs error: {}", err);
        }
    }
}

async fn process_next_local_conversation_summary_job(state: &McpRuntimeState) -> Result<(), McpError> {
    process_next_local_conversation_summary_job_with_store(state.store.as_ref()).await
}

#[cfg_attr(not(test), allow(dead_code))]
async fn execute_or_queue_mcp_tool_call(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_name: String,
    arguments: Value,
    require_approval: bool,
) -> Result<Value, String> {
    execute_or_queue_mcp_tool_call_with_context(
        &crate::modules::mcp::ToolApprovalContext::default(),
        None,
        Vec::new(),
        None,
        store,
        pending_tool_calls,
        tool_name,
        arguments,
        require_approval,
    )
    .await
}

async fn execute_or_queue_mcp_tool_call_with_context(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    risk_level: Option<&str>,
    risk_reasons: Vec<String>,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    tool_name: String,
    arguments: Value,
    require_approval: bool,
) -> Result<Value, String> {
    let tool = store
        .get_tool_by_name(&tool_name)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", tool_name))?;

    if require_approval {
        let approval_token = Uuid::new_v4().to_string();
        let pending = if let Some(runtime) = runtime_state {
            runtime.build_pending_tool_call(
                tool_name.clone(),
                arguments.clone(),
                runtime.tool_fingerprint(&tool),
                approval_context.clone(),
            )
        } else {
            let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
            crate::modules::mcp::PendingToolCall {
                tool_name: tool_name.clone(),
                arguments: arguments.clone(),
                call_id: approval_context.call_id.clone(),
                execution_token: approval_context.execution_token.clone(),
                tool_fingerprint: tool.config_hash.clone(),
                created_at_unix_ms: now as i128,
                expires_at_unix_ms: now as i128 + 5 * 60 * 1000,
            }
        };
        let expires_in_ms = runtime_state
            .map(|runtime| runtime.pending_tool_call_ttl_ms())
            .unwrap_or(5 * 60 * 1000);
        pending_tool_calls.write().await.insert(
            approval_token.clone(),
            pending,
        );
        return Ok(serde_json::json!({
            "status": "REQUIRES_APPROVAL",
            "approval_token": approval_token,
            "tool_name": tool_name,
            "arguments": arguments,
            "description": tool.description,
            "risk_level": risk_level.unwrap_or("HIGH"),
            "risk_reasons": risk_reasons,
            "expires_in_ms": expires_in_ms,
        }));
    }

    execute_local_mcp_tool(&tool, &arguments).await
}

#[cfg_attr(not(test), allow(dead_code))]
async fn approve_mcp_tool_inner(
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> Result<Value, String> {
    approve_mcp_tool_inner_with_context(
        &crate::modules::mcp::ToolApprovalContext::default(),
        None,
        store,
        pending_tool_calls,
        approval_token,
    )
    .await
}

async fn approve_mcp_tool_inner_with_context(
    approval_context: &crate::modules::mcp::ToolApprovalContext,
    runtime_state: Option<&crate::modules::mcp::McpRuntimeState>,
    store: &crate::modules::mcp::store::McpStore,
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> Result<Value, String> {
    let now = time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000;
    let pending = pending_tool_calls
        .read()
        .await
        .get(approval_token)
        .cloned();
    let Some(pending) = pending else {
        return Err("pending tool call not found".to_string());
    };

    if pending.expires_at_unix_ms <= now as i128 {
        pending_tool_calls.write().await.remove(approval_token);
        return Err("approval token expired; please retry the action".to_string());
    }

    if let Some(expected_call_id) = pending.call_id.as_deref() {
        if approval_context.call_id.as_deref() != Some(expected_call_id) {
            return Err("approval context mismatch (call_id)".to_string());
        }
    }
    if let Some(expected_execution_token) = pending.execution_token.as_deref() {
        if approval_context.execution_token.as_deref() != Some(expected_execution_token) {
            return Err("approval context mismatch (execution_token)".to_string());
        }
    }

    let tool = store
        .get_tool_by_name(&pending.tool_name)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("tool {} not found", pending.tool_name))?;

    if let Some(runtime) = runtime_state {
        let current_fingerprint = runtime.tool_fingerprint(&tool);
        if current_fingerprint != pending.tool_fingerprint {
            pending_tool_calls.write().await.remove(approval_token);
            return Err("tool configuration changed after approval prompt; request was cancelled".to_string());
        }
    }

    let removed = pending_tool_calls.write().await.remove(approval_token);
    if removed.is_none() {
        return Err("pending tool call already consumed".to_string());
    }

    execute_local_mcp_tool(&tool, &pending.arguments).await
}

async fn reject_mcp_tool_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> bool {
    pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .is_some()
}

async fn process_next_local_conversation_summary_job_with_store(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<(), McpError> {
    let Some(job) = store.claim_next_local_conversation_summary_job().await? else {
        return Ok(());
    };

    let processing = async {
        let window = store.get_local_conversation_window(&job.session_id).await?;
        let summary = build_local_summary_from_window(&window.messages);
        if summary.trim().is_empty() {
            return Err(McpError::validation("conversation summary content is empty"));
        }
        store
            .persist_local_conversation_summary(&job.session_id, &summary, Some("local-worker"))
            .await?;
        Ok::<(), McpError>(())
    }
    .await;

    match processing {
        Ok(()) => store.complete_local_conversation_summary_job(&job.id).await,
        Err(err) => {
            let message = err.to_string();
            let _ = store
                .fail_local_conversation_summary_job(&job, &message, 30)
                .await;
            Err(err)
        }
    }
}

fn build_local_summary_from_window(messages: &[LocalConversationHistoryMessage]) -> String {
    let mut lines = Vec::new();
    for message in messages {
        let role = message.role.trim();
        let text = message
            .content
            .as_ref()
            .and_then(|value| {
                if let Some(text) = value.as_str() {
                    Some(text.to_string())
                } else {
                    serde_json::to_string(value).ok()
                }
            })
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_default();
        if text.is_empty() {
            continue;
        }
        lines.push(format!("{}: {}", role, text));
        if lines.len() >= LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES {
            break;
        }
    }

    if lines.is_empty() {
        return String::new();
    }

    let joined = lines.join("\n");
    truncate_text_chars(&joined, LOCAL_CONVERSATION_SUMMARY_MAX_CHARS)
}

async fn run_local_chat_complete_with_auto_code_mode(
    app: &AppHandle,
    app_state: &AppState,
    model_connection: &LocalModelConnection,
    messages: Vec<LocalChatInputMessage>,
    chat_ctx: &LocalConversationChatContext,
) -> Result<serde_json::Value, String> {
    let provider_model_id = &model_connection.provider_model_id;
    let model_id = &model_connection.model_id;
    let mut orchestrated_messages = messages;
    let mut round: usize = 0;
    let mut all_tool_call_meta: Vec<serde_json::Value> = Vec::new();

    loop {
        round = round.saturating_add(1);
        let search_query = orchestrated_messages
            .last()
            .map(|m| &m.content)
            .cloned()
            .unwrap_or_default();
        let tools = build_local_sdk_search_result(app_state, &search_query).await;

        let response = request_provider_chat_completion(
            app_state,
            provider_model_id,
            model_id,
            orchestrated_messages.clone(),
            Some(tools),
            None,
            None,
        )
            .await
            .map_err(to_string)?;

        let tool_calls = extract_chat_tool_calls(&response);
        if tool_calls.is_empty() {
            let mut enriched = response;
            if !all_tool_call_meta.is_empty() {
                enriched["tool_trace_blocks"] =
                    serde_json::Value::Array(build_local_tool_trace_blocks(&all_tool_call_meta));
            }
            return Ok(enriched);
        }

        let (synthesized, tool_call_meta, results) =
            maybe_handle_local_code_mode_tool_calls(app, app_state, &response, chat_ctx).await;
        if !synthesized {
            return Ok(response);
        }
        all_tool_call_meta.extend(tool_call_meta.iter().cloned());

        let tool_feedback = build_auto_code_mode_tool_feedback(round, &tool_call_meta, &results);
        let assistant_content = response
            .get("content")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        if !assistant_content.is_empty() {
            orchestrated_messages.push(LocalChatInputMessage {
                role: "assistant".to_string(),
                content: assistant_content,
            });
        }
        orchestrated_messages.push(LocalChatInputMessage {
            role: "user".to_string(),
            content: tool_feedback,
        });
    }
}

fn build_local_tool_trace_blocks(tool_call_meta: &[serde_json::Value]) -> Vec<serde_json::Value> {
    if tool_call_meta.is_empty() {
        return Vec::new();
    }

    let mut blocks = Vec::with_capacity(1 + tool_call_meta.len() * 2);
    blocks.push(serde_json::json!({
        "type": "execution_section",
        "title": "Local Tool Actions"
    }));

    for item in tool_call_meta {
        let tool_name = item
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown_tool");
        let call_id = item
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let status = item
            .get("status")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown");
        let call_status = if status.eq_ignore_ascii_case("success") {
            "success"
        } else if status.eq_ignore_ascii_case("running") {
            "running"
        } else {
            "error"
        };

        blocks.push(serde_json::json!({
            "type": "tool_call",
            "callId": call_id,
            "toolName": tool_name,
            "status": call_status,
        }));

        if status.eq_ignore_ascii_case("success") {
            blocks.push(serde_json::json!({
                "type": "tool_result",
                "callId": call_id,
                "toolName": tool_name,
                "status": "success",
                "result": item.get("result").cloned().unwrap_or_else(|| serde_json::json!({})),
            }));
        } else if status.eq_ignore_ascii_case("error") {
            blocks.push(serde_json::json!({
                "type": "tool_result",
                "callId": call_id,
                "toolName": tool_name,
                "status": "error",
                "result": {
                    "error": item.get("error").cloned().unwrap_or_else(|| serde_json::json!("tool call failed")),
                    "error_code": item.get("error_code").cloned().unwrap_or_else(|| serde_json::json!(null)),
                },
            }));
        }
    }

    blocks
}

const LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE: &str =
    "LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED";

fn build_local_tool_call_install_gate_error_meta(
    call_id: Option<&str>,
    tool_name: &str,
    error: &str,
) -> serde_json::Value {
    serde_json::json!({
        "id": call_id.unwrap_or_default(),
        "name": tool_name,
        "status": "error",
        "error": error,
        "error_code": LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE,
    })
}

async fn maybe_handle_local_code_mode_tool_calls(
    app: &AppHandle,
    app_state: &AppState,
    chat_response: &serde_json::Value,
    chat_ctx: &LocalConversationChatContext,
) -> (bool, Vec<serde_json::Value>, Vec<String>) {
    let tool_calls = extract_chat_tool_calls(chat_response);
    if tool_calls.is_empty() {
        return (false, Vec::new(), Vec::new());
    }

    let mut tool_call_meta = Vec::new();
    let mut results = Vec::new();
    let mut synthesized = false;

    for call in tool_calls {
        let tool_name = call.name.trim().to_lowercase();
        if tool_name == "execute_code_plan" {
            let code = call
                .arguments
                .get("code")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let language = call
                .arguments
                .get("language")
                .and_then(|v| v.as_str())
                .unwrap_or("python");
            let execution_timeout = call
                .arguments
                .get("execution_timeout")
                .and_then(|v| v.as_u64())
                .map(|v| v.max(1));
            let dry_run = call
                .arguments
                .get("dry_run")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);

            if !dry_run {
                synthesized = true;
                let error = "execute_code_plan requires explicit user-confirmed execution; auto-run is blocked";
                tool_call_meta.push(serde_json::json!({
                    "id": call.id,
                    "name": tool_name,
                    "status": "error",
                    "error_code": "CODE_MODE_APPROVAL_REQUIRED",
                    "error": error,
                }));
                results.push(format!("Code Execution Blocked [CODE_MODE_APPROVAL_REQUIRED]: {}", error));
                continue;
            }

            if !code.is_empty() {
                let execution_res =
                    crate::modules::code_mode::commands::execute_local_code_mode_inner(
                        app_state,
                        ExecuteLocalCodeModeRequest {
                            code: code.to_string(),
                            session_id: Some(chat_ctx.session_id.clone()),
                            language: Some(language.to_string()),
                            execution_timeout,
                            dry_run: Some(dry_run),
                            context: None,
                            max_calls: None,
                        },
                    )
                    .await;

                match execution_res {
                    Ok(res) => {
                        synthesized = true;
                        tool_call_meta.push(serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "success",
                            "result": res,
                        }));
                        results.push(format!(
                            "Code Execution Result:\n{}",
                            res.result.join("\n")
                        ));
                    }
                    Err(err) => {
                        tool_call_meta.push(serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "error",
                            "error": err.to_string(),
                        }));
                        results.push(format!("Code Execution Failed: {}", err));
                    }
                }
            }
        } else if tool_name == "search_sdk" {
            let query = call
                .arguments
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let search_res = build_local_sdk_search_result(app_state, query).await;
            synthesized = true;
            tool_call_meta.push(serde_json::json!({
                "id": call.id,
                "name": tool_name,
                "status": "success",
                "result": search_res,
            }));
            results.push(format!(
                "SDK Search Result for '{}':\n{}",
                query,
                serde_json::to_string_pretty(&search_res).unwrap()
            ));
        } else if tool_name == "sys_submit_onboarding_request" {
            let asset_type = call
                .arguments
                .get("asset_type")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let payload = call
                .arguments
                .get("payload")
                .cloned()
                .unwrap_or(serde_json::json!({}));

            if asset_type == "assistant" {
                let create_req: Result<crate::modules::mcp::types::CreateLocalAssistantRequest, _> =
                    serde_json::from_value(payload);
                if let Ok(req) = create_req {
                    match app_state.mcp.store.create_local_assistant(req).await {
                        Ok(id) => {
                            synthesized = true;
                            tool_call_meta.push(serde_json::json!({
                                "id": call.id,
                                "name": tool_name,
                                "status": "success",
                                "result": {"action": "created", "id": id},
                            }));
                            results.push(format!("Assistant created successfully with ID: {}", id));
                        }
                        Err(err) => {
                            tool_call_meta.push(serde_json::json!({
                                "id": call.id,
                                "name": tool_name,
                                "status": "error",
                                "error": err.to_string(),
                            }));
                        }
                    }
                }
            } else if asset_type == "skill" {
                match install_local_skill_from_onboarding_request(app, app_state, &payload).await {
                    Ok(result) => {
                        synthesized = true;
                        tool_call_meta.push(serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "success",
                            "result": result,
                        }));
                        results.push(format!(
                            "Skill onboarding request executed:\n{}",
                            serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
                        ));
                    }
                    Err(err) => {
                        synthesized = true;
                        tool_call_meta.push(serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "error",
                            "error": err,
                        }));
                        results.push(format!("Skill onboarding failed: {}", err));
                    }
                }
            }
        } else {
            synthesized = true;
            let error = format!(
                "tool '{}' is not installed or enabled in local desktop runtime",
                tool_name
            );
            tool_call_meta.push(build_local_tool_call_install_gate_error_meta(
                call.id.as_deref(),
                &tool_name,
                &error,
            ));
            results.push(format!(
                "Tool call '{}' failed [{}]: {}",
                tool_name, LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE, error
            ));
        }
    }

    (synthesized, tool_call_meta, results)
}

async fn build_local_sdk_search_result(app_state: &AppState, query: &str) -> serde_json::Value {
    let normalized = query.trim().to_lowercase();
    let enabled_assistant_ids = app_state
        .mcp
        .store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let enabled_skill_ids = app_state
        .mcp
        .store
        .list_enabled_local_skill_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let mut install_hints = Vec::new();
    let mut assistant_install_filtered_count = 0usize;
    let mut skill_install_filtered_count = 0usize;

    let mut catalog = vec![
        serde_json::json!({
            "name": "execute_code_plan",
            "description": "Execute python code in local sandbox and bridge (auto mode requires dry_run=true for safety)",
            "source": "code_mode_core",
            "parameters": {
                "code": "string(required)",
                "language": "string(optional, default=python)",
                "execution_timeout": "number(optional)",
                "dry_run": "boolean(optional)",
            }
        }),
        serde_json::json!({
            "name": "search_sdk",
            "description": "Search tool signatures in local desktop runtime",
            "source": "code_mode_core",
            "parameters": {
                "query": "string(optional)",
            }
        }),
        serde_json::json!({
            "name": "sys_submit_onboarding_request",
            "description": "Submit onboarding actions. For skill installation use asset_type='skill' and payload {repo_url, skill_name}.",
            "source": "code_mode_core",
            "parameters": {
                "asset_type": "string(required, oneof=assistant|skill)",
                "payload": "object(required)",
            }
        }),
    ];

    // Single Path Local Discovery via Unified Assets
    if !normalized.is_empty() {
        if let Ok(vector) = app_state.providers.embedding.embed_text(&normalized).await {
            if let Ok(asset_hits) = app_state.memory.store.search_assets(vector, 15, None).await {
                for hit in asset_hits {
                    let source_type = hit
                        .get("source_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let asset_type = hit
                        .get("asset_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let name = hit["name"].as_str().unwrap_or("").to_string();
                    let desc = hit["description"].as_str().unwrap_or("").to_string();
                    let pkg_name = hit.get("pkg_name").and_then(|v| v.as_str());
                    let asset_id = hit["id"].as_str().unwrap_or("").trim();
                    let is_enabled_installed = if asset_type == "assistant" {
                        !asset_id.is_empty() && enabled_assistant_ids.contains(asset_id)
                    } else if asset_type == "tool" {
                        pkg_name
                            .map(|pkg| enabled_skill_ids.contains(pkg.trim()))
                            .unwrap_or(true)
                    } else {
                        true
                    };

                    let item = serde_json::json!({
                        "name": name,
                        "description": desc,
                        "source": format!("local_{}", source_type),
                        "pkg_name": pkg_name,
                        "score": hit.get("_distance"),
                        "needs_provisioning": source_type == "cloud_mirror",
                        "asset_type": hit.get("asset_type"),
                        "callable": source_type != "cloud_mirror" && is_enabled_installed,
                        "assistant_id": if asset_type == "assistant" { Some(asset_id) } else { None::<&str> },
                    });

                    if source_type == "cloud_mirror" {
                        install_hints.push(item);
                        continue;
                    }

                    if !is_enabled_installed {
                        if asset_type == "assistant" {
                            assistant_install_filtered_count += 1;
                        } else if asset_type == "tool" {
                            skill_install_filtered_count += 1;
                        }
                        continue;
                    }

                    catalog.push(item);
                }
            }
        }
    }

    // Keep memory core tools always visible
    catalog.push(serde_json::json!({
        "name": "list_user_memories",
        "description": "List local memories for current desktop session",
        "source": "code_mode_bridge",
    }));

    let matches = catalog
        .into_iter()
        .filter(|item| {
            if normalized.is_empty() {
                return true;
            }
            let name_hit = item
                .get("name")
                .and_then(|v| v.as_str())
                .map(|n| n.to_lowercase().contains(&normalized))
                .unwrap_or(false);
            let desc_hit = item
                .get("description")
                .and_then(|v| v.as_str())
                .map(|d| d.to_lowercase().contains(&normalized))
                .unwrap_or(false);
            name_hit || desc_hit || item.get("score").is_some()
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "query": query,
        "mode": "unified_local_discovery",
        "items": matches,
        "install_hints": install_hints,
        "assistant_install_gate": {
            "enabled_installed_count": enabled_assistant_ids.len(),
            "filtered_out_count": assistant_install_filtered_count,
        },
        "skill_install_gate": {
            "enabled_installed_count": enabled_skill_ids.len(),
            "filtered_out_count": skill_install_filtered_count,
        }
    })
}

fn derive_skill_name_from_repo_url(repo_url: &str) -> String {
    let normalized_repo = repo_url.trim().trim_end_matches('/');
    let raw = normalized_repo
        .rsplit_once('/')
        .map(|(_, tail)| tail)
        .or_else(|| normalized_repo.rsplit_once(':').map(|(_, tail)| tail))
        .unwrap_or("skill")
        .trim_end_matches(".git")
        .trim();
    normalize_skill_dir_name(raw)
}

fn parse_skill_onboarding_payload(payload: &serde_json::Value) -> Result<(String, String), String> {
    let obj = payload
        .as_object()
        .ok_or_else(|| "skill onboarding payload must be an object".to_string())?;
    let repo_url = obj
        .get("repo_url")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "skill onboarding requires payload.repo_url".to_string())?;
    let skill_name = obj
        .get("skill_name")
        .or_else(|| obj.get("name"))
        .or_else(|| obj.get("skill_id"))
        .and_then(|value| value.as_str())
        .map(normalize_skill_dir_name)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| derive_skill_name_from_repo_url(&repo_url));

    Ok((repo_url, skill_name))
}

async fn install_local_skill_from_onboarding_request(
    app: &AppHandle,
    app_state: &AppState,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let (repo_url, skill_name) = parse_skill_onboarding_payload(payload)?;
    if !is_allowed_skill_repo_url(&repo_url) {
        return Err("skill onboarding only allows GitHub HTTPS/SSH repositories".to_string());
    }

    let install_result = execute_or_queue_mcp_tool_call_with_context(
        &crate::modules::mcp::ToolApprovalContext::default(),
        Some("HIGH"),
        vec!["local skill installation writes files under desktop skills directory".to_string()],
        Some(&app_state.mcp),
        app_state.mcp.store.as_ref(),
        app_state.mcp.pending_tool_calls.as_ref(),
        "install_skill_from_git".to_string(),
        serde_json::json!({
            "repo_url": repo_url,
            "skill_name": skill_name,
        }),
        true,
    )
    .await?;

    if install_result
        .get("status")
        .and_then(|value| value.as_str())
        .map(|value| value.eq_ignore_ascii_case("REQUIRES_APPROVAL"))
        .unwrap_or(false)
    {
        return Ok(serde_json::json!({
            "action": "skill_install_pending_approval",
            "install": install_result,
        }));
    }

    if install_result
        .get("status")
        .and_then(|value| value.as_str())
        .map(|value| value.eq_ignore_ascii_case("error"))
        .unwrap_or(false)
    {
        return Err(install_result
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("skill installer returned error")
            .to_string());
    }

    let indexed_tools = register_local_skills_inner(app.clone(), app_state).await?;
    Ok(serde_json::json!({
        "action": "skill_installed",
        "repo_url": repo_url,
        "skill_name": skill_name,
        "install": install_result,
        "index_refresh": {
            "status": "ok",
            "indexed_tools": indexed_tools
        }
    }))
}

fn extract_chat_tool_calls(response: &serde_json::Value) -> Vec<LocalChatToolCall> {
    let mut calls = Vec::new();
    if let Some(tc_array) = response.get("tool_calls").and_then(|v| v.as_array()) {
        for tc in tc_array {
            if let (Some(id), Some(name)) = (
                tc.get("id").and_then(|v| v.as_str()),
                tc.get("name").and_then(|v| v.as_str()),
            ) {
                calls.push(LocalChatToolCall {
                    id: Some(id.to_string()),
                    name: name.to_string(),
                    arguments: tc
                        .get("arguments")
                        .cloned()
                        .unwrap_or(serde_json::json!({})),
                });
            }
        }
    }
    calls
}

fn build_auto_code_mode_tool_feedback(
    round: usize,
    tool_call_meta: &[serde_json::Value],
    results: &[String],
) -> String {
    let payload = serde_json::json!({
        "round": round,
        "tool_calls": tool_call_meta,
        "results": results,
    });
    let serialized = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| {
        serde_json::json!({
            "round": round,
            "results": results,
        })
        .to_string()
    });
    let content = format!(
        "Auto tool execution round {} completed. Continue based on these tool results. If all tasks are complete, return the final answer.\n{}",
        round, serialized
    );
    truncate_text_chars(&content, LOCAL_CODE_MODE_TOOL_RESULTS_MAX_CHARS)
}

fn truncate_text_chars(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    if input.chars().count() <= max_chars {
        return input.to_string();
    }
    let mut out = input.chars().take(max_chars).collect::<String>();
    out.push_str("...");
    out
}

fn emit_local_chat_stream_payload(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    payload: serde_json::Value,
) {
    let mut envelope = serde_json::json!({
        "trace_id": trace_id,
    });
    if let Some(request_id) = request_id {
        if !request_id.trim().is_empty() {
            envelope["request_id"] = serde_json::json!(request_id);
        }
    }
    if let (Some(target), Some(source)) = (envelope.as_object_mut(), payload.as_object()) {
        for (key, value) in source {
            target.insert(key.to_string(), value.clone());
        }
    }
    if let Err(err) = app.emit(LOCAL_CHAT_STREAM_EVENT, envelope) {
        warn!("failed to emit local chat stream event: {}", err);
    }
}

fn emit_local_chat_stream_status(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    stage: &str,
    code: &str,
    meta: Option<serde_json::Value>,
) {
    emit_local_chat_stream_payload(
        app,
        request_id,
        trace_id,
        serde_json::json!({
            "type": "status",
            "stage": stage,
            "code": code,
            "meta": meta,
        }),
    );
}

fn emit_local_chat_stream_blocks(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    blocks: serde_json::Value,
) {
    emit_local_chat_stream_payload(
        app,
        request_id,
        trace_id,
        serde_json::json!({
            "type": "blocks",
            "blocks": blocks,
        }),
    );
}

fn emit_local_chat_stream_error(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    message: &str,
) {
    emit_local_chat_stream_payload(
        app,
        request_id,
        trace_id,
        serde_json::json!({
            "type": "error",
            "code": "local_chat_failed",
            "message": message,
        }),
    );
}

fn emit_local_chat_stream_done(app: &AppHandle, request_id: Option<&str>, trace_id: &str) {
    emit_local_chat_stream_payload(
        app,
        request_id,
        trace_id,
        serde_json::json!({
            "type": "done",
        }),
    );
}

fn emit_local_chat_stream_delta_chunks(
    app: &AppHandle,
    request_id: Option<&str>,
    trace_id: &str,
    content: &str,
) {
    if content.is_empty() {
        return;
    }

    let mut chunk = String::new();
    let mut chunk_chars = 0usize;
    for ch in content.chars() {
        chunk.push(ch);
        chunk_chars += 1;
        if chunk_chars >= LOCAL_CHAT_STREAM_DELTA_CHUNK_CHARS {
            emit_local_chat_stream_payload(
                app,
                request_id,
                trace_id,
                serde_json::json!({
                    "type": "delta",
                    "delta": chunk,
                }),
            );
            chunk = String::new();
            chunk_chars = 0;
        }
    }

    if !chunk.is_empty() {
        emit_local_chat_stream_payload(
            app,
            request_id,
            trace_id,
            serde_json::json!({
                "type": "delta",
                "delta": chunk,
            }),
        );
    }
}

const LOCAL_CONVERSATION_SUMMARY_MAX_CHARS: usize = 2000;
const LOCAL_CODE_MODE_TOOL_RESULTS_MAX_CHARS: usize = 8000;
const LOCAL_CHAT_STREAM_EVENT: &str = "local-chat-stream";
const LOCAL_CHAT_STREAM_DELTA_CHUNK_CHARS: usize = 64;
const LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES: usize = 8;
const LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS: u64 = 2;
