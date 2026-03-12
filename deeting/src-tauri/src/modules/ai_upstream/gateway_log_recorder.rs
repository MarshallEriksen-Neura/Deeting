use std::sync::Arc;

use serde_json::Value;

use crate::modules::mcp::store::McpStore;

/// Metadata collected from an AI upstream call, ready to be persisted as a
/// gateway log entry.
#[derive(Default)]
pub struct GatewayLogEntry {
    pub trace_id: Option<String>,
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
