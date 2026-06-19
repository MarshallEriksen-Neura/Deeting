use crate::modules::ai_upstream::connection_resolver::resolve_cached_model_connection;
use crate::modules::ai_upstream::gateway_log_recorder::{
    build_gateway_log_meta, calculate_token_cost, extract_cache_details_from_response,
    record_gateway_log, GatewayLogEntry,
};
use crate::modules::providers::protocols::{
    build_canonical_chat_request_from_local_messages_with_reasoning,
    build_chat_request_data_from_canonical_request,
};
use crate::modules::providers::request_runtime::{
    prepare_provider_request_from_canonical_request, send_prepared_json_request_with_retry,
    UpstreamRetryPolicy,
};
use crate::modules::providers::response_processor::ResponseProcessor;
use crate::state::AppState;
use mcp_core::types::LocalChatInputMessage;

/// 重构后的聊天完成请求 - 使用统一的响应处理器和连接缓存
///
/// 优化点：
/// 1. 使用 `resolve_cached_model_connection` 避免重复查询数据库
/// 2. 使用 `ResponseProcessor::process` 统一处理响应
/// 3. 减少重复的字段提取代码
pub(crate) async fn request_chat_completion_optimized(
    app_state: &AppState,
    provider_model_id: &str,
    model_id: &str,
    messages: Vec<LocalChatInputMessage>,
    tools: Option<serde_json::Value>,
    temperature: Option<f32>,
    max_tokens: Option<u32>,
    reasoning_enabled: Option<bool>,
    reasoning_effort: Option<String>,
    trace_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    // 1. 从缓存或数据库获取连接信息（避免重复查询）
    let cached = resolve_cached_model_connection(app_state, provider_model_id).await?;

    let effective_model = if model_id.trim().is_empty() {
        cached.model.model_id.clone()
    } else {
        model_id.to_string()
    };

    // 2. 构建请求
    let canonical_request = build_canonical_chat_request_from_local_messages_with_reasoning(
        effective_model.as_str(),
        &messages,
        false,
        temperature.map(|v| v as f64),
        max_tokens.map(|v| v as i64),
        reasoning_enabled,
        reasoning_effort,
    );
    let body = build_chat_request_data_from_canonical_request(&canonical_request);
    let prepared = prepare_provider_request_from_canonical_request(
        cached.preset.as_ref(),
        &cached.instance,
        &cached.model,
        cached.secret_key.as_deref(),
        "chat",
        body,
        canonical_request,
        tools.as_ref(),
        trace_id,
    )?;

    let upstream_request_meta = serde_json::json!({
        "method": prepared.method,
        "url": prepared.display_url(),
    });

    // 3. 发送请求
    let client = crate::modules::desktop_config::network::build_proxy_aware_reqwest_client(
        app_state.mcp.store.as_ref(),
    )
    .await?;

    let call_start = std::time::Instant::now();
    let (response, retry_count) =
        send_prepared_json_request_with_retry(&client, &prepared, UpstreamRetryPolicy::default())
            .await?;

    let latency_ms = call_start.elapsed().as_millis() as i64;

    // 4. 使用统一的响应处理器（替代分散的 extract_* 函数）
    let processed = ResponseProcessor::process(
        response.status,
        response.headers.clone(),
        response.json.clone().unwrap_or_default(),
        Some(latency_ms),
        retry_count + 1,
    );

    // 5. 记录 bandit 反馈
    crate::modules::ai_upstream::chat::record_provider_model_bandit_feedback(
        app_state,
        provider_model_id,
        processed.status < 400,
        Some(latency_ms as f64),
    )
    .await;

    // 6. 处理错误响应
    if processed.status >= 400 {
        let raw_usage = processed.usage.as_ref();
        let cache_details = extract_cache_details_from_response(
            &response.headers,
            Some(&processed.json),
            raw_usage.map(|u| &crate::modules::ai_upstream::gateway_log_recorder::GatewayUsageDetails {
                input_tokens: u.prompt_tokens,
                output_tokens: u.completion_tokens,
                total_tokens: u.total_tokens,
                cache_creation_input_tokens: u.cache_creation_input_tokens,
                cache_read_input_tokens: u.cache_read_input_tokens,
                cache_discount_tokens: None,
            }),
        );

        record_gateway_log(
            app_state.mcp.store.clone(),
            GatewayLogEntry {
                trace_id: trace_id.map(str::to_string),
                api_key_id: Some(cached.instance.credentials_ref.clone())
                    .filter(|v| !v.trim().is_empty()),
                preset_id: Some(cached.instance.preset_slug.clone())
                    .filter(|v| !v.trim().is_empty()),
                model: effective_model.clone(),
                status_code: processed.status as i64,
                duration_ms: latency_ms,
                retry_count,
                upstream_url: Some(prepared.display_url()),
                input_tokens: processed.usage.as_ref().map(|u| u.prompt_tokens),
                output_tokens: processed.usage.as_ref().map(|u| u.completion_tokens),
                total_tokens: processed.usage.as_ref().map(|u| u.total_tokens),
                is_cached: cache_details.is_cached,
                error_code: processed.error.as_ref().map(|e| e.code.clone()),
                meta: build_gateway_log_meta(
                    raw_usage.map(|u| &crate::modules::ai_upstream::gateway_log_recorder::GatewayUsageDetails {
                        input_tokens: u.prompt_tokens,
                        output_tokens: u.completion_tokens,
                        total_tokens: u.total_tokens,
                        cache_creation_input_tokens: u.cache_creation_input_tokens,
                        cache_read_input_tokens: u.cache_read_input_tokens,
                        cache_discount_tokens: None,
                    }).as_ref(),
                    raw_usage.and(Some("provider_reported")),
                    &cache_details,
                    Some(&prepared.body),
                    Some(&upstream_request_meta),
                ),
                ..Default::default()
            },
        );

        let error_message = processed
            .error
            .as_ref()
            .map(|e| format!("{}: {}", e.code, e.message))
            .unwrap_or_else(|| format!("HTTP {}", processed.status));

        return Err(error_message);
    }

    // 7. 转换响应
    let transformed = app_state.providers.transformer.transform(
        prepared.template_engine.as_str(),
        Some(prepared.response_decoder.as_str()),
        &prepared.response_transform,
        processed.json.clone(),
        processed.status,
    );

    // 8. 计算成本
    let computed_cost = if let Some(usage) = &processed.usage {
        ResponseProcessor::calculate_token_cost(
            usage,
            cached.model.pricing_config.get("input_price_per_million").and_then(|v| v.as_f64()),
            cached.model.pricing_config.get("output_price_per_million").and_then(|v| v.as_f64()),
            cached.model.pricing_config.get("cache_write_price_per_million").and_then(|v| v.as_f64()),
            cached.model.pricing_config.get("cache_read_price_per_million").and_then(|v| v.as_f64()),
        )
        .unwrap_or(0.0)
    } else {
        0.0
    };

    // 9. 记录成功日志
    let cache_details = extract_cache_details_from_response(
        &response.headers,
        Some(&transformed),
        processed.usage.as_ref().map(|u| &crate::modules::ai_upstream::gateway_log_recorder::GatewayUsageDetails {
            input_tokens: u.prompt_tokens,
            output_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
            cache_creation_input_tokens: u.cache_creation_input_tokens,
            cache_read_input_tokens: u.cache_read_input_tokens,
            cache_discount_tokens: None,
        }),
    );

    record_gateway_log(
        app_state.mcp.store.clone(),
        GatewayLogEntry {
            trace_id: trace_id.map(str::to_string),
            api_key_id: Some(cached.instance.credentials_ref.clone())
                .filter(|v| !v.trim().is_empty()),
            preset_id: Some(cached.instance.preset_slug.clone())
                .filter(|v| !v.trim().is_empty()),
            model: effective_model.clone(),
            status_code: processed.status as i64,
            duration_ms: latency_ms,
            ttft_ms: processed.metrics.ttft_ms,
            upstream_url: Some(prepared.display_url()),
            input_tokens: processed.usage.as_ref().map(|u| u.prompt_tokens),
            output_tokens: processed.usage.as_ref().map(|u| u.completion_tokens),
            total_tokens: processed.usage.as_ref().map(|u| u.total_tokens),
            cost_upstream: Some(computed_cost),
            cost_user: Some(computed_cost),
            retry_count,
            is_cached: cache_details.is_cached,
            meta: build_gateway_log_meta(
                processed.usage.as_ref().map(|u| &crate::modules::ai_upstream::gateway_log_recorder::GatewayUsageDetails {
                    input_tokens: u.prompt_tokens,
                    output_tokens: u.completion_tokens,
                    total_tokens: u.total_tokens,
                    cache_creation_input_tokens: u.cache_creation_input_tokens,
                    cache_read_input_tokens: u.cache_read_input_tokens,
                    cache_discount_tokens: None,
                }).as_ref(),
                processed.usage.and(Some("provider_reported")),
                &cache_details,
                Some(&prepared.body),
                Some(&upstream_request_meta),
            ),
            ..Default::default()
        },
    );

    // 10. 注入运行时指标并返回
    let mut result = crate::modules::ai_upstream::chat::normalize_chat_completion_response(transformed);
    ResponseProcessor::inject_metrics(&mut result, &processed.metrics);

    Ok(result)
}
