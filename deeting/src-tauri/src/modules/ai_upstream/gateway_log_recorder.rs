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

#[derive(Debug, Clone, Default)]
pub struct GatewayUsageDetails {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub total_tokens: i64,
    pub cached_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
    pub cache_write_input_tokens: Option<i64>,
    pub provider_usage_raw: Option<Value>,
}

impl GatewayUsageDetails {
    pub fn has_token_counts(&self) -> bool {
        self.input_tokens > 0 || self.output_tokens > 0 || self.total_tokens > 0
    }

    pub fn has_usage_details(&self) -> bool {
        self.has_token_counts()
            || self.cached_tokens.is_some()
            || self.cache_read_input_tokens.is_some()
            || self.cache_write_input_tokens.is_some()
            || self.provider_usage_raw.is_some()
    }

    pub fn merged_with_fallback(&self, fallback: &Self) -> Self {
        let use_primary_tokens = self.has_token_counts();
        Self {
            input_tokens: if use_primary_tokens {
                self.input_tokens
            } else {
                fallback.input_tokens
            },
            output_tokens: if use_primary_tokens {
                self.output_tokens
            } else {
                fallback.output_tokens
            },
            total_tokens: if use_primary_tokens {
                self.total_tokens
            } else {
                fallback.total_tokens
            },
            cached_tokens: self.cached_tokens.or(fallback.cached_tokens),
            cache_read_input_tokens: self
                .cache_read_input_tokens
                .or(fallback.cache_read_input_tokens),
            cache_write_input_tokens: self
                .cache_write_input_tokens
                .or(fallback.cache_write_input_tokens),
            provider_usage_raw: self
                .provider_usage_raw
                .clone()
                .or_else(|| fallback.provider_usage_raw.clone()),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct GatewayCacheDetails {
    pub is_cached: bool,
    pub cache_source: Option<String>,
}

fn first_positive_i64<'a>(candidates: impl IntoIterator<Item = Option<&'a Value>>) -> Option<i64> {
    candidates.into_iter().flatten().find_map(|value| {
        value
            .as_i64()
            .or_else(|| value.as_u64().map(|raw| raw as i64))
            .filter(|raw| *raw > 0)
    })
}

fn first_non_negative_i64<'a>(
    candidates: impl IntoIterator<Item = Option<&'a Value>>,
) -> Option<i64> {
    candidates.into_iter().flatten().find_map(|value| {
        value
            .as_i64()
            .or_else(|| value.as_u64().map(|raw| raw as i64))
            .filter(|raw| *raw >= 0)
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
    extract_cache_details_from_response(headers, response, None).is_cached
}

fn extract_cache_hit_from_headers(headers: &std::collections::BTreeMap<String, String>) -> bool {
    headers.iter().any(|(key, value)| {
        let normalized_key = key.trim().to_ascii_lowercase();
        let normalized_value = value.trim().to_ascii_lowercase();
        matches!(
            normalized_key.as_str(),
            "x-cache" | "cf-cache-status" | "x-proxy-cache" | "x-cache-status"
        ) && matches!(
            normalized_value.as_str(),
            "hit" | "cached" | "true" | "yes" | "1" | "tcp_hit"
        )
    })
}

fn extract_cache_hit_from_response_body(response: Option<&Value>) -> Option<bool> {
    response
        .and_then(|value| {
            value
                .get("cached")
                .or_else(|| value.pointer("/meta/cached"))
                .or_else(|| value.pointer("/cache/hit"))
                .or_else(|| value.pointer("/cache/is_hit"))
        })
        .and_then(Value::as_bool)
}

pub fn extract_cache_details_from_response(
    headers: &std::collections::BTreeMap<String, String>,
    response: Option<&Value>,
    usage: Option<&GatewayUsageDetails>,
) -> GatewayCacheDetails {
    let provider_cache_hit = usage.map_or(false, |details| {
        details.cached_tokens.unwrap_or(0) > 0 || details.cache_read_input_tokens.unwrap_or(0) > 0
    });
    if provider_cache_hit {
        return GatewayCacheDetails {
            is_cached: true,
            cache_source: Some("provider_reported".to_string()),
        };
    }

    if let Some(body_hit) = extract_cache_hit_from_response_body(response) {
        return GatewayCacheDetails {
            is_cached: body_hit,
            cache_source: Some("provider_reported".to_string()),
        };
    }

    if extract_cache_hit_from_headers(headers) {
        return GatewayCacheDetails {
            is_cached: true,
            cache_source: Some("header_inferred".to_string()),
        };
    }

    GatewayCacheDetails {
        is_cached: false,
        cache_source: Some("unknown".to_string()),
    }
}

fn extract_provider_usage_raw(response: &Value) -> Option<Value> {
    response
        .get("usage")
        .cloned()
        .or_else(|| response.get("usageMetadata").cloned())
        .or_else(|| response.get("usage_metadata").cloned())
}

/// Extract token usage from a provider response JSON.
///
/// Handles OpenAI (`prompt_tokens` / `completion_tokens`), Anthropic
/// (`input_tokens` / `output_tokens`), and Gemini (`promptTokenCount` /
/// `candidatesTokenCount`) formats.  The response_transformer already
/// normalises most providers into the OpenAI style, so the primary lookup
/// paths are `usage.prompt_tokens` and `usage.input_tokens`.
pub fn extract_usage_details_from_response(response: &Value) -> GatewayUsageDetails {
    let input_tokens = first_non_negative_i64([
        response.pointer("/usage/prompt_tokens"),
        response.pointer("/usage/input_tokens"),
        response.pointer("/usageMetadata/promptTokenCount"),
        response.pointer("/usage_metadata/prompt_token_count"),
    ])
    .unwrap_or(0);

    let output_tokens = first_non_negative_i64([
        response.pointer("/usage/completion_tokens"),
        response.pointer("/usage/output_tokens"),
        response.pointer("/usageMetadata/candidatesTokenCount"),
        response.pointer("/usage_metadata/candidates_token_count"),
    ])
    .unwrap_or(0);

    let total_tokens = first_non_negative_i64([
        response.pointer("/usage/total_tokens"),
        response.pointer("/usage/totalTokenCount"),
        response.pointer("/usageMetadata/totalTokenCount"),
        response.pointer("/usage_metadata/total_token_count"),
    ])
    .unwrap_or(input_tokens + output_tokens);

    let mut cached_tokens = first_non_negative_i64([
        response.pointer("/usage/prompt_tokens_details/cached_tokens"),
        response.pointer("/usage/cached_tokens"),
        response.pointer("/usageMetadata/cachedContentTokenCount"),
        response.pointer("/usage_metadata/cached_content_token_count"),
    ]);
    let mut cache_read_input_tokens = first_non_negative_i64([
        response.pointer("/usage/cache_read_input_tokens"),
        response.pointer("/usage/prompt_tokens_details/cached_tokens"),
        response.pointer("/usageMetadata/cachedContentTokenCount"),
        response.pointer("/usage_metadata/cache_read_input_tokens"),
    ]);
    let cache_write_input_tokens = first_non_negative_i64([
        response.pointer("/usage/cache_creation_input_tokens"),
        response.pointer("/usage/cache_write_input_tokens"),
        response.pointer("/usageMetadata/cacheWriteTokenCount"),
        response.pointer("/usage_metadata/cache_write_input_tokens"),
    ]);

    if cached_tokens.is_none() {
        cached_tokens = cache_read_input_tokens;
    }
    if cache_read_input_tokens.is_none() {
        cache_read_input_tokens = cached_tokens;
    }

    GatewayUsageDetails {
        input_tokens,
        output_tokens,
        total_tokens,
        cached_tokens,
        cache_read_input_tokens,
        cache_write_input_tokens,
        provider_usage_raw: extract_provider_usage_raw(response),
    }
}

pub fn extract_usage_from_response(response: &Value) -> (i64, i64, i64) {
    let details = extract_usage_details_from_response(response);
    (
        details.input_tokens,
        details.output_tokens,
        details.total_tokens,
    )
}

pub fn build_gateway_log_meta(
    usage: &GatewayUsageDetails,
    usage_source: Option<&str>,
    cache: &GatewayCacheDetails,
    request_payload: Option<&Value>,
    upstream_request: Option<&Value>,
) -> Option<Value> {
    let normalized_usage_source = usage_source
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown");
    let normalized_cache_source = cache
        .cache_source
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown");
    let has_extra_details = usage.cached_tokens.is_some()
        || usage.cache_read_input_tokens.is_some()
        || usage.cache_write_input_tokens.is_some()
        || usage.provider_usage_raw.is_some()
        || cache.is_cached
        || normalized_usage_source != "unknown"
        || normalized_cache_source != "unknown"
        || request_payload.is_some()
        || upstream_request.is_some();

    if !has_extra_details {
        return None;
    }

    let mut normalized = serde_json::Map::new();
    normalized.insert(
        "usage_source".to_string(),
        Value::String(normalized_usage_source.to_string()),
    );
    normalized.insert(
        "request_cache_hit".to_string(),
        Value::Bool(cache.is_cached),
    );
    normalized.insert(
        "cache_source".to_string(),
        Value::String(normalized_cache_source.to_string()),
    );
    if let Some(value) = usage.cached_tokens {
        normalized.insert("cached_tokens".to_string(), Value::from(value));
    }
    if let Some(value) = usage.cache_read_input_tokens {
        normalized.insert("cache_read_input_tokens".to_string(), Value::from(value));
    }
    if let Some(value) = usage.cache_write_input_tokens {
        normalized.insert("cache_write_input_tokens".to_string(), Value::from(value));
    }

    let mut meta = serde_json::Map::new();
    meta.insert("usage_normalized".to_string(), Value::Object(normalized));
    if let Some(raw) = usage.provider_usage_raw.clone() {
        meta.insert("provider_usage_raw".to_string(), raw);
    }
    if let Some(payload) = request_payload.cloned() {
        meta.insert("request_payload".to_string(), payload);
    }
    if let Some(request) = upstream_request.cloned() {
        meta.insert("upstream_request".to_string(), request);
    }
    Some(Value::Object(meta))
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

#[cfg(test)]
mod tests {
    use super::{
        build_gateway_log_meta, extract_cache_details_from_response,
        extract_usage_details_from_response,
    };
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn extracts_openai_cached_tokens_into_normalized_usage() {
        let payload = json!({
            "usage": {
                "prompt_tokens": 120,
                "completion_tokens": 30,
                "total_tokens": 150,
                "prompt_tokens_details": {
                    "cached_tokens": 48
                }
            }
        });

        let details = extract_usage_details_from_response(&payload);

        assert_eq!(details.input_tokens, 120);
        assert_eq!(details.output_tokens, 30);
        assert_eq!(details.total_tokens, 150);
        assert_eq!(details.cached_tokens, Some(48));
        assert_eq!(details.cache_read_input_tokens, Some(48));
    }

    #[test]
    fn extracts_anthropic_cache_read_and_write_tokens() {
        let payload = json!({
            "usage": {
                "input_tokens": 96,
                "output_tokens": 12,
                "cache_read_input_tokens": 64,
                "cache_creation_input_tokens": 32
            }
        });

        let details = extract_usage_details_from_response(&payload);

        assert_eq!(details.input_tokens, 96);
        assert_eq!(details.output_tokens, 12);
        assert_eq!(details.total_tokens, 108);
        assert_eq!(details.cached_tokens, Some(64));
        assert_eq!(details.cache_read_input_tokens, Some(64));
        assert_eq!(details.cache_write_input_tokens, Some(32));
    }

    #[test]
    fn cache_details_prefer_provider_reported_usage_over_headers() {
        let payload = json!({
            "usage": {
                "prompt_tokens": 120,
                "completion_tokens": 30,
                "prompt_tokens_details": {
                    "cached_tokens": 48
                }
            }
        });
        let mut headers = BTreeMap::new();
        headers.insert("x-cache".to_string(), "MISS".to_string());

        let usage = extract_usage_details_from_response(&payload);
        let cache = extract_cache_details_from_response(&headers, Some(&payload), Some(&usage));

        assert!(cache.is_cached);
        assert_eq!(cache.cache_source.as_deref(), Some("provider_reported"));
    }

    #[test]
    fn builds_gateway_log_meta_with_normalized_usage_snapshot() {
        let payload = json!({
            "usage": {
                "input_tokens": 80,
                "output_tokens": 20,
                "cache_read_input_tokens": 24
            }
        });
        let usage = extract_usage_details_from_response(&payload);
        let cache =
            extract_cache_details_from_response(&BTreeMap::new(), Some(&payload), Some(&usage));
        let meta = build_gateway_log_meta(&usage, Some("provider_reported"), &cache, None, None)
            .expect("meta should be produced");

        assert_eq!(
            meta.pointer("/usage_normalized/cache_source")
                .and_then(|value| value.as_str()),
            Some("provider_reported")
        );
        assert_eq!(
            meta.pointer("/usage_normalized/cache_read_input_tokens")
                .and_then(|value| value.as_i64()),
            Some(24)
        );
        assert!(meta.get("provider_usage_raw").is_some());
    }
}
