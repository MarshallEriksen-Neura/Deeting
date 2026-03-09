use super::super::{
    common_impl::{to_string, LocalModelConnection},
    support::*,
};
use super::config::now_rfc3339;

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
    let exact_match = models.iter().find(|model| {
        if requested.is_empty() {
            return false;
        }
        model.model_id.eq_ignore_ascii_case(&requested)
            || model
                .unified_model_id
                .as_deref()
                .map(|v| v.eq_ignore_ascii_case(&requested))
                .unwrap_or(false)
            || model
                .display_name
                .as_deref()
                .map(|v| v.eq_ignore_ascii_case(&requested))
                .unwrap_or(false)
    });
    if let Some(matched) = exact_match {
        return Ok(LocalModelConnection {
            provider_model_id: matched.id.to_string(),
            model_id: matched.model_id.clone(),
        });
    }

    let selected = select_model_by_bandit(app_state, &models).await;
    Ok(LocalModelConnection {
        provider_model_id: selected.id.to_string(),
        model_id: selected.model_id.clone(),
    })
}

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
    let arm_map: HashMap<String, &crate::modules::providers::types::BanditArmState> = arms
        .iter()
        .filter_map(|arm| arm.arm_id.as_ref().map(|id| (id.clone(), arm)))
        .collect();
    let eligible: Vec<&crate::modules::providers::types::ProviderModel> = models
        .iter()
        .filter(|m| {
            let arm_id = m.id.to_string();
            match arm_map.get(&arm_id) {
                Some(arm) => match &arm.cooldown_until {
                    Some(until) => until.as_str() <= current_time_rfc3339.as_str(),
                    None => true,
                },
                None => true,
            }
        })
        .collect();
    if eligible.is_empty() {
        return models[0].clone();
    }
    if eligible.len() == 1 {
        return eligible[0].clone();
    }

    let epsilon = arm_map
        .values()
        .next()
        .map(|arm| arm.epsilon)
        .unwrap_or(0.1);
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
        let idx = (rand_val * 10000.0) as usize % eligible.len();
        return eligible[idx].clone();
    }
    eligible
        .into_iter()
        .max_by(|a, b| {
            let rate = |m: &crate::modules::providers::types::ProviderModel| {
                arm_map
                    .get(&m.id.to_string())
                    .map(|arm| {
                        if arm.total_trials > 0 {
                            arm.successes as f64 / arm.total_trials as f64
                        } else {
                            0.5
                        }
                    })
                    .unwrap_or(0.5)
            };
            rate(a)
                .partial_cmp(&rate(b))
                .unwrap_or(std::cmp::Ordering::Equal)
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
        return Err(
            "cloud API base URL not configured; set api.base_url for platform models".to_string(),
        );
    }
    let url = format!("{}/api/v1/credits/chat/completions", base_url);
    let mut body =
        serde_json::json!({ "model": model_id.trim(), "messages": messages, "stream": false });
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
    let mut body =
        serde_json::json!({ "model": effective_model, "messages": messages, "stream": false });
    if let Some(t) = temperature {
        body["temperature"] = serde_json::json!(t);
    }
    if let Some(m) = max_tokens {
        body["max_tokens"] = serde_json::json!(m);
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
    let feedback = crate::modules::providers::types::BanditFeedbackRequest {
        scene: None,
        arm_id: provider_model_id.to_string(),
        success,
        latency_ms: Some(latency_ms),
        cost: None,
        reward: Some(if success { 1.0 } else { 0.0 }),
        routing_config: None,
        reward_metric_type: None,
    };
    if let Err(err) = app_state
        .providers
        .store
        .record_bandit_feedback(feedback)
        .await
    {
        log::warn!("failed to record bandit feedback: {}", err);
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
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut reasoning_content = raw
        .get("reasoning_content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let mut normalized_tool_calls = Vec::<serde_json::Value>::new();
    if let Some(choice) = raw
        .get("choices")
        .and_then(|v| v.as_array())
        .and_then(|items| items.first())
    {
        if let Some(message) = choice.get("message") {
            if content.is_empty() {
                content = message
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
            }
            if reasoning_content.is_empty() {
                reasoning_content = message
                    .get("reasoning_content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
            }
            if let Some(tool_calls) = message.get("tool_calls").and_then(|v| v.as_array()) {
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
                            call.get("arguments")
                                .cloned()
                                .unwrap_or_else(|| serde_json::json!({})),
                        )
                    };
                    normalized_tool_calls.push(serde_json::json!({
                        "id": call.get("id").and_then(|v| v.as_str()).unwrap_or_default(),
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
    let mut result = serde_json::json!({ "content": content, "tool_calls": normalized_tool_calls });
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
        .and_then(|v| v.pointer("/error/message").and_then(|x| x.as_str()))
        .or_else(|| {
            raw_json
                .and_then(|v| v.get("error"))
                .and_then(|x| x.as_str())
        })
        .or_else(|| {
            raw_json
                .and_then(|v| v.get("message"))
                .and_then(|x| x.as_str())
        })
        .or_else(|| {
            raw_json
                .and_then(|v| v.get("detail"))
                .and_then(|x| x.as_str())
        })
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
    format!("{}...", trimmed.chars().take(max_len).collect::<String>())
}
