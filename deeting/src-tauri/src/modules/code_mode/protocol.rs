use serde_json::Value;

use crate::modules::code_mode::contract::{RUNTIME_RENDER_BLOCK_MARKER, RUNTIME_TOOL_CALL_MARKER};
use crate::modules::code_mode::types::RuntimeToolCall;

pub fn strip_runtime_signal_lines(lines: Vec<String>) -> Vec<String> {
    lines
        .into_iter()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.starts_with(RUNTIME_TOOL_CALL_MARKER)
                && !trimmed.starts_with(RUNTIME_RENDER_BLOCK_MARKER)
        })
        .collect()
}

pub fn extract_runtime_tool_calls(lines: &[String]) -> Vec<RuntimeToolCall> {
    let mut calls = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        if !trimmed.starts_with(RUNTIME_TOOL_CALL_MARKER) {
            continue;
        }
        let payload = trimmed[RUNTIME_TOOL_CALL_MARKER.len()..].trim();
        if payload.is_empty() {
            calls.push(RuntimeToolCall {
                index: None,
                tool_name: None,
                arguments: None,
            });
            continue;
        }
        let parsed: Result<Value, _> = serde_json::from_str(payload);
        if let Ok(Value::Object(map)) = parsed {
            calls.push(RuntimeToolCall {
                index: map.get("index").and_then(|v| v.as_i64()),
                tool_name: map
                    .get("tool_name")
                    .and_then(|v| v.as_str())
                    .map(|v| v.to_string()),
                arguments: map.get("arguments").cloned(),
            });
        }
    }
    calls
}

pub fn extract_runtime_render_blocks(lines: &[String]) -> Vec<Value> {
    let mut blocks = Vec::new();
    for line in lines {
        let trimmed = line.trim();
        if !trimmed.starts_with(RUNTIME_RENDER_BLOCK_MARKER) {
            continue;
        }
        let payload = trimmed[RUNTIME_RENDER_BLOCK_MARKER.len()..].trim();
        if payload.is_empty() {
            continue;
        }
        let parsed: Result<Value, _> = serde_json::from_str(payload);
        if let Ok(Value::Object(map)) = parsed {
            blocks.push(Value::Object(map));
        }
    }
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::code_mode::contract::{
        RUNTIME_RENDER_BLOCK_MARKER, RUNTIME_TOOL_CALL_MARKER,
    };

    #[test]
    fn parse_tool_call_lines() {
        let lines = vec![format!(
            "{}{{\"index\":0,\"tool_name\":\"tavily-search\",\"arguments\":{{\"query\":\"rust\"}}}}",
            RUNTIME_TOOL_CALL_MARKER
        )];
        let calls = extract_runtime_tool_calls(&lines);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].tool_name.as_deref(), Some("tavily-search"));
    }

    #[test]
    fn parse_render_block_lines() {
        let lines = vec![format!(
            "{}{{\"view_type\":\"table.simple\",\"payload\":{{\"rows\":[]}}}}",
            RUNTIME_RENDER_BLOCK_MARKER
        )];
        let blocks = extract_runtime_render_blocks(&lines);
        assert_eq!(blocks.len(), 1);
    }
}
