#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) struct RuntimeMetricsAccumulator
{
    upstream_latency_ms: i64,
    upstream_calls: i64,
    ttft_ms: Option<i64>,
}

impl RuntimeMetricsAccumulator {
    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn observe_response(
        &mut self,
        response: &serde_json::Value,
    ) {
        let metrics = response
            .get("runtime_metrics")
            .and_then(|value| value.as_object());
        let latency = metrics
            .and_then(|value| value.get("upstream_latency_ms"))
            .and_then(|value| value.as_i64())
            .filter(|value| *value > 0)
            .unwrap_or(0);
        let calls = metrics
            .and_then(|value| value.get("upstream_calls"))
            .and_then(|value| value.as_i64())
            .filter(|value| *value > 0)
            .unwrap_or(if latency > 0 { 1 } else { 0 });
        if latency > 0 {
            self.upstream_latency_ms = self.upstream_latency_ms.saturating_add(latency);
            self.upstream_calls = self.upstream_calls.saturating_add(calls.max(1));
        }
        if self.ttft_ms.is_none() {
            self.ttft_ms = metrics
                .and_then(|value| value.get("ttft_ms"))
                .and_then(|value| value.as_i64())
                .filter(|value| *value > 0);
        }
    }

    pub(in crate::modules::desktop_runtime::runtime::chat_tool_runtime) fn inject_into_response(
        &self,
        response: &mut serde_json::Value,
    ) {
        if self.upstream_latency_ms <= 0 && self.ttft_ms.is_none() {
            return;
        }
        let Some(object) = response.as_object_mut() else {
            return;
        };
        let mut metrics = object
            .get("runtime_metrics")
            .and_then(|value| value.as_object())
            .cloned()
            .unwrap_or_default();
        if self.upstream_latency_ms > 0 {
            metrics.insert(
                "upstream_latency_ms".to_string(),
                serde_json::json!(self.upstream_latency_ms),
            );
        }
        if self.upstream_calls > 0 {
            metrics.insert(
                "upstream_calls".to_string(),
                serde_json::json!(self.upstream_calls),
            );
        }
        if let Some(ttft_ms) = self.ttft_ms.filter(|value| *value > 0) {
            metrics.insert("ttft_ms".to_string(), serde_json::json!(ttft_ms));
        }
        if !metrics.is_empty() {
            object.insert(
                "runtime_metrics".to_string(),
                serde_json::Value::Object(metrics),
            );
        }
    }
}
