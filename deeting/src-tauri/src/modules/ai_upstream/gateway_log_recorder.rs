use std::sync::Arc;

use serde_json::Value;

use crate::modules::mcp::store::McpStore;

/// Metadata collected from an AI upstream call, ready to be persisted as a
/// gateway log entry.
#[derive(Default)]
pub struct GatewayLogEntry {
    pub trace_id: Option<String>,
    pub user_id: Option<String>,
    pub api_key_id: Option<String>,
    pub preset_id: Option<String>,
    pub model: String,
    pub status_code: i64,
    pub duration_ms: i64,
    pub ttft_ms: Option<i64>,
    pub upstream_url: Option<String>,
    pub retry_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cost_upstream: f64,
    pub cost_user: f64,
    pub is_cached: bool,
    pub error_code: Option<String>,
    pub meta: Option<Value>,
}

fn first_positive_i64<'a>(candidates: impl IntoIterator<Item = Option<&'a Value>>) -> Option<i64> {
    candidates.into_iter().flatten().find_map(|value| {
        value
            .as_i64()
            .or_else(|| value.as_u64().map(|raw| raw as i64))
            .filter(|raw| *raw > 0)
    })
}

fn first_number<'a>(candidates: impl IntoIterator<Item = Option<&'a Value>>) -> Option<f64> {
    candidates.into_iter().flatten().find_map(|value| {
        value
            .as_f64()
            .filter(|raw| raw.is_finite())
            .or_else(|| value.as_i64().map(|raw| raw as f64))
            .or_else(|| value.as_u64().map(|raw| raw as f64))
    })
}

pub fn extract_ttft_ms_from_response(response: &Value) -> Option<i64> {
    first_positive_i64([
        response.get("ttft_ms"),
        response.pointer("/metrics/ttft_ms"),
        response.pointer("/meta/ttft_ms"),
        response.pointer("/usage/ttft_ms"),
    ])
}

pub fn extract_billing_amount_from_response(response: &Value) -> Option<f64> {
    first_number([
        response.pointer("/billing/amount"),
        response.pointer("/billing/total_cost"),
        response.pointer("/cost/total"),
        response.get("cost"),
    ])
    .filter(|value| *value >= 0.0)
}

pub fn calculate_token_cost(
    pricing_config: &Value,
    input_tokens: i64,
    output_tokens: i64,
) -> Option<f64> {
    if input_tokens <= 0 && output_tokens <= 0 {
        return None;
    }

    let input_per_1k = first_number([
        pricing_config.get("input_per_1k"),
        pricing_config.get("input"),
        pricing_config.get("input_price"),
    ])
    .unwrap_or(0.0);
    let output_per_1k = first_number([
        pricing_config.get("output_per_1k"),
        pricing_config.get("output"),
        pricing_config.get("output_price"),
    ])
    .unwrap_or(0.0);

    if input_per_1k <= 0.0 && output_per_1k <= 0.0 {
        return None;
    }

    let input_cost = (input_tokens.max(0) as f64 / 1000.0) * input_per_1k.max(0.0);
    let output_cost = (output_tokens.max(0) as f64 / 1000.0) * output_per_1k.max(0.0);
    Some((input_cost + output_cost).max(0.0))
}

pub fn extract_cache_hit_from_response(
    headers: &std::collections::BTreeMap<String, String>,
    response: Option<&Value>,
) -> bool {
    let header_hit = headers.iter().any(|(key, value)| {
        let normalized_key = key.trim().to_ascii_lowercase();
        let normalized_value = value.trim().to_ascii_lowercase();
        matches!(
            normalized_key.as_str(),
            "x-cache" | "cf-cache-status" | "x-proxy-cache" | "x-cache-status"
        ) && matches!(
            normalized_value.as_str(),
            "hit" | "cached" | "true" | "yes" | "1" | "tcp_hit"
        )
    });
    if header_hit {
        return true;
    }

    response
        .and_then(|value| {
            value
                .get("cached")
                .or_else(|| value.pointer("/meta/cached"))
                .or_else(|| value.pointer("/cache/hit"))
                .or_else(|| value.pointer("/cache/is_hit"))
        })
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Extract token usage from a provider response JSON.
///
/// Handles OpenAI (`prompt_tokens` / `completion_tokens`), Anthropic
/// (`input_tokens` / `output_tokens`), and Gemini (`promptTokenCount` /
/// `candidatesTokenCount`) formats.  The response_transformer already
/// normalises most providers into the OpenAI style, so the primary lookup
/// paths are `usage.prompt_tokens` and `usage.input_tokens`.
pub fn extract_usage_from_response(response: &Value) -> (i64, i64, i64) {
    let usage = match response.get("usage") {
        Some(u) => u,
        None => return (0, 0, 0),
    };

    let input = usage
        .get("prompt_tokens")
        .or_else(|| usage.get("input_tokens"))
        .or_else(|| usage.get("promptTokenCount"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let output = usage
        .get("completion_tokens")
        .or_else(|| usage.get("output_tokens"))
        .or_else(|| usage.get("candidatesTokenCount"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    let total = usage
        .get("total_tokens")
        .or_else(|| usage.get("totalTokenCount"))
        .and_then(|v| v.as_i64())
        .unwrap_or(input + output);

    (input, output, total)
}

/// Extract an error code from a failed upstream response.
pub fn extract_error_code_from_response(response: Option<&Value>) -> Option<String> {
    response
        .and_then(|v| {
            v.pointer("/error/code")
                .or_else(|| v.pointer("/error/type"))
                .or_else(|| v.get("error_code"))
        })
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

/// Asynchronously persist a gateway log entry.
///
/// The write is fire-and-forget (`tokio::spawn`): it never blocks the
/// request path and failures are logged at warn level only.
pub fn record_gateway_log(store: Arc<McpStore>, entry: GatewayLogEntry) {
    tokio::spawn(async move {
        if let Err(err) = store
            .create_local_gateway_log(
                entry.trace_id.as_deref(),
                entry.user_id.as_deref(),
                entry.api_key_id.as_deref(),
                entry.preset_id.as_deref(),
                &entry.model,
                entry.status_code,
                entry.duration_ms,
                entry.ttft_ms,
                entry.upstream_url.as_deref(),
                entry.retry_count,
                entry.input_tokens,
                entry.output_tokens,
                entry.total_tokens,
                entry.cost_upstream,
                entry.cost_user,
                entry.is_cached,
                entry.error_code.as_deref(),
                entry.meta.as_ref(),
            )
            .await
        {
            log::warn!("[gateway_log] failed to record: {}", err);
        }
    });
}
