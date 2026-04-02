use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Deserialize, Debug, Clone)]
pub struct LocalChatCompletionRequest {
    pub model: String,
    pub messages: Vec<Value>,
    pub stream: Option<bool>,
    pub status_stream: Option<bool>,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub request_id: Option<String>,
    pub provider_model_id: Option<String>,
    pub explicit_task_agent_id: Option<String>,
    pub assistant_id: Option<String>,
    pub session_id: Option<String>,
    pub regenerate: Option<bool>,
    pub compare_only: Option<bool>,
    pub metadata: Option<Value>,
}

#[derive(Serialize)]
pub struct GatewayHealthResponse {
    pub status: &'static str,
}

#[derive(Serialize)]
pub struct LocalChatCancelResponse {
    pub request_id: String,
    pub status: String,
}

#[derive(Serialize)]
pub struct LocalCompareFinalizeErrorResponse {
    pub code: &'static str,
    pub message: String,
    pub source: &'static str,
}

pub fn normalize_optional_string(value: Option<&str>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn extract_selected_knowledge_file_ids(metadata: Option<&Value>) -> Vec<String> {
    let mut ids = Vec::new();
    let Some(metadata) = metadata else {
        return ids;
    };

    let from_knowledge = metadata
        .get("knowledge")
        .and_then(|value| value.get("doc_ids"))
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for value in from_knowledge {
        let normalized = value.trim();
        if normalized.is_empty() || ids.iter().any(|existing| existing == normalized) {
            continue;
        }
        ids.push(normalized.to_string());
    }

    let fallback = metadata
        .get("selected_doc_ids")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for value in fallback {
        let normalized = value.trim();
        if normalized.is_empty() || ids.iter().any(|existing| existing == normalized) {
            continue;
        }
        ids.push(normalized.to_string());
    }

    ids
}

pub fn extract_root_execution_id(metadata: Option<&Value>) -> Option<String> {
    let metadata = metadata?;
    normalize_optional_string(
        metadata
            .get("execution")
            .and_then(|value| value.get("root_execution_id"))
            .and_then(Value::as_str),
    )
}

pub fn build_stream_error_payload(
    error_code: &str,
    message: impl Into<String>,
    trace_id: &str,
    request_id: Option<&str>,
) -> Value {
    json!({
        "type": "error",
        "message": message.into(),
        "error_code": error_code,
        "source": "desktop",
        "trace_id": trace_id,
        "request_id": normalize_optional_string(request_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_stream_error_payload_uses_typed_error_event_shape() {
        let payload = build_stream_error_payload(
            "LOCAL_CHAT_FAILED",
            "upstream exploded with full body",
            "trace-123",
            Some("request-456"),
        );

        assert_eq!(
            payload.get("type").and_then(|value| value.as_str()),
            Some("error")
        );
        assert_eq!(
            payload.get("message").and_then(|value| value.as_str()),
            Some("upstream exploded with full body")
        );
        assert_eq!(
            payload.get("error_code").and_then(|value| value.as_str()),
            Some("LOCAL_CHAT_FAILED")
        );
    }

    #[test]
    fn extract_selected_knowledge_file_ids_dedups_sources() {
        let ids = extract_selected_knowledge_file_ids(Some(&json!({
            "knowledge": { "doc_ids": ["a", "b"] },
            "selected_doc_ids": ["b", "c"]
        })));
        assert_eq!(ids, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }

    #[test]
    fn extract_root_execution_id_reads_execution_metadata() {
        let root_execution_id = extract_root_execution_id(Some(&json!({
            "execution": {
                "root_execution_id": "exec-root-1"
            }
        })));
        assert_eq!(root_execution_id.as_deref(), Some("exec-root-1"));
    }
}
