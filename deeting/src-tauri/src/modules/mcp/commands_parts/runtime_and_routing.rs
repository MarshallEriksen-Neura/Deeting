use super::{
    bootstrap_and_registry_impl::{
        install_skill_to_local, normalize_skill_dir_name, to_string, LocalModelConnection,
    },
    support::*,
};

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
    pub memory_total: i64,
    pub memory_indexed: i64,
    pub memory_failed: i64,
    pub asset_total: i64,
    pub asset_indexed: i64,
    pub asset_failed: i64,
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
                .service
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

    let memories = app_state
        .memory
        .store
        .list_all_memories()
        .await
        .map_err(to_string)?;

    app_state
        .memory
        .service
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
    let memory_total = memories.len();
    let asset_total = tools.len() + assistant_candidates.len() + local_knowledge_files.len();
    let total = memory_total + asset_total;
    let mut processed = 0usize;
    let mut indexed = 0usize;
    let mut failed = 0usize;
    let mut memory_indexed = 0usize;
    let mut memory_failed = 0usize;
    let mut asset_indexed = 0usize;
    let mut asset_failed = 0usize;

    let mut rebuilt_memories = Vec::with_capacity(memories.len());
    for memory in memories {
        emit_local_embedding_rebuild_progress(
            &app,
            "indexing_memories",
            total,
            processed,
            indexed,
            failed,
            Some(memory.content.chars().take(48).collect()),
        );

        let embedding = match app_state.providers.embedding.embed_text(&memory.content).await {
            Ok(vector) => {
                indexed = indexed.saturating_add(1);
                memory_indexed = memory_indexed.saturating_add(1);
                Some(vector)
            }
            Err(error) => {
                log::warn!("memory rebuild embedding failed for {}: {}", memory.id, error);
                failed = failed.saturating_add(1);
                memory_failed = memory_failed.saturating_add(1);
                None
            }
        };

        processed = processed.saturating_add(1);
        rebuilt_memories.push((memory, embedding));
    }

    app_state
        .memory
        .store
        .recreate_local_memory_table(vector_dimension as i32)
        .await
        .map_err(to_string)?;

    for (memory, embedding) in rebuilt_memories {
        let embedding_model = if embedding.is_some() {
            Some("rebuild".to_string())
        } else {
            None
        };

        app_state
            .memory
            .store
            .insert_memory_record(&memory, embedding, embedding_model)
            .await
            .map_err(to_string)?;
    }

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
                .service
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
            asset_indexed = asset_indexed.saturating_add(1);
        } else {
            failed = failed.saturating_add(1);
            asset_failed = asset_failed.saturating_add(1);
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
                .service
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
            asset_indexed = asset_indexed.saturating_add(1);
        } else {
            failed = failed.saturating_add(1);
            asset_failed = asset_failed.saturating_add(1);
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
            asset_indexed = asset_indexed.saturating_add(1);
        } else {
            failed = failed.saturating_add(1);
            asset_failed = asset_failed.saturating_add(1);
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
        memory_total: memory_total as i64,
        memory_indexed: memory_indexed as i64,
        memory_failed: memory_failed as i64,
        asset_total: asset_total as i64,
        asset_indexed: asset_indexed as i64,
        asset_failed: asset_failed as i64,
    })
}

pub(crate) async fn resolve_local_model_connection(
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

    // 1. Try exact name match first
    let exact_match = models.iter().find(|model| {
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
    });

    // 2. If exact match found, use it directly
    if let Some(matched) = exact_match {
        return Ok(LocalModelConnection {
            provider_model_id: matched.id.to_string(),
            model_id: matched.model_id.clone(),
        });
    }

    // 3. No exact match — use epsilon-greedy bandit selection among all active models
    let selected = select_model_by_bandit(app_state, &models).await;

    Ok(LocalModelConnection {
        provider_model_id: selected.id.to_string(),
        model_id: selected.model_id.clone(),
    })
}

/// Epsilon-greedy bandit selection: with probability epsilon pick a random model,
/// otherwise pick the model with the highest success rate (successes / total_trials).
/// Models in cooldown are excluded from selection. Falls back to models[0] if all are
/// in cooldown or no bandit data exists.
async fn select_model_by_bandit(
    app_state: &AppState,
    models: &[crate::modules::providers::types::ProviderModel],
) -> crate::modules::providers::types::ProviderModel {
    use crate::modules::providers::store::BANDIT_DEFAULT_SCENE;

    let current_time_rfc3339 = now_rfc3339();
    let arms = app_state
        .providers
        .store
        .list_bandit_arm_states(Some(BANDIT_DEFAULT_SCENE.to_string()))
        .await
        .unwrap_or_default();

    // Build arm lookup: arm_id → BanditArmState
    let arm_map: std::collections::HashMap<String, &crate::modules::providers::types::BanditArmState> = arms
        .iter()
        .filter_map(|arm| arm.arm_id.as_ref().map(|id| (id.clone(), arm)))
        .collect();

    // Filter out models that are in cooldown
    let eligible: Vec<&crate::modules::providers::types::ProviderModel> = models
        .iter()
        .filter(|m| {
            let arm_id = m.id.to_string();
            match arm_map.get(&arm_id) {
                Some(arm) => match &arm.cooldown_until {
                    Some(until) => until.as_str() <= current_time_rfc3339.as_str(),
                    None => true,
                },
                None => true, // no bandit data yet — eligible
            }
        })
        .collect();

    // If all models are in cooldown, fall back to first model
    if eligible.is_empty() {
        return models[0].clone();
    }

    // If only one eligible model, use it
    if eligible.len() == 1 {
        return eligible[0].clone();
    }

    // Determine epsilon from the first arm that has config, or default 0.1
    let epsilon = arm_map
        .values()
        .next()
        .map(|arm| arm.epsilon)
        .unwrap_or(0.1);

    // Epsilon-greedy: explore with probability epsilon, exploit otherwise
    let rand_val: f64 = {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut hasher = DefaultHasher::new();
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            .hash(&mut hasher);
        (hasher.finish() % 10000) as f64 / 10000.0
    };

    if rand_val < epsilon {
        // Explore: pick random eligible model
        let idx = (rand_val * 10000.0) as usize % eligible.len();
        return eligible[idx].clone();
    }

    // Exploit: pick eligible model with highest success rate
    eligible
        .into_iter()
        .max_by(|a, b| {
            let rate_a = arm_map
                .get(&a.id.to_string())
                .map(|arm| {
                    if arm.total_trials > 0 {
                        arm.successes as f64 / arm.total_trials as f64
                    } else {
                        0.5 // optimistic prior for untried models
                    }
                })
                .unwrap_or(0.5);
            let rate_b = arm_map
                .get(&b.id.to_string())
                .map(|arm| {
                    if arm.total_trials > 0 {
                        arm.successes as f64 / arm.total_trials as f64
                    } else {
                        0.5
                    }
                })
                .unwrap_or(0.5);
            rate_a.partial_cmp(&rate_b).unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned()
        .unwrap_or_else(|| models[0].clone())
}

async fn request_platform_chat_via_proxy(
    app_state: &AppState,
    model_id: &str,
    messages: Vec<LocalChatInputMessage>,
    tools: Option<serde_json::Value>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    trace_id: Option<&str>,
    session_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let base_url = app_state.mcp.cloud_base_url.read().await.clone();
    let base_url = base_url.trim().trim_end_matches('/');
    if base_url.is_empty() {
        return Err("cloud API base URL not configured; set api.base_url for platform models".to_string());
    }
    let url = format!("{}/api/v1/credits/chat/completions", base_url);

    let mut body = serde_json::json!({
        "model": model_id.trim(),
        "messages": messages,
        "stream": false
    });
    if let Some(t) = temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(m) = max_tokens {
        body["max_tokens"] = serde_json::json!(m);
    }
    if let Some(ref t) = tools {
        body["tools"] = t.clone();
    }
    if let Some(id) = trace_id.filter(|s| !s.trim().is_empty()) {
        body["trace_id"] = serde_json::json!(id);
    }
    if let Some(id) = session_id.filter(|s| !s.trim().is_empty()) {
        body["session_id"] = serde_json::json!(id);
    }

    let mut request = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .header("Content-Type", "application/json");

    if let Some(token) = app_state
        .mcp
        .store
        .get_desktop_config("auth.token")
        .await
        .ok()
        .flatten()
    {
        let token = token.trim();
        if !token.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", token));
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
            &raw_text,
        ));
    }

    let out = raw_json.ok_or_else(|| {
        format!(
            "credits proxy returned non-json (status={}): {}",
            status.as_u16(),
            truncate_upstream_body(&raw_text, 300)
        )
    })?;
    Ok(normalize_chat_completion_response(out))
}

pub(crate) async fn request_provider_chat_completion(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    messages: Vec<LocalChatInputMessage>,
    tools: Option<serde_json::Value>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    trace_id: Option<&str>,
    session_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let provider_model_uuid = Uuid::parse_str(provider_model_id).map_err(to_string)?;
    let model = app_state
        .providers
        .store
        .get_model(&provider_model_uuid)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider model not found".to_string())?;
    let instance = app_state
        .providers
        .store
        .get_instance(&model.instance_id.to_string())
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance not found".to_string())?;
    let connection = app_state
        .providers
        .store
        .get_instance_connection(&model.instance_id.to_string())
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance connection not found".to_string())?;

    if connection
        .credential_source
        .as_deref()
        .map(|s| s.eq_ignore_ascii_case("platform"))
        .unwrap_or(false)
    {
        let effective_model = if model_id.trim().is_empty() {
            model.model_id.as_str()
        } else {
            model_id
        };
        return request_platform_chat_via_proxy(
            app_state,
            effective_model,
            messages,
            tools,
            temperature,
            max_tokens,
            trace_id,
            session_id,
        )
        .await;
    }

    let effective_model = if model_id.trim().is_empty() {
        model.model_id.clone()
    } else {
        model_id.to_string()
    };
    let preset = app_state
        .providers
        .store
        .get_preset(&instance.preset_slug)
        .await
        .map_err(to_string)?;
    let mut body = serde_json::json!({
        "model": effective_model,
        "messages": messages,
        "stream": false
    });
    if let Some(temperature) = temperature {
        body["temperature"] = serde_json::json!(temperature);
    }
    if let Some(max_tokens) = max_tokens {
        body["max_tokens"] = serde_json::json!(max_tokens);
    }
    let prepared = crate::modules::providers::request_runtime::prepare_provider_request(
        preset.as_ref(),
        &instance,
        &model,
        connection.secret_key.as_deref(),
        "chat",
        body,
        tools.as_ref(),
        trace_id,
    )?;

    let call_start = std::time::Instant::now();
    let response = crate::modules::providers::request_runtime::send_prepared_json_request(
        &reqwest::Client::new(),
        &prepared,
    )
    .await?;
    let status = response.status;
    let latency_ms = call_start.elapsed().as_millis() as f64;
    let raw_text = response.text;
    let raw_json = response.json;

    let success = status.is_success();

    // Record bandit feedback for this model arm
    {
        let arm_id = provider_model_id.to_string();
        let feedback = crate::modules::providers::types::BanditFeedbackRequest {
            scene: None, // uses BANDIT_DEFAULT_SCENE
            arm_id,
            success,
            latency_ms: Some(latency_ms),
            cost: None,
            reward: Some(if success { 1.0 } else { 0.0 }),
            routing_config: None,
            reward_metric_type: None,
        };
        if let Err(err) = app_state.providers.store.record_bandit_feedback(feedback).await {
            log::warn!("failed to record bandit feedback: {}", err);
        }
    }

    if !success {
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

    let transformed = app_state.providers.transformer.transform(
        prepared.template_engine.as_str(),
        Some(prepared.response_decoder.as_str()),
        &prepared.response_transform,
        raw,
        status.as_u16(),
    );

    Ok(normalize_chat_completion_response(transformed))
}

pub(crate) fn normalize_chat_completion_response(raw: serde_json::Value) -> serde_json::Value {
    if raw.get("content").is_some() && raw.get("tool_calls").is_some() {
        return raw;
    }

    let mut content = raw
        .get("content")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let mut reasoning_content = raw
        .get("reasoning_content")
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
            if reasoning_content.is_empty() {
                reasoning_content = message
                    .get("reasoning_content")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string();
            }
            if let Some(tool_calls) = message.get("tool_calls").and_then(|value| value.as_array()) {
                for call in tool_calls {
                    let (function_name, arguments) = if let Some(func) = call.get("function") {
                        (
                            func.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                            func.get("arguments")
                                .and_then(|v| {
                                    if let Some(s) = v.as_str() {
                                        serde_json::from_str::<serde_json::Value>(s).ok()
                                    } else {
                                        Some(v.clone())
                                    }
                                })
                                .unwrap_or_else(|| serde_json::json!({})),
                        )
                    } else {
                        (
                            call.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                            call.get("arguments").cloned().unwrap_or_else(|| serde_json::json!({})),
                        )
                    };

                    normalized_tool_calls.push(serde_json::json!({
                        "id": call.get("id").and_then(|value| value.as_str()).unwrap_or_default(),
                        "name": function_name,
                        "arguments": arguments
                    }));
                }
            }
        }
    }

    if normalized_tool_calls.is_empty() {
        if let Some(tc_array) = raw.get("tool_calls").and_then(|v| v.as_array()) {
            normalized_tool_calls.extend(tc_array.iter().cloned());
        }
    }

    let mut result = serde_json::json!({
        "content": content,
        "tool_calls": normalized_tool_calls
    });
    if !reasoning_content.is_empty() {
        result["reasoning_content"] = serde_json::json!(reasoning_content);
    }
    result
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

fn parse_timeout_from_tool(tool: &McpTool) -> u64 {
    serde_json::from_str::<serde_json::Value>(&tool.config_json)
        .ok()
        .and_then(|v| v.get("execution")?.get("timeout_seconds")?.as_u64())
        .unwrap_or(60)
}

/// Marker sentinel printed by DeetingRuntime.call_tool() in Marker mode.
/// Must match packages/code-mode-contract/contract.json → markers.runtime_tool_call
const TOOL_CALL_MARKER: &str = "__DEETING_TOOL_CALL_REQUEST__";
const MAX_MARKER_REEXEC: usize = 8;
const DESKTOP_CONFIG_SCOUT_BASE_URL_KEY: &str = "scout.base_url";

async fn execute_local_mcp_tool(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
    arguments: &Value,
) -> Result<Value, String> {
    let timeout_secs = parse_timeout_from_tool(tool);
    let mut tool_results: Vec<serde_json::Value> = Vec::new();

    for attempt in 0..=MAX_MARKER_REEXEC {
        let output = spawn_skill_subprocess(store, tool, arguments, &tool_results, timeout_secs).await?;
        let stdout_str = String::from_utf8_lossy(&output.stdout);

        // Check for Marker protocol: SDK call_tool() prints the marker then exits non-zero
        if let Some(marker_payload) = extract_tool_call_marker(&stdout_str) {
            let requested_tool = marker_payload
                .get("tool_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let _requested_args = marker_payload
                .get("arguments")
                .cloned()
                .unwrap_or(serde_json::json!({}));

            if requested_tool.is_empty() {
                return Err("skill requested a tool call with empty tool_name".to_string());
            }
            if attempt >= MAX_MARKER_REEXEC {
                return Err(format!(
                    "skill exceeded {} marker re-execution rounds",
                    MAX_MARKER_REEXEC
                ));
            }

            log::info!(
                "marker re-exec #{}: skill {} requests tool {}",
                attempt + 1,
                tool.name,
                requested_tool
            );

            // TODO: resolve and execute the requested tool, then push result.
            // For now, push a placeholder — full cross-tool dispatch requires
            // access to the tool registry, which will be wired in a follow-up.
            let inner_result = serde_json::json!({
                "status": "error",
                "error": format!("cross-tool call to '{}' not yet supported in desktop Marker mode", requested_tool)
            });
            tool_results.push(inner_result);
            continue;
        }

        // Normal exit path
        if output.status.success() {
            if output.stdout.is_empty() {
                return Ok(serde_json::json!({ "ok": true }));
            }
            return match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                Ok(parsed) => Ok(parsed),
                Err(_) => Ok(serde_json::json!({
                    "ok": true,
                    "raw": stdout_str.to_string()
                })),
            };
        }

        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(format!(
            "tool execution failed (exit={}): {}",
            output.status, stderr
        ));
    }

    Err("skill marker re-execution loop exhausted".to_string())
}

/// Spawn the skill subprocess with optional DEETING_RUNTIME_CONTEXT for
/// Marker-mode re-execution (passing cached tool_results).
async fn spawn_skill_subprocess(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
    arguments: &Value,
    tool_results: &[serde_json::Value],
    timeout_secs: u64,
) -> Result<std::process::Output, String> {
    let command = tool
        .command
        .clone()
        .ok_or_else(|| format!("tool {} has no executable command", tool.name))?;
    let mut cmd = tokio::process::Command::new(command);
    if let Some(args) = &tool.args {
        cmd.args(args);
    }
    if let Some(env) = resolve_skill_env(store, tool).await? {
        cmd.envs(env);
    }

    // Inject runtime context for Marker re-execution
    if !tool_results.is_empty() {
        let ctx = serde_json::json!({
            "tool_results": tool_results,
            "max_tool_calls": MAX_MARKER_REEXEC,
        });
        cmd.env(
            "DEETING_RUNTIME_CONTEXT",
            serde_json::to_string(&ctx).unwrap_or_default(),
        );
    }

    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd.spawn().map_err(to_string)?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload = serde_json::json!({
            "method": tool.name,
            "arguments": arguments
        });
        let payload_bytes = serde_json::to_vec(&payload).map_err(to_string)?;
        stdin.write_all(&payload_bytes).await.map_err(to_string)?;
    }

    match tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        child.wait_with_output(),
    )
    .await
    {
        Ok(result) => result.map_err(|e| format!("tool execution error: {}", e)),
        Err(_) => {
            Err(format!(
                "skill execution timed out after {}s",
                timeout_secs
            ))
        }
    }
}

pub(crate) async fn resolve_skill_env(
    store: &crate::modules::mcp::store::McpStore,
    tool: &McpTool,
) -> Result<Option<std::collections::HashMap<String, String>>, String> {
    let mut env = tool.env.clone().unwrap_or_default();

    let is_official_crawler_tool = tool
        .identifier
        .as_deref()
        .map(|identifier| identifier.starts_with("official.skills.crawler/"))
        .unwrap_or(matches!(tool.name.as_str(), "fetch_web_content" | "crawl_website"));

    if is_official_crawler_tool {
        env.remove("SCOUT_SERVICE_URL");

        let override_url = store
            .get_desktop_config(DESKTOP_CONFIG_SCOUT_BASE_URL_KEY)
            .await
            .map_err(to_string)?;
        if let Some(normalized) = override_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.trim_end_matches('/').to_string())
        {
            env.insert("SCOUT_SERVICE_URL".to_string(), normalized);
        } else if let Ok(runtime_env) = std::env::var("SCOUT_SERVICE_URL") {
            let normalized = runtime_env.trim().trim_end_matches('/').to_string();
            if !normalized.is_empty() {
                env.insert("SCOUT_SERVICE_URL".to_string(), normalized);
            }
        }
    }

    if env.is_empty() {
        Ok(None)
    } else {
        Ok(Some(env))
    }
}

/// Extract Marker tool-call request from subprocess stdout.
fn extract_tool_call_marker(stdout: &str) -> Option<serde_json::Value> {
    for line in stdout.lines().rev() {
        let trimmed = line.trim();
        if let Some(json_str) = trimmed.strip_prefix(TOOL_CALL_MARKER) {
            let json_str = json_str.trim();
            if json_str.is_empty() {
                return Some(serde_json::json!({}));
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                return Some(parsed);
            }
            return Some(serde_json::json!({}));
        }
    }
    None
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

pub(crate) fn read_local_mcp_config(path: &Path) -> Result<String, McpError> {
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

pub(crate) async fn apply_config_payload(
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

pub(crate) fn hash_config(config_json: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(config_json.as_bytes());
    hex::encode(hasher.finalize())
}

pub(crate) fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

pub(crate) async fn start_local_conversation_summary_worker(app_state: AppState) {
    let mut interval = tokio::time::interval(Duration::from_secs(
        LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS,
    ));
    loop {
        interval.tick().await;
        if let Err(err) = process_next_local_conversation_summary_job(&app_state).await {
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

async fn process_next_local_conversation_summary_job(app_state: &AppState) -> Result<(), McpError> {
    process_next_local_conversation_summary_job_inner(Some(app_state), app_state.mcp.store.as_ref()).await
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn execute_or_queue_mcp_tool_call(
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

pub(crate) async fn execute_or_queue_mcp_tool_call_with_context(
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

    execute_local_mcp_tool(store, &tool, &arguments).await
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn approve_mcp_tool_inner(
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

pub(crate) async fn approve_mcp_tool_inner_with_context(
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

    execute_local_mcp_tool(store, &tool, &pending.arguments).await
}

pub(crate) async fn reject_mcp_tool_inner(
    pending_tool_calls: &tokio::sync::RwLock<HashMap<String, crate::modules::mcp::PendingToolCall>>,
    approval_token: &str,
) -> bool {
    pending_tool_calls
        .write()
        .await
        .remove(approval_token)
        .is_some()
}

#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn process_next_local_conversation_summary_job_with_store(
    store: &crate::modules::mcp::store::McpStore,
) -> Result<(), McpError> {
    process_next_local_conversation_summary_job_inner(None, store).await
}

async fn process_next_local_conversation_summary_job_inner(
    app_state: Option<&AppState>,
    store: &crate::modules::mcp::store::McpStore,
) -> Result<(), McpError> {
    let Some(job) = store.claim_next_local_conversation_summary_job().await? else {
        return Ok(());
    };

    let processing = async {
        let window = store
            .load_local_conversation_runtime_window(&job.session_id)
            .await?;
        let model_summary = if let Some(app_state) = app_state {
            let meta = window.meta.as_ref();
            let model_id = meta
                .and_then(|value| value.get("last_model_id"))
                .and_then(|value| value.as_str())
                .map(|value| value.trim())
                .filter(|value| !value.is_empty());
            let provider_model_id = meta
                .and_then(|value| value.get("last_provider_model_id"))
                .and_then(|value| value.as_str())
                .map(|value| value.trim())
                .filter(|value| !value.is_empty());

            if let (Some(model_id), Some(provider_model_id)) = (model_id, provider_model_id) {
                match generate_local_conversation_summary_with_model(
                    app_state,
                    provider_model_id,
                    model_id,
                    &window.messages,
                    Some(job.session_id.as_str()),
                )
                .await
                {
                    Ok(Some(summary)) if !summary.trim().is_empty() => Some((summary, model_id.to_string())),
                    Ok(_) => None,
                    Err(err) => {
                        log::warn!(
                            "local conversation model summary failed session={} err={}",
                            job.session_id,
                            err
                        );
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        };

        let (summary, summarizer_model) = model_summary.unwrap_or_else(|| {
            (
                build_local_summary_from_window(&window.messages),
                "local-worker".to_string(),
            )
        });
        if summary.trim().is_empty() {
            return Err(McpError::validation("conversation summary content is empty"));
        }
        store
            .persist_local_conversation_summary(
                &job.session_id,
                &summary,
                Some(summarizer_model.as_str()),
            )
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

fn extract_text_from_history_message(message: &LocalConversationHistoryMessage) -> Option<String> {
    message
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
}

fn build_local_summary_source_lines(
    messages: &[LocalConversationHistoryMessage],
    max_items: Option<usize>,
) -> Vec<String> {
    let mut lines = Vec::new();
    for message in messages {
        let role = message.role.trim();
        let Some(text) = extract_text_from_history_message(message) else {
            continue;
        };
        lines.push(format!("{}: {}", role, text));
        if max_items
            .map(|value| lines.len() >= value)
            .unwrap_or(false)
        {
            break;
        }
    }

    lines
}

fn build_local_summary_from_window(messages: &[LocalConversationHistoryMessage]) -> String {
    let lines = build_local_summary_source_lines(
        messages,
        Some(LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES),
    );

    if lines.is_empty() {
        return String::new();
    }

    let joined = lines.join("\n");
    truncate_text_chars(&joined, LOCAL_CONVERSATION_SUMMARY_MAX_CHARS)
}

fn build_local_summary_prompt_input(messages: &[LocalConversationHistoryMessage]) -> String {
    let lines = build_local_summary_source_lines(messages, None);
    if lines.is_empty() {
        return String::new();
    }
    truncate_text_chars(&lines.join("\n"), LOCAL_CONVERSATION_SUMMARY_PROMPT_INPUT_MAX_CHARS)
}

fn extract_text_from_chat_completion_response(response_body: &serde_json::Value) -> Option<String> {
    if let Some(content) = response_body.get("content").and_then(|value| value.as_str()) {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(choice) = response_body
        .get("choices")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
    {
        if let Some(message_content) = choice
            .get("message")
            .and_then(|value| value.get("content"))
            .and_then(|value| value.as_str())
        {
            let trimmed = message_content.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        if let Some(text) = choice.get("text").and_then(|value| value.as_str()) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    response_body
        .get("completion")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn sanitize_generated_title(title: &str, fallback: &str) -> Option<String> {
    let mut text = title.trim().replace(['\n', '\r'], " ");
    text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    text = text
        .trim_matches(|ch| matches!(ch, '“' | '”' | '"' | '\'' | '`'))
        .trim_matches(|ch| matches!(ch, ' ' | '-' | '–' | '—' | '·' | '•' | ':' | '：'))
        .to_string();

    if text.is_empty() {
        text = fallback.trim().to_string();
    }
    if text.is_empty() {
        return None;
    }

    Some(truncate_text_chars(&text, LOCAL_CONVERSATION_TOPIC_TITLE_MAX_CHARS))
}

pub(crate) async fn request_local_auxiliary_text(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    prompt: &str,
    max_tokens: u32,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let response = request_provider_chat_completion(
        app_state,
        provider_model_id,
        model_id,
        vec![LocalChatInputMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
        }],
        None,
        Some(LOCAL_CONVERSATION_AUXILIARY_TEMPERATURE),
        Some(max_tokens),
        None,
        session_id,
    )
    .await?;

    Ok(extract_text_from_chat_completion_response(&response))
}

pub(crate) async fn generate_local_conversation_title_with_model(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    first_message: &str,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let normalized_first_message = first_message.trim();
    if normalized_first_message.is_empty() {
        return Ok(None);
    }

    let prompt = LOCAL_CONVERSATION_TOPIC_NAMING_PROMPT_TEMPLATE
        .replace("{first_message}", normalized_first_message);
    let generated = request_local_auxiliary_text(
        app_state,
        provider_model_id,
        model_id,
        &prompt,
        LOCAL_CONVERSATION_TOPIC_NAMING_MAX_TOKENS,
        session_id,
    )
    .await?;

    Ok(generated.and_then(|value| sanitize_generated_title(&value, normalized_first_message)))
}

async fn generate_local_conversation_summary_with_model(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    messages: &[LocalConversationHistoryMessage],
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let conversation = build_local_summary_prompt_input(messages);
    if conversation.trim().is_empty() {
        return Ok(None);
    }

    let prompt = LOCAL_CONVERSATION_SUMMARY_PROMPT_TEMPLATE.replace("{conversation}", &conversation);
    let generated = request_local_auxiliary_text(
        app_state,
        provider_model_id,
        model_id,
        &prompt,
        LOCAL_CONVERSATION_SUMMARY_MAX_TOKENS,
        session_id,
    )
    .await?;

    Ok(generated
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| truncate_text_chars(&value, LOCAL_CONVERSATION_SUMMARY_MAX_CHARS)))
}

pub(crate) async fn run_local_chat_complete_with_auto_code_mode(
    app: &AppHandle,
    app_state: &AppState,
    model_connection: &LocalModelConnection,
    messages: Vec<LocalChatInputMessage>,
    chat_ctx: &LocalConversationChatContext,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    event_tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    trace_id: Option<&str>,
    request_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    const DEFAULT_MAX_AGENTIC_ROUNDS: usize = 10;
    let max_rounds = match app_state
        .mcp
        .store
        .get_desktop_config("max_agentic_rounds")
        .await
    {
        Ok(Some(val)) => val.parse::<usize>().unwrap_or(DEFAULT_MAX_AGENTIC_ROUNDS),
        _ => DEFAULT_MAX_AGENTIC_ROUNDS,
    };

    let trace_id = trace_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let session_id = chat_ctx.session_id.clone();

    let provider_model_id = &model_connection.provider_model_id;
    let model_id = &model_connection.model_id;
    let mut orchestrated_messages = messages;

    // Inject Deeting platform identity as leading system message
    let has_system = orchestrated_messages
        .first()
        .map(|m| m.role == "system")
        .unwrap_or(false);
    if !has_system {
        orchestrated_messages.insert(
            0,
            LocalChatInputMessage {
                role: "system".to_string(),
                content: concat!(
                    "You are running inside Deeting, an AI agent platform.\n",
                    "When the user asks to install, create, or manage skills:\n",
                    "- Deeting skills use deeting.json (NOT SKILL.md), llm-tool.yaml, and main.py.\n",
                    "- Use the install_skill_from_repo tool or sys_submit_onboarding_request to install skills.\n",
                    "- User skills directory: $APP_DATA_DIR/skills/<skill_id>/.\n",
                    "- Do NOT use opencode, codex, openclaw, or any other platform's skill paths or manifest format.\n",
                ).to_string(),
            },
        );
    }

    let mut round: usize = 0;
    let mut all_tool_call_meta: Vec<serde_json::Value> = Vec::new();
    let mut last_response: Option<serde_json::Value> = None;
    let mut active_assistant: Option<LocalAssistantActivationState> = None;
    let mut realtime_emitter =
        LocalRealtimeToolTraceEmitter::new(event_tx, Some(trace_id.as_str()), request_id);

    loop {
        round = round.saturating_add(1);
        if round > max_rounds {
            log::warn!(
                "agentic loop exceeded {} rounds, returning last response",
                max_rounds
            );
            let mut fallback = last_response.unwrap_or_else(|| serde_json::json!({
                "content": "Tool execution reached the maximum number of rounds."
            }));
            if !all_tool_call_meta.is_empty() {
                fallback["tool_trace_blocks"] =
                    serde_json::Value::Array(build_local_tool_trace_blocks(&all_tool_call_meta));
            }
            if realtime_emitter.emitted_any {
                fallback["tool_trace_streamed"] = serde_json::json!(true);
            }
            return Ok(fallback);
        }
        let mut tools = build_local_code_mode_entry_tools();
        if let Some(active) = &active_assistant {
            tools = merge_wrapped_tool_payload(&tools, &active.skill_tools);
        }

        let response = request_provider_chat_completion(
            app_state,
            provider_model_id,
            model_id,
            orchestrated_messages.clone(),
            Some(tools),
            temperature,
            max_tokens,
            Some(trace_id.as_str()),
            Some(session_id.as_str()),
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
            if realtime_emitter.emitted_any {
                enriched["tool_trace_streamed"] = serde_json::json!(true);
            }
            return Ok(enriched);
        }

        last_response = Some(response.clone());

        let (synthesized, tool_call_meta, results, assistant_update) =
            maybe_handle_local_code_mode_tool_calls(
                app,
                app_state,
                &response,
                chat_ctx,
                active_assistant.as_ref(),
                &mut realtime_emitter,
            )
            .await;
        if !synthesized {
            return Ok(response);
        }
        all_tool_call_meta.extend(tool_call_meta.iter().cloned());

        if let Some(update) = assistant_update {
            match update {
                LocalAssistantActivationUpdate::Activate(next_active) => {
                    let assistant_name = next_active.assistant_name.clone();
                    let system_prompt = next_active.system_prompt.clone();
                    active_assistant = Some(next_active);
                    orchestrated_messages.push(LocalChatInputMessage {
                        role: "system".to_string(),
                        content: format!(
                            "[Assistant Activated: {}]\n\nReplace any previously activated request-scoped assistant instructions with the following prompt.\n\n{}",
                            assistant_name,
                            system_prompt,
                        ),
                    });
                }
                LocalAssistantActivationUpdate::Deactivate {
                    assistant_id: _,
                    assistant_name,
                } => {
                    active_assistant = None;
                    let label = assistant_name.unwrap_or_else(|| "assistant".to_string());
                    orchestrated_messages.push(LocalChatInputMessage {
                        role: "system".to_string(),
                        content: format!(
                            "[Assistant Deactivated: {}]\n\nReturn to the default base assistant context for this request. Ignore any previous request-scoped assistant activation instructions.",
                            label,
                        ),
                    });
                }
            }
        }

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

pub(crate) fn build_local_tool_trace_blocks(
    tool_call_meta: &[serde_json::Value],
) -> Vec<serde_json::Value> {
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
            blocks.extend(extract_assistant_transition_blocks(item, call_id, tool_name));
            blocks.extend(extract_ui_blocks_from_tool_result(item, call_id, tool_name));
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

fn append_streamable_local_tool_result_blocks(
    blocks: &mut Vec<serde_json::Value>,
    item: &serde_json::Value,
) {
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

    if status.eq_ignore_ascii_case("success") {
        blocks.push(serde_json::json!({
            "id": format!("{call_id}-tool-result"),
            "type": "tool_result",
            "callId": call_id,
            "toolName": tool_name,
            "status": "success",
            "result": item.get("result").cloned().unwrap_or_else(|| serde_json::json!({})),
        }));
        blocks.extend(extract_assistant_transition_blocks(item, call_id, tool_name));
        blocks.extend(extract_ui_blocks_from_tool_result(item, call_id, tool_name));
    } else if status.eq_ignore_ascii_case("error") {
        blocks.push(serde_json::json!({
            "id": format!("{call_id}-tool-result"),
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

fn extract_assistant_transition_blocks(
    item: &serde_json::Value,
    call_id: &str,
    tool_name: &str,
) -> Vec<serde_json::Value> {
    let result = item
        .get("result")
        .and_then(|value| value.as_object());
    let Some(result) = result else {
        return Vec::new();
    };

    let transition = result
        .get("assistant_transition")
        .and_then(|value| value.as_object());
    let Some(transition) = transition else {
        return Vec::new();
    };

    let action = transition
        .get("action")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("updated");
    let assistant_id = transition
        .get("assistant_id")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let assistant_name = transition
        .get("assistant_name")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());
    let reason = transition
        .get("reason")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty());

    let id_seed = if call_id.trim().is_empty() {
        tool_name
    } else {
        call_id
    };
    vec![serde_json::json!({
        "id": format!("{id_seed}-assistant-transition"),
        "type": "assistant_transition",
        "action": action,
        "assistantId": assistant_id,
        "assistantName": assistant_name,
        "reason": reason,
    })]
}

fn extract_ui_blocks_from_tool_result(
    item: &serde_json::Value,
    call_id: &str,
    tool_name: &str,
) -> Vec<serde_json::Value> {
    let result = item
        .get("result")
        .and_then(|value| value.as_object());
    let Some(result) = result else {
        return Vec::new();
    };

    let Some(raw_blocks) = result.get("render_blocks").and_then(|value| value.as_array()) else {
        return Vec::new();
    };

    raw_blocks
        .iter()
        .enumerate()
        .filter_map(|(idx, raw)| map_render_block_to_ui_block(raw, call_id, tool_name, idx))
        .collect()
}

fn map_render_block_to_ui_block(
    raw: &serde_json::Value,
    call_id: &str,
    tool_name: &str,
    index: usize,
) -> Option<serde_json::Value> {
    let object = raw.as_object()?;
    let view_type = object
        .get("view_type")
        .or_else(|| object.get("viewType"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())?;

    let payload = object
        .get("payload")
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    let id_seed = if call_id.trim().is_empty() {
        tool_name
    } else {
        call_id
    };

    let mut block = serde_json::Map::new();
    block.insert(
        "id".to_string(),
        serde_json::Value::String(format!("{id_seed}-ui-{index}")),
    );
    block.insert("type".to_string(), serde_json::Value::String("ui".to_string()));
    block.insert(
        "viewType".to_string(),
        serde_json::Value::String(view_type.to_string()),
    );
    block.insert("payload".to_string(), payload);
    block.insert(
        "displayMode".to_string(),
        serde_json::Value::String("widget".to_string()),
    );

    if let Some(title) = object
        .get("title")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        block.insert(
            "title".to_string(),
            serde_json::Value::String(title.to_string()),
        );
    }
    if let Some(metadata) = object.get("metadata").and_then(|value| value.as_object()) {
        block.insert(
            "metadata".to_string(),
            serde_json::Value::Object(metadata.clone()),
        );
    }

    Some(serde_json::Value::Object(block))
}

pub(crate) const LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE: &str =
    "LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED";

pub(crate) fn build_local_tool_call_install_gate_error_meta(
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

const LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION: &str = "assistant_activation.v1";

fn normalize_tool_schema_for_llm(raw: &serde_json::Value) -> Option<serde_json::Value> {
    let object = raw.as_object()?;
    if object.get("type").and_then(|value| value.as_str()) == Some("function")
        && object.get("function").and_then(|value| value.as_object()).is_some()
    {
        return Some(raw.clone());
    }

    let name = object
        .get("name")
        .and_then(|value| value.as_str())
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())?;
    let description = object
        .get("description")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .unwrap_or_default();
    let parameters = object
        .get("parameters")
        .cloned()
        .or_else(|| object.get("input_schema").cloned())
        .unwrap_or_else(|| serde_json::json!({}));

    Some(serde_json::json!({
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        }
    }))
}

fn merge_wrapped_tool_payload(
    base: &serde_json::Value,
    extra_tools: &[serde_json::Value],
) -> serde_json::Value {
    let mut merged = base
        .get("tools")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut existing_names: HashSet<String> = merged
        .iter()
        .filter_map(|tool| {
            tool.get("function")
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
        .collect();

    for raw in extra_tools {
        let Some(tool) = normalize_tool_schema_for_llm(raw) else {
            continue;
        };
        let Some(name) = tool
            .get("function")
            .and_then(|value| value.get("name"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if existing_names.insert(name) {
            merged.push(tool);
        }
    }

    serde_json::json!({ "tools": merged })
}

async fn build_local_consult_expert_network_result(
    app_state: &AppState,
    intent_query: &str,
    limit: usize,
    current_assistant_id: Option<&str>,
) -> serde_json::Value {
    build_local_consult_expert_network_result_with_runtime(
        app_state.mcp.store.as_ref(),
        &app_state.providers.embedding,
        app_state.memory.service.as_ref(),
        intent_query,
        limit,
        current_assistant_id,
    )
    .await
}

fn build_local_consult_response(
    candidates: Vec<serde_json::Value>,
    reason: &str,
    search_mode: &str,
) -> serde_json::Value {
    let recommended_assistant_id = candidates
        .first()
        .and_then(|value| value.get("assistant_id"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    serde_json::json!({
        "action": "consulted",
        "scope": "request",
        "format_version": LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
        "candidates": candidates,
        "recommended_assistant_id": recommended_assistant_id,
        "reason": reason,
        "search_mode": search_mode,
    })
}

fn build_local_consult_candidates_from_assets(
    assets: Vec<serde_json::Value>,
    enabled_assistant_ids: &HashSet<String>,
    current_assistant_id: &str,
    limit: usize,
) -> Vec<serde_json::Value> {
    let mut candidates = Vec::new();
    for hit in assets {
        let assistant_id = hit
            .get("id")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let Some(assistant_id) = assistant_id else {
            continue;
        };
        if assistant_id == current_assistant_id {
            continue;
        }
        if !enabled_assistant_ids.contains(assistant_id.as_str()) {
            continue;
        }
        let name = hit
            .get("name")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "Assistant".to_string());
        candidates.push(serde_json::json!({
            "assistant_id": assistant_id,
            "name": name,
            "summary": hit.get("description").cloned().unwrap_or(serde_json::Value::Null),
            "score": hit.get("_distance").cloned().unwrap_or(serde_json::Value::Null),
        }));
        if candidates.len() >= limit {
            break;
        }
    }
    candidates
}

pub(crate) async fn build_local_consult_expert_network_result_with_runtime(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    intent_query: &str,
    limit: usize,
    current_assistant_id: Option<&str>,
) -> serde_json::Value {
    let normalized_query = intent_query.trim();
    if normalized_query.is_empty() {
        return serde_json::json!({
            "error": "intent_query is required",
            "error_code": "ASSISTANT_CONSULT_EMPTY_QUERY",
        });
    }

    let enabled_assistant_ids = mcp_store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let max_hits = limit.clamp(1, 8);
    if enabled_assistant_ids.is_empty() {
        return build_local_consult_response(
            Vec::new(),
            "No installed local assistants are enabled for expert consultation.",
            "catalog_empty",
        );
    }

    let current_assistant = current_assistant_id.unwrap_or("").trim();
    let assistants = match mcp_store.list_local_assistants().await {
        Ok(value) => value,
        Err(err) => {
            log::warn!("local assistant catalog unavailable for consult_expert_network: {}", err);
            return build_local_consult_response(
                Vec::new(),
                "Local assistant catalog is unavailable, so expert consultation was skipped.",
                "catalog_unavailable",
            );
        }
    };
    let assistant_assets = assistants
        .into_iter()
        .filter(|assistant| enabled_assistant_ids.contains(assistant.id.as_str()))
        .filter(|assistant| assistant.id != current_assistant)
        .map(|assistant| {
            serde_json::json!({
                "id": assistant.id,
                "name": assistant.name,
                "description": assistant.description.unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();
    if assistant_assets.is_empty() {
        return build_local_consult_response(
            Vec::new(),
            "No alternative local assistants are available for expert consultation.",
            "catalog_empty",
        );
    }

    let fallback_reason = if let Ok(vector) = embedding_service.embed_text(normalized_query).await {
        match memory_store.search_assets(vector, max_hits, Some("assistant")).await {
            Ok(hits) => {
                let candidates = build_local_consult_candidates_from_assets(
                    hits,
                    &enabled_assistant_ids,
                    current_assistant,
                    max_hits,
                );
                if !candidates.is_empty() {
                    return build_local_consult_response(
                        candidates,
                        "Search expert assistants by intent and activate explicitly if needed.",
                        "vector",
                    );
                }
                "No vector-ranked assistant matched, so the local assistant catalog fallback was used."
                    .to_string()
            }
            Err(err) => {
                log::warn!(
                    "local assistant vector search failed for consult_expert_network: {}",
                    err
                );
                "Vector search was unavailable, so the local assistant catalog fallback was used."
                    .to_string()
            }
        }
    } else {
        "Embedding lookup was unavailable, so the local assistant catalog fallback was used."
            .to_string()
    };

    let lexical_hits = lexical_rank_asset_hits(
        &normalized_query.to_lowercase(),
        assistant_assets,
        max_hits,
    );
    let candidates = build_local_consult_candidates_from_assets(
        lexical_hits,
        &enabled_assistant_ids,
        current_assistant,
        max_hits,
    );
    if candidates.is_empty() {
        return build_local_consult_response(
            Vec::new(),
            "No matching local assistants were found for this request.",
            "lexical",
        );
    }

    build_local_consult_response(candidates, &fallback_reason, "lexical")
}

async fn resolve_local_skill_refs_to_tools(
    app_state: &AppState,
    skill_refs: &[serde_json::Value],
) -> Result<Vec<serde_json::Value>, String> {
    let mut tools = Vec::new();
    let mut seen_names = HashSet::new();

    for skill_ref in skill_refs {
        let raw_skill_id = skill_ref
            .get("skill_id")
            .or_else(|| skill_ref.get("id"))
            .or_else(|| skill_ref.get("name"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let Some(raw_skill_id) = raw_skill_id else {
            continue;
        };

        let mut candidate_ids = Vec::new();
        candidate_ids.push(raw_skill_id.clone());
        let normalized = raw_skill_id.replace('/', ".");
        if normalized != raw_skill_id {
            candidate_ids.push(normalized.clone());
        }
        if let Some(tail) = normalized.split('.').last() {
            let official = format!("official.skills.{}", tail);
            if !candidate_ids.contains(&official) {
                candidate_ids.push(official);
            }
        }

        let mut manifest_json = None;
        for candidate_id in candidate_ids {
            manifest_json = app_state
                .mcp
                .store
                .get_enabled_local_skill_manifest_json(&candidate_id)
                .await
                .map_err(to_string)?;
            if manifest_json.is_some() {
                break;
            }
        }

        let Some(manifest_json) = manifest_json else {
            continue;
        };
        let manifest = serde_json::from_str::<serde_json::Value>(&manifest_json)
            .map_err(|err| err.to_string())?;
        let manifest_tools = manifest
            .get("tools")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        for raw_tool in manifest_tools {
            let Some(tool) = normalize_tool_schema_for_llm(&raw_tool) else {
                continue;
            };
            let Some(name) = tool
                .get("function")
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            if seen_names.insert(name) {
                tools.push(tool);
            }
        }
    }

    Ok(tools)
}

async fn resolve_local_assistant_activation_state(
    app_state: &AppState,
    assistant_id: &str,
) -> Result<LocalAssistantActivationState, String> {
    let normalized_assistant_id = assistant_id.trim().to_string();
    if normalized_assistant_id.is_empty() {
        return Err("assistant_id is required".to_string());
    }

    let enabled_assistant_ids = app_state
        .mcp
        .store
        .list_enabled_local_assistant_ids()
        .await
        .map_err(to_string)?;
    if !enabled_assistant_ids.contains(normalized_assistant_id.as_str()) {
        return Err(format!(
            "assistant '{}' is not installed or enabled in local desktop runtime",
            normalized_assistant_id
        ));
    }

    let version = app_state
        .mcp
        .store
        .get_local_assistant_current_version(&normalized_assistant_id)
        .await
        .map_err(to_string)?
        .ok_or_else(|| format!("assistant '{}' not found", normalized_assistant_id))?;

    let skill_tools = resolve_local_skill_refs_to_tools(app_state, &version.skill_refs).await?;
    Ok(LocalAssistantActivationState {
        assistant_id: normalized_assistant_id,
        assistant_name: version.name,
        system_prompt: version.system_prompt,
        skill_tools,
    })
}

async fn maybe_handle_local_code_mode_tool_calls(
    app: &AppHandle,
    app_state: &AppState,
    chat_response: &serde_json::Value,
    chat_ctx: &LocalConversationChatContext,
    active_assistant: Option<&LocalAssistantActivationState>,
    realtime_emitter: &mut LocalRealtimeToolTraceEmitter,
) -> (
    bool,
    Vec<serde_json::Value>,
    Vec<String>,
    Option<LocalAssistantActivationUpdate>,
) {
    let tool_calls = extract_chat_tool_calls(chat_response);
    if tool_calls.is_empty() {
        return (false, Vec::new(), Vec::new(), None);
    }

    let mut tool_call_meta = Vec::new();
    let mut results = Vec::new();
    let mut synthesized = false;
    let mut assistant_update = None;

    for call in tool_calls {
        let tool_name = call.name.trim().to_lowercase();
        let call_id = call.id.clone().unwrap_or_default();
        if tool_name == "execute_code_plan" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
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
                realtime_emitter.emit_blocks(vec![serde_json::json!({
                    "id": format!("{}-tool-result", call_id),
                    "type": "tool_result",
                    "callId": call.id,
                    "toolName": tool_name,
                    "status": "error",
                    "result": {
                        "error": error,
                        "error_code": "CODE_MODE_APPROVAL_REQUIRED",
                    },
                })]);
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
                        build_runtime_bridge_stream_target(realtime_emitter),
                    )
                    .await;

                match execution_res {
                    Ok(res) => {
                        synthesized = true;
                        let meta = serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "success",
                            "result": res,
                        });
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
                        results.push(format!(
                            "Code Execution Result:\n{}",
                            res.result.join("\n")
                        ));
                    }
                    Err(err) => {
                        let meta = serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "error",
                            "error": err.to_string(),
                        });
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
                        results.push(format!("Code Execution Failed: {}", err));
                    }
                }
            }
        } else if tool_name == "search_sdk" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
            let query = call
                .arguments
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let search_res = build_local_sdk_search_result(app_state, query).await;
            synthesized = true;
            let meta = serde_json::json!({
                "id": call.id,
                "name": tool_name,
                "status": "success",
                "result": search_res,
            });
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push(format!(
                "SDK Search Result for '{}':\n{}",
                query,
                serde_json::to_string_pretty(&search_res).unwrap()
            ));
        } else if tool_name == "consult_expert_network" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
            let intent_query = call
                .arguments
                .get("intent_query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let limit = call
                .arguments
                .get("k")
                .and_then(|v| v.as_u64())
                .map(|value| value as usize)
                .unwrap_or(3);
            let consult_res = build_local_consult_expert_network_result(
                app_state,
                intent_query,
                limit,
                active_assistant.map(|value| value.assistant_id.as_str()),
            )
            .await;
            synthesized = true;
            let meta = serde_json::json!({
                "id": call.id,
                "name": tool_name,
                "status": "success",
                "result": consult_res,
            });
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push(format!(
                "Assistant Consult Result for '{}':\n{}",
                intent_query,
                serde_json::to_string_pretty(&consult_res).unwrap()
            ));
        } else if tool_name == "activate_assistant" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
            let assistant_id = call
                .arguments
                .get("assistant_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let reason = call
                .arguments
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("Explicit assistant activation requested by the model.");
            match resolve_local_assistant_activation_state(app_state, assistant_id).await {
                Ok(state) => {
                    let activated_assistant_id = state.assistant_id.clone();
                    let activated_assistant_name = state.assistant_name.clone();
                    let activated_system_prompt = state.system_prompt.clone();
                    let activated_skill_tools = state.skill_tools.clone();
                    let result = serde_json::json!({
                        "action": "activated",
                        "scope": "request",
                        "format_version": LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
                        "activation_mode": "replace",
                        "assistant_id": activated_assistant_id,
                        "assistant_name": activated_assistant_name,
                        "system_prompt": activated_system_prompt,
                        "skill_tools": activated_skill_tools,
                        "reason": reason,
                        "assistant_transition": {
                            "action": "activated",
                            "assistant_id": assistant_id,
                            "assistant_name": state.assistant_name.clone(),
                            "reason": reason,
                        },
                    });
                    synthesized = true;
                    let meta = serde_json::json!({
                        "id": call.id,
                        "name": tool_name,
                        "status": "success",
                        "result": result,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!(
                        "Assistant '{}' activated for the current request.",
                        state.assistant_name
                    ));
                    assistant_update = Some(LocalAssistantActivationUpdate::Activate(state));

                    // Fire-and-forget: record bandit feedback for assistant activation
                    let bandit_store = app_state.providers.store.clone();
                    let bandit_assistant_id = activated_assistant_id.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = bandit_store
                            .record_feedback_simple(
                                "router:assistant",
                                &bandit_assistant_id,
                                true,
                                None,
                            )
                            .await
                        {
                            log::warn!("bandit feedback failed for router:assistant: {}", e);
                        }
                    });
                }
                Err(err) => {
                    let meta = serde_json::json!({
                        "id": call.id,
                        "name": tool_name,
                        "status": "error",
                        "error_code": "ASSISTANT_ACTIVATION_FAILED",
                        "error": err,
                    });
                    let mut streamed_blocks = Vec::new();
                    append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                    realtime_emitter.emit_blocks(streamed_blocks);
                    tool_call_meta.push(meta);
                    results.push(format!("Assistant activation failed: {}", err));
                    synthesized = true;

                    // Fire-and-forget: record bandit failure for assistant activation
                    let bandit_store = app_state.providers.store.clone();
                    let bandit_assistant_id = assistant_id.to_string();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = bandit_store
                            .record_feedback_simple(
                                "router:assistant",
                                &bandit_assistant_id,
                                false,
                                None,
                            )
                            .await
                        {
                            log::warn!("bandit feedback failed for router:assistant: {}", e);
                        }
                    });
                }
            }
        } else if tool_name == "deactivate_assistant" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
            let reason = call
                .arguments
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("Explicit assistant deactivation requested by the model.");
            let result = serde_json::json!({
                "action": "deactivated",
                "scope": "request",
                "format_version": LOCAL_ASSISTANT_ACTIVATION_FORMAT_VERSION,
                "assistant_id": active_assistant.map(|value| value.assistant_id.clone()),
                "assistant_name": active_assistant.map(|value| value.assistant_name.clone()),
                "reason": reason,
                "assistant_transition": {
                    "action": "deactivated",
                    "assistant_id": active_assistant.map(|value| value.assistant_id.clone()),
                    "assistant_name": active_assistant.map(|value| value.assistant_name.clone()),
                    "reason": reason,
                },
            });
            synthesized = true;
            let meta = serde_json::json!({
                "id": call.id,
                "name": tool_name,
                "status": "success",
                "result": result,
            });
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push("Assistant deactivated for the current request.".to_string());
            assistant_update = Some(LocalAssistantActivationUpdate::Deactivate {
                assistant_id: active_assistant.map(|value| value.assistant_id.clone()),
                assistant_name: active_assistant.map(|value| value.assistant_name.clone()),
            });
        } else if tool_name == "sys_submit_onboarding_request" {
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
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
                            let meta = serde_json::json!({
                                "id": call.id,
                                "name": tool_name,
                                "status": "success",
                                "result": {"action": "created", "id": id},
                            });
                            let mut streamed_blocks = Vec::new();
                            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                            realtime_emitter.emit_blocks(streamed_blocks);
                            tool_call_meta.push(meta);
                            results.push(format!("Assistant created successfully with ID: {}", id));
                        }
                        Err(err) => {
                            let meta = serde_json::json!({
                                "id": call.id,
                                "name": tool_name,
                                "status": "error",
                                "error": err.to_string(),
                            });
                            let mut streamed_blocks = Vec::new();
                            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                            realtime_emitter.emit_blocks(streamed_blocks);
                            tool_call_meta.push(meta);
                        }
                    }
                }
            } else if asset_type == "skill" {
                match install_local_skill_from_onboarding_request(app, app_state, &payload).await {
                    Ok(result) => {
                        synthesized = true;
                        let meta = serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "success",
                            "result": result,
                        });
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
                        results.push(format!(
                            "Skill onboarding request executed:\n{}",
                            serde_json::to_string_pretty(&result).unwrap_or_else(|_| "{}".to_string())
                        ));
                    }
                    Err(err) => {
                        synthesized = true;
                        let meta = serde_json::json!({
                            "id": call.id,
                            "name": tool_name,
                            "status": "error",
                            "error": err,
                        });
                        let mut streamed_blocks = Vec::new();
                        append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
                        realtime_emitter.emit_blocks(streamed_blocks);
                        tool_call_meta.push(meta);
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
            realtime_emitter.emit_execution_section_once();
            realtime_emitter.emit_blocks(vec![serde_json::json!({
                "id": format!("{}-tool-call", call_id),
                "type": "tool_call",
                "callId": call.id,
                "toolName": tool_name,
                "status": "running",
            })]);
            let meta = build_local_tool_call_install_gate_error_meta(
                call.id.as_deref(),
                &tool_name,
                &error,
            );
            let mut streamed_blocks = Vec::new();
            append_streamable_local_tool_result_blocks(&mut streamed_blocks, &meta);
            realtime_emitter.emit_blocks(streamed_blocks);
            tool_call_meta.push(meta);
            results.push(format!(
                "Tool call '{}' failed [{}]: {}",
                tool_name, LOCAL_TOOL_CALL_NOT_INSTALLED_OR_DISABLED_CODE, error
            ));
        }
    }

    (synthesized, tool_call_meta, results, assistant_update)
}

pub(crate) fn build_local_code_mode_entry_tools() -> serde_json::Value {
    serde_json::json!({
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "search_sdk",
                    "description": "Search Deeting SDK capabilities by intent and return typed signatures, parameter docs, and python stubs. Use before execute_code_plan. Prefer calling tools by generated stubs or `deeting.call_tool(name, **kwargs)`.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Natural language intent to search tools."
                            },
                            "limit": {
                                "type": "integer",
                                "description": "Max items to return (1-20).",
                                "default": 8
                            },
                            "include_schema": {
                                "type": "boolean",
                                "description": "Whether to include full JSON schema.",
                                "default": false
                            }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "consult_expert_network",
                    "description": "Search expert assistants by intent query and return top candidates. This tool only searches and does not switch persona context by itself.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "intent_query": {
                                "type": "string",
                                "description": "The intent or task description to search for expert assistants."
                            },
                            "k": {
                                "type": "integer",
                                "description": "Number of candidates to return.",
                                "default": 3
                            },
                            "confidence": {
                                "type": "number",
                                "description": "Model confidence in the routing decision (0-1).",
                                "default": 0
                            }
                        },
                        "required": ["intent_query", "confidence"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "activate_assistant",
                    "description": "Activate an assistant explicitly for the current request-scoped agent loop. This switches persona context only after an explicit activation call.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "assistant_id": {
                                "type": "string",
                                "description": "Assistant id returned by consult_expert_network."
                            },
                            "reason": {
                                "type": "string",
                                "description": "Optional reason for the activation decision."
                            }
                        },
                        "required": ["assistant_id"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "deactivate_assistant",
                    "description": "Deactivate the current request-scoped assistant and return to the default base assistant context.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "reason": {
                                "type": "string",
                                "description": "Optional reason for the deactivation."
                            }
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "execute_code_plan",
                    "description": "Execute a Python code plan in sandbox. Runtime exposes `deeting.log()`, `deeting.section()`, and `deeting.call_tool()`. SDK tool stubs are auto-injected based on your code: use `from deeting_sdk import <tool_name>` directly without calling search_sdk first (search_sdk is optional for discovery). Important: call tools with keyword args (`deeting.call_tool('tool-name', query='...')`), not positional dict args. Generate one coherent script, and always emit final structured output via `deeting.log(json.dumps(result, ensure_ascii=False))` instead of relying on top-level `return`.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "code": {
                                "type": "string",
                                "description": "Python code to execute."
                            },
                            "session_id": {
                                "type": "string",
                                "description": "Optional explicit session ID."
                            },
                            "language": {
                                "type": "string",
                                "description": "Execution language. Only python is supported.",
                                "default": "python"
                            },
                            "execution_timeout": {
                                "type": "integer",
                                "description": "Execution timeout hint in seconds.",
                                "default": 30
                            },
                            "dry_run": {
                                "type": "boolean",
                                "description": "Only validate code and return plan metadata without executing.",
                                "default": false
                            }
                        },
                        "required": ["code"]
                    }
                }
            }
        ]
    })
}

#[derive(Debug, Clone)]
struct LocalAssistantActivationState {
    assistant_id: String,
    assistant_name: String,
    system_prompt: String,
    skill_tools: Vec<serde_json::Value>,
}

#[derive(Debug, Clone)]
enum LocalAssistantActivationUpdate {
    Activate(LocalAssistantActivationState),
    Deactivate {
        assistant_id: Option<String>,
        assistant_name: Option<String>,
    },
}

struct LocalRealtimeToolTraceEmitter {
    tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    trace_id: Option<String>,
    request_id: Option<String>,
    emitted_execution_section: bool,
    emitted_any: bool,
}

impl LocalRealtimeToolTraceEmitter {
    fn new(
        tx: Option<tokio::sync::mpsc::UnboundedSender<String>>,
        trace_id: Option<&str>,
        request_id: Option<&str>,
    ) -> Self {
        Self {
            tx,
            trace_id: trace_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            request_id: request_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            emitted_execution_section: false,
            emitted_any: false,
        }
    }

    fn emit_execution_section_once(&mut self) {
        if self.emitted_execution_section {
            return;
        }
        self.emitted_execution_section = true;
        self.emit_blocks(vec![serde_json::json!({
            "type": "execution_section",
            "title": "Local Tool Actions"
        })]);
    }

    fn emit_blocks(&mut self, blocks: Vec<serde_json::Value>) {
        if blocks.is_empty() {
            return;
        }
        let Some(tx) = &self.tx else {
            return;
        };
        let mut payload = serde_json::json!({
            "type": "blocks",
            "blocks": blocks,
        });
        if let Some(object) = payload.as_object_mut() {
            if let Some(trace_id) = self.trace_id.as_ref() {
                object.insert("trace_id".to_string(), serde_json::json!(trace_id));
            }
            if let Some(request_id) = self.request_id.as_ref() {
                object.insert("request_id".to_string(), serde_json::json!(request_id));
            }
        }
        if let Ok(serialized) = serde_json::to_string(&payload) {
            let _ = tx.send(serialized);
            self.emitted_any = true;
        }
    }
}

fn build_runtime_bridge_stream_target(
    realtime_emitter: &LocalRealtimeToolTraceEmitter,
) -> Option<crate::modules::code_mode::bridge::RuntimeBridgeStreamTarget> {
    let tx = realtime_emitter.tx.as_ref()?.clone();
    Some(crate::modules::code_mode::bridge::RuntimeBridgeStreamTarget {
        tx,
        trace_id: realtime_emitter.trace_id.clone(),
        request_id: realtime_emitter.request_id.clone(),
    })
}

async fn build_local_sdk_search_result(app_state: &AppState, query: &str) -> serde_json::Value {
    build_local_sdk_search_result_with_runtime(
        app_state.mcp.store.as_ref(),
        &app_state.providers.embedding,
        app_state.memory.service.as_ref(),
        query,
    )
    .await
}

pub(crate) async fn build_local_sdk_search_result_with_runtime(
    mcp_store: &crate::modules::mcp::store::McpStore,
    embedding_service: &crate::modules::providers::embedding::EmbeddingService,
    memory_store: &crate::modules::memory::service::MemoryService,
    query: &str,
) -> serde_json::Value {
    let normalized = query.trim().to_lowercase();
    let enabled_assistant_ids = mcp_store
        .list_enabled_local_assistant_ids()
        .await
        .unwrap_or_else(|_| HashSet::new());
    let enabled_skill_ids = mcp_store
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
            "description": "Deeting platform: install skills or assistants. For skill installation use asset_type='skill' and payload {repo_url, skill_name}. Skills are cloned to $APP_DATA_DIR/skills/<skill_id>/ and must contain deeting.json + llm-tool.yaml + main.py (NOT SKILL.md). Do NOT use opencode, codex, or openclaw paths.",
            "source": "code_mode_core",
            "parameters": {
                "asset_type": "string(required, oneof=assistant|skill)",
                "payload": "object(required)",
            }
        }),
    ];

    // Single Path Local Discovery via Unified Assets
    if !normalized.is_empty() {
        let mut asset_hits = Vec::new();
        if let Ok(vector) = embedding_service.embed_text(&normalized).await {
            if let Ok(hits) = memory_store.search_assets(vector, 15, None).await {
                asset_hits = hits;
            }
        }
        if asset_hits.is_empty() {
            if let Ok(all_assets) = memory_store.list_assets_catalog().await {
                asset_hits = lexical_rank_asset_hits(&normalized, all_assets, 15);
            }
        }

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

    let usage_hint = "先根据参数文档和 python_stub 规划步骤，再调用 execute_code_plan 一次性执行。脚本内优先 `from deeting_sdk import tool_name` 或 `deeting.call_tool(name, **kwargs)`；不要写 `deeting.call_tool(name, { ... })`。最后请用 `deeting.log(json.dumps(result, ensure_ascii=False))` 输出结构化结果。";

    serde_json::json!({
        "format_version": "sdk_toolcard.v2",
        "runtime_protocol_version": crate::modules::code_mode::contract::RUNTIME_PROTOCOL_VERSION,
        "query": query,
        "mode": "code_mode",
        "count": matches.len(),
        "tools": matches.clone(),
        "items": matches,
        "usage_hint": usage_hint,
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

fn lexical_rank_asset_hits(
    normalized_query: &str,
    assets: Vec<serde_json::Value>,
    limit: usize,
) -> Vec<serde_json::Value> {
    let mut ranked = assets
        .into_iter()
        .filter_map(|mut item| {
            let score = lexical_asset_match_score(normalized_query, &item)?;
            if let Some(object) = item.as_object_mut() {
                object.insert("_distance".to_string(), serde_json::json!(score));
            }
            Some(item)
        })
        .collect::<Vec<_>>();

    ranked.sort_by(|left, right| {
        let lhs = left
            .get("_distance")
            .and_then(|value| value.as_f64())
            .unwrap_or(f64::NEG_INFINITY);
        let rhs = right
            .get("_distance")
            .and_then(|value| value.as_f64())
            .unwrap_or(f64::NEG_INFINITY);
        rhs.partial_cmp(&lhs).unwrap_or(std::cmp::Ordering::Equal)
    });
    if ranked.len() > limit {
        ranked.truncate(limit);
    }
    ranked
}

fn lexical_asset_match_score(normalized_query: &str, item: &serde_json::Value) -> Option<f64> {
    if normalized_query.trim().is_empty() {
        return None;
    }
    let name = item
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_lowercase();
    let description = item
        .get("description")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_lowercase();
    let haystack = format!("{name}\n{description}");
    if haystack.trim().is_empty() {
        return None;
    }
    if name.contains(normalized_query) {
        return Some(1000.0);
    }
    if description.contains(normalized_query) {
        return Some(900.0);
    }

    let overlap = lexical_units(normalized_query)
        .into_iter()
        .filter(|unit| !unit.is_empty() && haystack.contains(unit))
        .count();
    if overlap == 0 {
        return None;
    }

    let prefix_bonus = if name.starts_with(normalized_query) || description.starts_with(normalized_query)
    {
        100.0
    } else {
        0.0
    };
    Some(prefix_bonus + overlap as f64)
}

fn lexical_units(input: &str) -> Vec<String> {
    let mut units = Vec::new();
    let mut ascii_buffer = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            ascii_buffer.push(ch);
            continue;
        }
        if !ascii_buffer.is_empty() {
            units.push(ascii_buffer.clone());
            ascii_buffer.clear();
        }
        if !ch.is_whitespace() {
            units.push(ch.to_string());
        }
    }
    if !ascii_buffer.is_empty() {
        units.push(ascii_buffer);
    }
    units
}

pub(crate) fn derive_skill_name_from_repo_url(repo_url: &str) -> String {
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

pub(crate) fn parse_skill_onboarding_payload(
    payload: &serde_json::Value,
) -> Result<(String, String), String> {
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

    let result = install_skill_to_local(app, app_state, &repo_url, None).await?;

    Ok(serde_json::json!({
        "action": "skill_installed",
        "repo_url": repo_url,
        "skill_name": skill_name,
        "install": {
            "skill_id": result.skill_id,
            "tool_count": result.tool_count,
            "install_path": result.install_path,
        }
    }))
}

pub(crate) fn extract_chat_tool_calls(response: &serde_json::Value) -> Vec<LocalChatToolCall> {
    let mut calls = Vec::new();
    if let Some(tc_array) = response.get("tool_calls").and_then(|v| v.as_array()) {
        for tc in tc_array {
            let id = tc.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
            let name = tc.get("name").and_then(|v| v.as_str())
                .or_else(|| tc.get("function").and_then(|f| f.get("name")).and_then(|v| v.as_str()))
                .map(|s| s.to_string());
            
            let args = tc.get("arguments").cloned()
                .or_else(|| tc.get("function").and_then(|f| f.get("arguments")).map(|v| {
                    if let Some(s) = v.as_str() {
                        serde_json::from_str(s).unwrap_or(serde_json::json!({}))
                    } else {
                        v.clone()
                    }
                }))
                .unwrap_or(serde_json::json!({}));

            if let Some(name_val) = name {
                calls.push(LocalChatToolCall {
                    id,
                    name: name_val,
                    arguments: args,
                });
            }
        }
    }
    calls
}

pub(crate) fn build_auto_code_mode_tool_feedback(
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

#[tauri::command]
pub async fn get_local_gateway_url(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let url = state.mcp.local_gateway.base_url.read().await.clone();
    Ok(url)
}

const LOCAL_CONVERSATION_SUMMARY_MAX_CHARS: usize = 2000;
const LOCAL_CONVERSATION_SUMMARY_PROMPT_INPUT_MAX_CHARS: usize = 4000;
const LOCAL_CONVERSATION_SUMMARY_MAX_TOKENS: u32 = 768;
const LOCAL_CODE_MODE_TOOL_RESULTS_MAX_CHARS: usize = 8000;
const LOCAL_CONVERSATION_SUMMARY_FALLBACK_RECENT_MESSAGES: usize = 8;
const LOCAL_CONVERSATION_SUMMARY_WORKER_IDLE_INTERVAL_SECS: u64 = 2;
const LOCAL_CONVERSATION_TOPIC_TITLE_MAX_CHARS: usize = 40;
const LOCAL_CONVERSATION_TOPIC_NAMING_MAX_TOKENS: u32 = 96;
const LOCAL_CONVERSATION_AUXILIARY_TEMPERATURE: f32 = 0.2;
const LOCAL_CONVERSATION_TOPIC_NAMING_PROMPT_TEMPLATE: &str = r#"
请根据用户的第一句话生成一个简短话题标题，要求：
1) 10-20 字以内；2) 不要引号与句号；3) 仅输出标题文本。
用户内容：{first_message}
"#;
const LOCAL_CONVERSATION_SUMMARY_PROMPT_TEMPLATE: &str = r#"
请对以下多轮对话内容进行摘要，要求：
1) 保留关键信息和上下文，包括用户意图、重要决策和结论；
2) 去除冗余和重复内容；
3) 摘要长度控制在 500 字以内；
4) 仅输出摘要文本，不要额外解释。

对话内容：
{conversation}
"#;
