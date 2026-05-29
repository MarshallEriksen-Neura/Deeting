use std::collections::HashMap;

use crate::modules::ai_upstream::gateway_log_recorder::{
    build_gateway_log_meta, calculate_token_cost, extract_billing_amount_from_response,
    extract_cache_details_from_response, extract_error_code_from_response,
    extract_ttft_ms_from_response, extract_usage_details_from_response, record_gateway_log,
    GatewayLogEntry,
};
use crate::modules::ai_upstream::types::LocalModelConnection;
use crate::modules::providers::protocols::{
    build_canonical_chat_request_from_local_messages_with_reasoning,
    build_chat_request_data_from_canonical_request, infer_protocol_family,
};
use crate::modules::providers::request_runtime::{
    prepare_provider_request_from_canonical_request, send_prepared_json_request_with_retry,
    UpstreamRetryPolicy,
};
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;
use uuid::Uuid;

#[derive(Debug, Clone, Default)]
pub(crate) struct ReasoningRequestConfig {
    pub(crate) enabled: Option<bool>,
    pub(crate) effort: Option<String>,
}

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

fn normalize_model_pool_key(
    model: &crate::modules::providers::types::ProviderModel,
) -> Option<String> {
    model
        .unified_model_id
        .clone()
        .or_else(|| (!model.model_id.trim().is_empty()).then(|| model.model_id.clone()))
}

fn model_matches_requested(
    model: &crate::modules::providers::types::ProviderModel,
    requested: &str,
) -> bool {
    if requested.is_empty() {
        return false;
    }

    model.model_id.eq_ignore_ascii_case(requested)
        || model.id.to_string().eq_ignore_ascii_case(requested)
        || model
            .unified_model_id
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(requested))
            .unwrap_or(false)
        || model
            .display_name
            .as_deref()
            .map(|value| value.eq_ignore_ascii_case(requested))
            .unwrap_or(false)
}

pub(crate) async fn resolve_provider_model_connection(
    app_state: &AppState,
    provider_model_id: &str,
) -> Result<LocalModelConnection, String> {
    let provider_model_id = provider_model_id.trim();
    if provider_model_id.is_empty() {
        return Err("provider model id is required".to_string());
    }

    let model_uuid = Uuid::parse_str(provider_model_id).map_err(to_string)?;
    let model = app_state
        .providers
        .store
        .get_model(&model_uuid)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider model not found".to_string())?;
    if !model.is_active {
        return Err("provider model is inactive".to_string());
    }
    let instance = app_state
        .providers
        .store
        .get_instance(&model.instance_id.to_string())
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance not found".to_string())?;
    if !instance.is_enabled {
        return Err(format!("provider instance is disabled: {}", instance.name));
    }
    let connection = app_state
        .providers
        .store
        .get_instance_connection(&model.instance_id.to_string())
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance connection not found".to_string())?;
    Ok(LocalModelConnection {
        provider_model_id: model.id.to_string(),
        model_id: model.model_id.clone(),
        logical_model_key: normalize_model_pool_key(&model),
        protocol_family: infer_protocol_family(
            connection.protocol.as_deref().unwrap_or("openai"),
            model.upstream_path.as_str(),
        )
        .to_string(),
    })
}

pub(crate) async fn resolve_local_model_pool_connection(
    app_state: &AppState,
    requested_model: &str,
) -> Result<LocalModelConnection, String> {
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
    if requested.is_empty() {
        return Err("model pool key is required".to_string());
    }

    let candidate_models: Vec<_> = models
        .into_iter()
        .filter(|model| model_matches_requested(model, &requested))
        .collect();
    if candidate_models.is_empty() {
        return Err(format!("requested model pool not found: {requested_model}"));
    }

    let selected = if candidate_models.len() == 1 {
        candidate_models[0].clone()
    } else {
        select_model_by_bandit(app_state, &candidate_models).await
    };
    Ok(LocalModelConnection {
        provider_model_id: selected.id.to_string(),
        model_id: selected.model_id.clone(),
        logical_model_key: normalize_model_pool_key(&selected),
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

pub(crate) async fn resolve_local_model_connection(
    app_state: &AppState,
    requested_model: &str,
    requested_provider_model_id: Option<&str>,
) -> Result<LocalModelConnection, String> {
    if let Some(provider_model_id) = requested_provider_model_id {
        let provider_model_id = provider_model_id.trim();
        if !provider_model_id.is_empty() {
            return resolve_provider_model_connection(app_state, provider_model_id).await;
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
    let candidate_models: Vec<_> = models
        .iter()
        .filter(|model| model_matches_requested(model, &requested))
        .cloned()
        .collect();
    if !candidate_models.is_empty() {
        let selected = if candidate_models.len() == 1 {
            candidate_models[0].clone()
        } else {
            select_model_by_bandit(app_state, &candidate_models).await
        };
        return Ok(LocalModelConnection {
            provider_model_id: selected.id.to_string(),
            model_id: selected.model_id.clone(),
            logical_model_key: normalize_model_pool_key(&selected),
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
        });
    }

    let selected = select_model_by_bandit(app_state, &models).await;
    Ok(LocalModelConnection {
        provider_model_id: selected.id.to_string(),
        model_id: selected.model_id.clone(),
        logical_model_key: normalize_model_pool_key(&selected),
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
    use crate::modules::providers::bandit_selector::{select_arm, BanditConfig, BanditStrategy};
    use crate::modules::providers::store::{BANDIT_DEFAULT_SCENE, BANDIT_DEFAULT_STRATEGY};

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

    let default_strategy =
        BanditStrategy::parse(BANDIT_DEFAULT_STRATEGY).unwrap_or(BanditStrategy::Thompson);
    let strategy = arms
        .first()
        .map(|arm| BanditStrategy::parse_or(&arm.strategy, default_strategy))
        .unwrap_or(default_strategy);
    let cfg = BanditConfig {
        epsilon: arms.first().map(|arm| arm.epsilon).unwrap_or(0.1),
        ..BanditConfig::default()
    };

    select_arm(
        models,
        |model| model.id.to_string(),
        &arm_map,
        strategy,
        &cfg,
        &current_time_rfc3339,
    )
    .cloned()
    .unwrap_or_else(|| models[0].clone())
}

pub(crate) async fn request_provider_chat_completion(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    messages: Vec<LocalChatInputMessage>,
    tools: Option<serde_json::Value>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    reasoning: ReasoningRequestConfig,
    trace_id: Option<&str>,
    _session_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    request_provider_chat_completion_inner(
        app_state,
        provider_model_id,
        model_id,
        messages,
        tools,
        temperature,
        max_tokens,
        reasoning,
        trace_id,
        None,
    )
    .await
}

pub(crate) async fn request_provider_chat_json_object(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    messages: Vec<LocalChatInputMessage>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    reasoning: ReasoningRequestConfig,
    trace_id: Option<&str>,
    _session_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let response = request_provider_chat_completion_inner(
        app_state,
        provider_model_id,
        model_id,
        messages,
        None,
        temperature,
        max_tokens,
        reasoning,
        trace_id,
        Some(serde_json::json!({ "type": "json_object" })),
    )
    .await?;
    parse_normalized_json_object_response(&response).ok_or_else(|| {
        "provider did not return a structured JSON object response".to_string()
    })
}

async fn request_provider_chat_completion_inner(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    messages: Vec<LocalChatInputMessage>,
    tools: Option<serde_json::Value>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    reasoning: ReasoningRequestConfig,
    trace_id: Option<&str>,
    response_format: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let provider_model_uuid = Uuid::parse_str(provider_model_id).map_err(to_string)?;
    let model = app_state
        .providers
        .store
        .get_model(&provider_model_uuid)
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider model not found".to_string())?;
    if !model.is_active {
        return Err("provider model is inactive".to_string());
    }
    let instance = app_state
        .providers
        .store
        .get_instance(&model.instance_id.to_string())
        .await
        .map_err(to_string)?
        .ok_or_else(|| "provider instance not found".to_string())?;
    if !instance.is_enabled {
        return Err(format!("provider instance is disabled: {}", instance.name));
    }
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
        return Err(
            "platform credits runtime has been disabled; switch this model instance to local credentials".to_string(),
        );
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
    let canonical_request = build_canonical_chat_request_from_local_messages_with_reasoning(
        effective_model.as_str(),
        &messages,
        false,
        temperature.map(|value| value as f64),
        max_tokens.map(|value| value as i64),
        reasoning.enabled,
        reasoning.effort,
    );
    let body = build_chat_request_data_from_canonical_request(&canonical_request);
    let mut prepared = prepare_provider_request_from_canonical_request(
        preset.as_ref(),
        &instance,
        &model,
        connection.secret_key.as_deref(),
        "chat",
        body,
        canonical_request,
        tools.as_ref(),
        trace_id,
    )?;
    if let Some(response_format) = response_format {
        if let Some(body) = prepared.body.as_object_mut() {
            body.insert("response_format".to_string(), response_format);
        }
    }
    let upstream_request_meta = serde_json::json!({
        "method": prepared.method,
        "url": prepared.display_url(),
    });
    let client = crate::modules::desktop_config::network::build_proxy_aware_reqwest_client(
        app_state.mcp.store.as_ref(),
    )
    .await?;
    let call_start = std::time::Instant::now();
    let (response, retry_count) =
        send_prepared_json_request_with_retry(&client, &prepared, UpstreamRetryPolicy::default())
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
        let raw_usage = raw_json
            .as_ref()
            .map(extract_usage_details_from_response)
            .unwrap_or_default();
        let cache_details = extract_cache_details_from_response(
            &response_headers,
            raw_json.as_ref(),
            Some(&raw_usage),
        );
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
                retry_count,
                upstream_url: Some(prepared.display_url()),
                input_tokens: raw_usage.input_tokens,
                output_tokens: raw_usage.output_tokens,
                total_tokens: raw_usage.total_tokens,
                is_cached: cache_details.is_cached,
                error_code: extract_error_code_from_response(raw_json.as_ref()),
                meta: build_gateway_log_meta(
                    &raw_usage,
                    raw_usage.has_usage_details().then_some("provider_reported"),
                    &cache_details,
                    Some(&prepared.body),
                    Some(&upstream_request_meta),
                ),
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
    let raw = raw_json.ok_or_else(|| {
        format!(
            "failed to parse upstream json response (status={}): {}",
            status.as_u16(),
            truncate_upstream_body(raw_text.as_str(), 300)
        )
    })?;
    let raw_usage = extract_usage_details_from_response(&raw);
    let raw_cache_details =
        extract_cache_details_from_response(&response_headers, Some(&raw), Some(&raw_usage));
    let transformed = app_state.providers.transformer.transform(
        prepared.template_engine.as_str(),
        Some(prepared.response_decoder.as_str()),
        &prepared.response_transform,
        raw,
        status.as_u16(),
    );
    let transformed_usage = extract_usage_details_from_response(&transformed);
    let usage_details = transformed_usage.merged_with_fallback(&raw_usage);
    let usage_source = if transformed_usage.has_token_counts() {
        Some("transformed")
    } else if raw_usage.has_usage_details() {
        Some("provider_reported")
    } else {
        None
    };
    let cache_details = if raw_cache_details.cache_source.as_deref() == Some("unknown") {
        extract_cache_details_from_response(
            &response_headers,
            Some(&transformed),
            Some(&usage_details),
        )
    } else {
        raw_cache_details
    };
    let computed_cost = calculate_token_cost(
        &model.pricing_config,
        usage_details.input_tokens,
        usage_details.output_tokens,
    )
    .unwrap_or(0.0);
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
            input_tokens: usage_details.input_tokens,
            output_tokens: usage_details.output_tokens,
            total_tokens: usage_details.total_tokens,
            cost_upstream: computed_cost,
            cost_user: reported_cost,
            retry_count,
            is_cached: cache_details.is_cached,
            meta: build_gateway_log_meta(
                &usage_details,
                usage_source,
                &cache_details,
                Some(&prepared.body),
                Some(&upstream_request_meta),
            ),
            ..Default::default()
        },
    );
    let mut normalized = normalize_chat_completion_response(transformed);
    inject_runtime_metrics(&mut normalized, latency_ms as i64, ttft_ms, retry_count + 1);
    Ok(normalized)
}

fn parse_normalized_json_object_response(response: &serde_json::Value) -> Option<serde_json::Value> {
    if response.is_object()
        && response.get("content").is_none()
        && response.get("tool_calls").is_none()
    {
        return Some(response.clone());
    }
    let content = response.get("content")?.as_str()?.trim();
    if content.is_empty() {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .filter(serde_json::Value::is_object)
}

pub(crate) fn normalize_chat_completion_response(raw: serde_json::Value) -> serde_json::Value {
    let finish_reason = extract_finish_reason(&raw);
    let has_choice_payload = raw
        .get("choices")
        .and_then(|value| value.as_array())
        .map(|items| !items.is_empty())
        .unwrap_or(false);
    if raw.get("content").is_some() && raw.get("tool_calls").is_some() && !has_choice_payload {
        let mut result = raw;
        promote_terminal_reasoning_content(&mut result);
        if let Some(reason) = finish_reason {
            result["finish_reason"] = serde_json::json!(reason);
        }
        return result;
    }
    let usage = raw.get("usage").cloned();
    let mut content = extract_text_content(raw.get("content"));
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
                content = extract_text_content(message.get("content"));
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
        } else if let Some(content_blocks) = raw.get("content").and_then(|value| value.as_array()) {
            for block in content_blocks {
                if block.get("type").and_then(|value| value.as_str()) != Some("tool_use") {
                    continue;
                }
                normalized_tool_calls.push(serde_json::json!({
                    "id": block.get("id").and_then(|value| value.as_str()).unwrap_or_default(),
                    "name": block.get("name").and_then(|value| value.as_str()).unwrap_or_default(),
                    "arguments": block
                        .get("input")
                        .cloned()
                        .unwrap_or_else(|| serde_json::json!({})),
                    "extra_content": block.clone(),
                }));
            }
        }
    }
    let promote_reasoning_to_content = content.trim().is_empty()
        && normalized_tool_calls.is_empty()
        && !reasoning_content.trim().is_empty();
    if promote_reasoning_to_content {
        content = reasoning_content.trim().to_string();
        reasoning_content.clear();
    }

    let mut result = serde_json::json!({ "content": content, "tool_calls": normalized_tool_calls });
    if !reasoning_content.trim().is_empty() {
        result["reasoning_content"] = serde_json::json!(reasoning_content);
    }
    if let Some(usage) = usage {
        result["usage"] = usage;
    }
    if let Some(reason) = finish_reason {
        result["finish_reason"] = serde_json::json!(reason);
    }
    result
}

fn promote_terminal_reasoning_content(result: &mut serde_json::Value) {
    let content = extract_text_content(result.get("content"));
    if !content.trim().is_empty() {
        return;
    }

    let has_tool_calls = result
        .get("tool_calls")
        .and_then(|value| value.as_array())
        .is_some_and(|items| !items.is_empty());
    if has_tool_calls {
        return;
    }

    let Some(reasoning_content) = result
        .get("reasoning_content")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    else {
        return;
    };

    if let Some(object) = result.as_object_mut() {
        object.insert("content".to_string(), serde_json::json!(reasoning_content));
        object.remove("reasoning_content");
    }
}

fn extract_finish_reason(raw: &serde_json::Value) -> Option<String> {
    raw.get("finish_reason")
        .and_then(|value| value.as_str())
        .or_else(|| {
            raw.get("choices")
                .and_then(|value| value.as_array())
                .and_then(|items| items.first())
                .and_then(|choice| choice.get("finish_reason"))
                .and_then(|value| value.as_str())
        })
        .or_else(|| raw.get("stop_reason").and_then(|value| value.as_str()))
        .or_else(|| {
            raw.get("choices")
                .and_then(|value| value.as_array())
                .and_then(|items| items.first())
                .and_then(|choice| choice.get("stop_reason"))
                .and_then(|value| value.as_str())
        })
        .or_else(|| raw.get("status").and_then(|value| value.as_str()))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn extract_text_content(value: Option<&serde_json::Value>) -> String {
    match value {
        Some(serde_json::Value::String(text)) => text.clone(),
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .filter_map(|item| {
                item.as_object().and_then(|object| {
                    let block_type = object.get("type").and_then(|value| value.as_str());
                    if matches!(block_type, Some("tool_use") | Some("server_tool_use")) {
                        return None;
                    }
                    object
                        .get("text")
                        .and_then(|value| value.as_str())
                        .or_else(|| object.get("content").and_then(|value| value.as_str()))
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(ToString::to_string)
                })
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(serde_json::Value::Object(object)) => object
            .get("text")
            .and_then(|value| value.as_str())
            .or_else(|| object.get("content").and_then(|value| value.as_str()))
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
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
        let mut details = Vec::new();
        for (label, pointer) in [
            ("param", "/error/param"),
            ("code", "/error/code"),
            ("type", "/error/type"),
        ] {
            if let Some(value) = raw_json
                .and_then(|item| item.pointer(pointer))
                .and_then(|item| item.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                details.push(format!("{label}: {value}"));
            }
        }
        if details.is_empty() {
            return message.to_string();
        }
        return format!("{message} ({})", details.join(", "));
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn normalize_chat_completion_response_preserves_usage_when_flattening_choices() {
        let normalized = super::normalize_chat_completion_response(json!({
            "choices": [{
                "message": {
                    "content": "hello"
                },
                "finish_reason": "length"
            }],
            "usage": {
                "prompt_tokens": 11,
                "completion_tokens": 7,
                "total_tokens": 18
            }
        }));

        assert_eq!(normalized["content"], json!("hello"));
        assert_eq!(normalized["usage"]["total_tokens"], json!(18));
        assert_eq!(normalized["finish_reason"], json!("length"));
    }

    #[test]
    fn normalize_chat_completion_response_uses_choices_when_flat_content_is_empty() {
        let normalized = super::normalize_chat_completion_response(json!({
            "content": "",
            "tool_calls": [],
            "choices": [{
                "message": {
                    "content": "choice text should not be lost"
                },
                "finish_reason": "stop"
            }]
        }));

        assert_eq!(
            normalized["content"],
            json!("choice text should not be lost")
        );
        assert_eq!(normalized["tool_calls"], json!([]));
        assert_eq!(normalized["finish_reason"], json!("stop"));
    }

    #[test]
    fn normalize_chat_completion_response_extracts_text_from_raw_anthropic_message() {
        let normalized = super::normalize_chat_completion_response(json!({
            "id": "msg_123",
            "type": "message",
            "role": "assistant",
            "model": "claude-haiku-4-5",
            "content": [
                {
                    "type": "text",
                    "text": "Hello! How can I help you today?"
                }
            ],
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": 28,
                "output_tokens": 9
            }
        }));

        assert_eq!(
            normalized["content"],
            json!("Hello! How can I help you today?")
        );
        assert_eq!(normalized["finish_reason"], json!("end_turn"));
        assert_eq!(normalized["usage"]["input_tokens"], json!(28));
        assert_eq!(normalized["usage"]["output_tokens"], json!(9));
    }

    #[test]
    fn normalize_chat_completion_response_promotes_reasoning_only_terminal_answer() {
        let normalized = super::normalize_chat_completion_response(json!({
            "choices": [{
                "message": {
                    "content": null,
                    "reasoning_content": "Final visible answer."
                },
                "finish_reason": "stop"
            }]
        }));

        assert_eq!(normalized["content"], json!("Final visible answer."));
        assert_eq!(normalized["tool_calls"], json!([]));
        assert!(normalized.get("reasoning_content").is_none());
        assert_eq!(normalized["finish_reason"], json!("stop"));
    }

    #[test]
    fn normalize_chat_completion_response_promotes_flat_reasoning_only_terminal_answer() {
        let normalized = super::normalize_chat_completion_response(json!({
            "content": "",
            "reasoning_content": "Flat final answer.",
            "tool_calls": [],
            "finish_reason": "stop"
        }));

        assert_eq!(normalized["content"], json!("Flat final answer."));
        assert!(normalized.get("reasoning_content").is_none());
        assert_eq!(normalized["finish_reason"], json!("stop"));
    }

    #[test]
    fn normalize_chat_completion_response_keeps_reasoning_with_tool_calls() {
        let normalized = super::normalize_chat_completion_response(json!({
            "choices": [{
                "message": {
                    "content": null,
                    "reasoning_content": "Need to call the tool.",
                    "tool_calls": [{
                        "id": "call_1",
                        "function": {
                            "name": "search_sdk",
                            "arguments": "{\"query\":\"fund\"}"
                        }
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        }));

        assert_eq!(normalized["content"], json!(""));
        assert_eq!(
            normalized["reasoning_content"],
            json!("Need to call the tool.")
        );
        assert_eq!(normalized["tool_calls"][0]["name"], json!("search_sdk"));
    }

    #[test]
    fn extract_upstream_error_message_includes_openai_error_param_and_code() {
        let message = super::extract_upstream_error_message(
            reqwest::StatusCode::BAD_REQUEST,
            Some(&json!({
                "error": {
                    "message": "Invalid value: '{\"type\":\"image_generation\"}'. Supported values are: 'none', 'auto', and 'required'.",
                    "type": "invalid_request_error",
                    "param": "tool_choice",
                    "code": "invalid_value"
                }
            })),
            "",
        );

        assert!(message.contains("Invalid value"));
        assert!(message.contains("param: tool_choice"));
        assert!(message.contains("code: invalid_value"));
    }
}
