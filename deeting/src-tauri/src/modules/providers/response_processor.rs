use serde_json::Value;
use std::collections::BTreeMap;

/// 统一的响应处理结果
#[derive(Debug, Clone)]
pub struct ProcessedResponse {
    pub status: u16,
    pub headers: BTreeMap<String, String>,
    pub json: Value,
    pub usage: Option<UsageDetails>,
    pub error: Option<ErrorDetails>,
    pub metrics: ResponseMetrics,
    pub cache_details: Option<CacheDetails>,
}

#[derive(Debug, Clone, Default)]
pub struct UsageDetails {
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub cache_creation_input_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ErrorDetails {
    pub code: String,
    pub message: String,
    pub raw: Value,
}

#[derive(Debug, Clone, Default)]
pub struct ResponseMetrics {
    pub ttft_ms: Option<i64>,
    pub upstream_latency_ms: Option<i64>,
    pub upstream_calls: i64,
}

#[derive(Debug, Clone)]
pub struct CacheDetails {
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
}

/// 统一的响应处理器
pub struct ResponseProcessor;

impl ResponseProcessor {
    /// 处理上游响应，一次性提取所有关键信息
    pub fn process(
        status: reqwest::StatusCode,
        headers: BTreeMap<String, String>,
        json: Value,
        upstream_latency_ms: Option<i64>,
        upstream_calls: i64,
    ) -> ProcessedResponse {
        let usage = Self::extract_usage(&json);
        let error = Self::extract_error(&json);
        let ttft_ms = Self::extract_ttft(&json);
        let cache_details = Self::extract_cache_details(&json);

        ProcessedResponse {
            status: status.as_u16(),
            headers,
            json,
            usage,
            error,
            metrics: ResponseMetrics {
                ttft_ms,
                upstream_latency_ms,
                upstream_calls,
            },
            cache_details,
        }
    }

    /// 提取使用统计
    fn extract_usage(json: &Value) -> Option<UsageDetails> {
        let usage_obj = json.get("usage")?;

        let prompt_tokens = usage_obj
            .get("input_tokens")
            .or_else(|| usage_obj.get("prompt_tokens"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let completion_tokens = usage_obj
            .get("output_tokens")
            .or_else(|| usage_obj.get("completion_tokens"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let total_tokens = usage_obj
            .get("total_tokens")
            .and_then(|v| v.as_i64())
            .unwrap_or(prompt_tokens + completion_tokens);

        let cache_creation_input_tokens = usage_obj
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_i64());

        let cache_read_input_tokens = usage_obj
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_i64());

        Some(UsageDetails {
            prompt_tokens,
            completion_tokens,
            total_tokens,
            cache_creation_input_tokens,
            cache_read_input_tokens,
        })
    }

    /// 提取错误信息
    fn extract_error(json: &Value) -> Option<ErrorDetails> {
        let error_obj = json.get("error")?;

        let code = error_obj
            .get("code")
            .or_else(|| error_obj.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        let message = error_obj
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        Some(ErrorDetails {
            code,
            message,
            raw: error_obj.clone(),
        })
    }

    /// 提取 TTFT (Time To First Token)
    fn extract_ttft(json: &Value) -> Option<i64> {
        json.get("runtime_metrics")
            .and_then(|metrics| metrics.get("ttft_ms"))
            .and_then(|v| v.as_i64())
    }

    /// 提取缓存详情
    fn extract_cache_details(json: &Value) -> Option<CacheDetails> {
        let usage = json.get("usage")?;

        let cache_creation = usage
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_i64())?;

        let cache_read = usage
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_i64())?;

        Some(CacheDetails {
            cache_creation_input_tokens: cache_creation,
            cache_read_input_tokens: cache_read,
        })
    }

    /// 注入运行时指标到响应 JSON
    pub fn inject_metrics(json: &mut Value, metrics: &ResponseMetrics) {
        let Some(object) = json.as_object_mut() else {
            return;
        };

        let mut metrics_obj = object
            .get("runtime_metrics")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();

        if let Some(latency) = metrics.upstream_latency_ms {
            if latency > 0 {
                metrics_obj.insert(
                    "upstream_latency_ms".to_string(),
                    serde_json::json!(latency),
                );
            }
        }

        if let Some(ttft) = metrics.ttft_ms {
            if ttft > 0 {
                metrics_obj.insert("ttft_ms".to_string(), serde_json::json!(ttft));
            }
        }

        if metrics.upstream_calls > 0 {
            metrics_obj.insert(
                "upstream_calls".to_string(),
                serde_json::json!(metrics.upstream_calls),
            );
        }

        if !metrics_obj.is_empty() {
            object.insert(
                "runtime_metrics".to_string(),
                serde_json::Value::Object(metrics_obj),
            );
        }
    }

    /// 计算 token 成本（如果有价格配置）
    pub fn calculate_token_cost(
        usage: &UsageDetails,
        input_price_per_million: Option<f64>,
        output_price_per_million: Option<f64>,
        cache_write_price_per_million: Option<f64>,
        cache_read_price_per_million: Option<f64>,
    ) -> Option<f64> {
        let mut cost = 0.0;

        if let Some(price) = input_price_per_million {
            cost += (usage.prompt_tokens as f64 / 1_000_000.0) * price;
        }

        if let Some(price) = output_price_per_million {
            cost += (usage.completion_tokens as f64 / 1_000_000.0) * price;
        }

        if let (Some(tokens), Some(price)) = (usage.cache_creation_input_tokens, cache_write_price_per_million) {
            cost += (tokens as f64 / 1_000_000.0) * price;
        }

        if let (Some(tokens), Some(price)) = (usage.cache_read_input_tokens, cache_read_price_per_million) {
            cost += (tokens as f64 / 1_000_000.0) * price;
        }

        if cost > 0.0 {
            Some(cost)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_usage_openai_format() {
        let json = json!({
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150
            }
        });

        let usage = ResponseProcessor::extract_usage(&json).unwrap();
        assert_eq!(usage.prompt_tokens, 100);
        assert_eq!(usage.completion_tokens, 50);
        assert_eq!(usage.total_tokens, 150);
    }

    #[test]
    fn test_extract_usage_anthropic_format() {
        let json = json!({
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_creation_input_tokens": 20,
                "cache_read_input_tokens": 30
            }
        });

        let usage = ResponseProcessor::extract_usage(&json).unwrap();
        assert_eq!(usage.prompt_tokens, 100);
        assert_eq!(usage.completion_tokens, 50);
        assert_eq!(usage.cache_creation_input_tokens, Some(20));
        assert_eq!(usage.cache_read_input_tokens, Some(30));
    }

    #[test]
    fn test_extract_error() {
        let json = json!({
            "error": {
                "type": "invalid_request_error",
                "message": "Invalid model specified"
            }
        });

        let error = ResponseProcessor::extract_error(&json).unwrap();
        assert_eq!(error.code, "invalid_request_error");
        assert_eq!(error.message, "Invalid model specified");
    }

    #[test]
    fn test_inject_metrics() {
        let mut json = json!({});
        let metrics = ResponseMetrics {
            ttft_ms: Some(150),
            upstream_latency_ms: Some(500),
            upstream_calls: 2,
        };

        ResponseProcessor::inject_metrics(&mut json, &metrics);

        let runtime_metrics = json.get("runtime_metrics").unwrap();
        assert_eq!(runtime_metrics.get("ttft_ms").unwrap().as_i64(), Some(150));
        assert_eq!(runtime_metrics.get("upstream_latency_ms").unwrap().as_i64(), Some(500));
        assert_eq!(runtime_metrics.get("upstream_calls").unwrap().as_i64(), Some(2));
    }

    #[test]
    fn test_calculate_token_cost() {
        let usage = UsageDetails {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500,
            cache_creation_input_tokens: Some(100),
            cache_read_input_tokens: Some(200),
        };

        let cost = ResponseProcessor::calculate_token_cost(
            &usage,
            Some(3.0),  // $3 per million input tokens
            Some(15.0), // $15 per million output tokens
            Some(3.75), // $3.75 per million cache write tokens
            Some(0.3),  // $0.3 per million cache read tokens
        );

        // (1000/1M * 3) + (500/1M * 15) + (100/1M * 3.75) + (200/1M * 0.3)
        // = 0.003 + 0.0075 + 0.000375 + 0.00006
        // = 0.010935
        assert!(cost.is_some());
        let cost = cost.unwrap();
        assert!((cost - 0.010935).abs() < 0.000001);
    }
}
