use std::collections::HashMap;

use crate::modules::ai_upstream::gateway_log_recorder::{
    calculate_token_cost, extract_billing_amount_from_response, extract_cache_hit_from_response,
    extract_error_code_from_response, extract_ttft_ms_from_response, extract_usage_from_response,
    record_gateway_log, GatewayLogEntry,
};
use crate::modules::ai_upstream::types::LocalModelConnection;
use crate::modules::mcp::types::LocalChatInputMessage;
use crate::modules::providers::protocols::infer_protocol_family;
use crate::state::AppState;
use uuid::Uuid;

fn to_string<T: std::fmt::Display>(err: T) -> String {
    err.to_string()
}

fn now_rfc3339() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

fn inject_runtime_metrics(
    response: &mut serde_json::Value,
    upstream_latency_ms: i64,
    ttft_ms: Option<i64>,
    upstream_calls: i64,
) {
    let Some(object) = response.as_object_mut() else {
        return;
    };

    let mut metrics = object
        .get("runtime_metrics")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    if upstream_latency_ms > 0 {
        metrics.insert(
            "upstream_latency_ms".to_string(),
            serde_json::json!(upstream_latency_ms),
        );
    }
    if let Some(ttft) = ttft_ms.filter(|value| *value > 0) {
        metrics.insert("ttft_ms".to_string(), serde_json::json!(ttft));
    }
    if upstream_calls > 0 {
        metrics.insert(
            "upstream_calls".to_string(),
            serde_json::json!(upstream_calls),
        );
    }
    if !metrics.is_empty() {
        object.insert(
            "runtime_metrics".to_string(),
            serde_json::Value::Object(metrics),
        );
    }
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
                protocol_family: infer_protocol_family(
                    app_state
                        .providers
                        .store
                        .get_instance_connection(&model.instance_id.to_string())
                        .await
                        .map_err(to_string)?
                        .ok_or_else(|| "provider instance connection not found".to_string())?
                        .protocol
                        .as_deref()
                        .unwrap_or("openai"),
                    model.upstream_path.as_str(),
                )
                .to_string(),
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
                .map(|value| value.eq_ignore_ascii_case(&requested))
                .unwrap_or(false)
            || model
                .display_name
                .as_deref()
                .map(|value| value.eq_ignore_ascii_case(&requested))
                .unwrap_or(false)
    });
    if let Some(matched) = exact_match {
        return Ok(LocalModelConnection {
            provider_model_id: matched.id.to_string(),
            model_id: matched.model_id.clone(),
            protocol_family: infer_protocol_family(
                app_state
                    .providers
                    .store
                    .get_instance_connection(&matched.instance_id.to_string())
                    .await
                    .map_err(to_string)?
                    .ok_or_else(|| "provider instance connection not found".to_string())?
                    .protocol
                    .as_deref()
                    .unwrap_or("openai"),
                matched.upstream_path.as_str(),
            )
            .to_string(),
        });
    }

    let selected = select_model_by_bandit(app_state, &models).await;
    Ok(LocalModelConnection {
        provider_model_id: selected.id.to_string(),
        model_id: selected.model_id.clone(),
        protocol_family: infer_protocol_family(
            app_state
                .providers
                .store
                .get_instance_connection(&selected.instance_id.to_string())
                .await
                .map_err(to_string)?
                .ok_or_else(|| "provider instance connection not found".to_string())?
                .protocol
                .as_deref()
                .unwrap_or("openai"),
            selected.upstream_path.as_str(),
        )
        .to_string(),
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
        .filter(|model| {
            let arm_id = model.id.to_string();
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
            let rate = |model: &crate::modules::providers::types::ProviderModel| {
                arm_map
                    .get(&model.id.to_string())
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
    if let Some(id) = trace_id.filter(|value| !value.trim().is_empty()) {
        body["trace_id"] = serde_json::json!(id);
    }
    if let Some(id) = session_id.filter(|value| !value.trim().is_empty()) {
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
    let call_start = std::time::Instant::now();
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
    let raw_ttft_ms = extract_ttft_ms_from_response(&out);
    let mut normalized = normalize_chat_completion_response(out);
    let normalized_ttft_ms = extract_ttft_ms_from_response(&normalized).or(raw_ttft_ms);
    inject_runtime_metrics(
        &mut normalized,
        call_start.elapsed().as_millis() as i64,
        normalized_ttft_ms,
        1,
    );
    Ok(normalized)
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
        .map(|source| source.eq_ignore_ascii_case("platform"))
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
    let response_headers = response.headers.clone();
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
        record_gateway_log(
            app_state.mcp.store.clone(),
            GatewayLogEntry {
                trace_id: trace_id.map(str::to_string),
                api_key_id: Some(instance.credentials_ref.clone())
                    .filter(|value| !value.trim().is_empty()),
                preset_id: Some(instance.preset_slug.clone())
                    .filter(|value| !value.trim().is_empty()),
                model: effective_model.clone(),
                status_code: status.as_u16() as i64,
                duration_ms: latency_ms as i64,
                upstream_url: Some(prepared.display_url()),
                error_code: extract_error_code_from_response(raw_json.as_ref()),
                ..Default::default()
            },
        );
        return Err(extract_upstream_error_message(
            status,
            raw_json.as_ref(),
            raw_text.as_str(),
        ));
    }
    let raw_ttft_ms = raw_json.as_ref().and_then(extract_ttft_ms_from_response);
    let raw_billing_amount = raw_json
        .as_ref()
        .and_then(extract_billing_amount_from_response);
    let raw_cache_hit = extract_cache_hit_from_response(&response_headers, raw_json.as_ref());
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
    let (input_tokens, output_tokens, total_tokens) = extract_usage_from_response(&transformed);
    let computed_cost =
        calculate_token_cost(&model.pricing_config, input_tokens, output_tokens).unwrap_or(0.0);
    let reported_cost = extract_billing_amount_from_response(&transformed)
        .or(raw_billing_amount)
        .unwrap_or(computed_cost);
    let ttft_ms = extract_ttft_ms_from_response(&transformed).or(raw_ttft_ms);
    record_gateway_log(
        app_state.mcp.store.clone(),
        GatewayLogEntry {
            trace_id: trace_id.map(str::to_string),
            api_key_id: Some(instance.credentials_ref.clone())
                .filter(|value| !value.trim().is_empty()),
            preset_id: Some(instance.preset_slug.clone()).filter(|value| !value.trim().is_empty()),
            model: effective_model.clone(),
            status_code: status.as_u16() as i64,
            duration_ms: latency_ms as i64,
            ttft_ms,
            upstream_url: Some(prepared.display_url()),
            input_tokens,
            output_tokens,
            total_tokens,
            cost_upstream: computed_cost,
            cost_user: reported_cost,
            is_cached: extract_cache_hit_from_response(&response_headers, Some(&transformed))
                || raw_cache_hit,
            ..Default::default()
        },
    );
    let mut normalized = normalize_chat_completion_response(transformed);
    inject_runtime_metrics(&mut normalized, latency_ms as i64, ttft_ms, 1);
    Ok(normalized)
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
                            func.get("name")
                                .and_then(|value| value.as_str())
                                .unwrap_or(""),
                            func.get("arguments")
                                .and_then(|value| {
                                    if let Some(text) = value.as_str() {
                                        serde_json::from_str::<serde_json::Value>(text).ok()
                                    } else {
                                        Some(value.clone())
                                    }
                                })
                                .unwrap_or_else(|| serde_json::json!({})),
                        )
                    } else {
                        (
                            call.get("name")
                                .and_then(|value| value.as_str())
                                .unwrap_or(""),
                            call.get("arguments")
                                .cloned()
                                .unwrap_or_else(|| serde_json::json!({})),
                        )
                    };
                    normalized_tool_calls.push(serde_json::json!({
                        "id": call.get("id").and_then(|value| value.as_str()).unwrap_or_default(),
                        "name": function_name,
                        "arguments": arguments,
                        "extra_content": call
                            .get("extra_content")
                            .cloned()
                            .unwrap_or_else(|| serde_json::json!({}))
                    }));
                }
            }
        }
    }
    if normalized_tool_calls.is_empty() {
        if let Some(tool_calls) = raw.get("tool_calls").and_then(|value| value.as_array()) {
            normalized_tool_calls.extend(tool_calls.iter().cloned());
        }
    }
    let mut result = serde_json::json!({ "content": content, "tool_calls": normalized_tool_calls });
    if !reasoning_content.is_empty() {
        result["reasoning_content"] = serde_json::json!(reasoning_content);
    }
    result
}

pub(crate) fn extract_upstream_error_message(
    status: reqwest::StatusCode,
    raw_json: Option<&serde_json::Value>,
    raw_text: &str,
) -> String {
    if let Some(message) = raw_json
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(|item| item.as_str())
        })
        .or_else(|| {
            raw_json
                .and_then(|value| value.get("error"))
                .and_then(|item| item.as_str())
        })
        .or_else(|| {
            raw_json
                .and_then(|value| value.get("message"))
                .and_then(|item| item.as_str())
        })
        .or_else(|| {
            raw_json
                .and_then(|value| value.get("detail"))
                .and_then(|item| item.as_str())
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

pub(crate) fn truncate_upstream_body(text: &str, max_len: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_len {
        return trimmed.to_string();
    }
    format!("{}...", trimmed.chars().take(max_len).collect::<String>())
}
