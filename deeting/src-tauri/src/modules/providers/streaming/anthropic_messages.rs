use serde_json::Value;

use super::decoder::{
    index_key, usage_from_value, ProviderStreamDecodeError, ProviderStreamDecodeState,
    ProviderStreamEvent,
};

pub fn decode_event(
    value: &Value,
    state: &mut ProviderStreamDecodeState,
) -> Result<Vec<ProviderStreamEvent>, ProviderStreamDecodeError> {
    let mut events = Vec::new();
    if let Some(usage) = value.get("usage").and_then(usage_from_value) {
        events.push(ProviderStreamEvent::Usage(usage));
    }
    if let Some(usage) = value
        .get("message")
        .and_then(|message| message.get("usage"))
        .and_then(usage_from_value)
    {
        events.push(ProviderStreamEvent::Usage(usage));
    }

    let Some(event_type) = value.get("type").and_then(|value| value.as_str()) else {
        return Ok(events);
    };

    match event_type {
        "content_block_start" => append_content_block_start(value, state, &mut events),
        "content_block_delta" => append_content_block_delta(value, state, &mut events),
        "content_block_stop" => finish_content_block(value, state, &mut events),
        "message_delta" => {
            if let Some(usage) = value.get("usage").and_then(usage_from_value) {
                events.push(ProviderStreamEvent::Usage(usage));
            }
        }
        "message_stop" => events.push(ProviderStreamEvent::Done {
            raw_terminal_response: value.clone(),
        }),
        "error" => {
            let error = value.get("error").unwrap_or(value);
            events.push(ProviderStreamEvent::Error {
                message: error
                    .get("message")
                    .and_then(|value| value.as_str())
                    .unwrap_or("provider stream failed")
                    .to_string(),
                code: error
                    .get("type")
                    .or_else(|| error.get("code"))
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string()),
                raw: Some(value.clone()),
            });
        }
        _ => {}
    }

    Ok(events)
}

fn append_content_block_start(
    value: &Value,
    state: &mut ProviderStreamDecodeState,
    events: &mut Vec<ProviderStreamEvent>,
) {
    let Some(block) = value.get("content_block") else {
        return;
    };
    if block.get("type").and_then(|value| value.as_str()) != Some("tool_use") {
        return;
    }

    let index = content_index(value);
    let key = index_key("anthropic", index);
    let call_id = block
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let name = block
        .get("name")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    state.append_tool_call_delta(key, call_id.clone(), name.clone(), "");
    events.push(ProviderStreamEvent::ToolCallDelta {
        call_id,
        index: Some(index),
        name,
        arguments_delta: String::new(),
    });
}

fn append_content_block_delta(
    value: &Value,
    state: &mut ProviderStreamDecodeState,
    events: &mut Vec<ProviderStreamEvent>,
) {
    let Some(delta) = value.get("delta") else {
        return;
    };
    match delta.get("type").and_then(|value| value.as_str()) {
        Some("text_delta") => {
            if let Some(text) = delta.get("text").and_then(|value| value.as_str()) {
                events.push(ProviderStreamEvent::TextDelta(text.to_string()));
            }
        }
        Some("thinking_delta") => {
            if let Some(thinking) = delta.get("thinking").and_then(|value| value.as_str()) {
                events.push(ProviderStreamEvent::ReasoningDelta(thinking.to_string()));
            }
        }
        Some("input_json_delta") => {
            let index = content_index(value);
            let partial_json = delta
                .get("partial_json")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            state.append_tool_call_delta(index_key("anthropic", index), None, None, &partial_json);
            if !partial_json.is_empty() {
                events.push(ProviderStreamEvent::ToolCallDelta {
                    call_id: None,
                    index: Some(index),
                    name: None,
                    arguments_delta: partial_json,
                });
            }
        }
        _ => {}
    }
}

fn finish_content_block(
    value: &Value,
    state: &mut ProviderStreamDecodeState,
    events: &mut Vec<ProviderStreamEvent>,
) {
    let index = content_index(value);
    if let Some(done) = state.finish_tool_call(index_key("anthropic", index), None, None) {
        events.push(done);
    }
}

fn content_index(value: &Value) -> usize {
    value
        .get("index")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as usize
}

#[cfg(test)]
mod tests {
    use super::decode_event;
    use crate::modules::providers::streaming::decoder::{
        ProviderStreamDecodeState, ProviderStreamEvent,
    };
    use serde_json::json;

    #[test]
    fn anthropic_maps_text_thinking_usage_and_done() {
        let mut state = ProviderStreamDecodeState::new("anthropic_messages_events");
        let text = decode_event(
            &json!({
                "type": "content_block_delta",
                "delta": { "type": "text_delta", "text": "hello" }
            }),
            &mut state,
        )
        .expect("decode text");
        let thinking = decode_event(
            &json!({
                "type": "content_block_delta",
                "delta": { "type": "thinking_delta", "thinking": "think" }
            }),
            &mut state,
        )
        .expect("decode thinking");
        let usage = decode_event(
            &json!({
                "type": "message_delta",
                "usage": { "input_tokens": 1, "output_tokens": 2 }
            }),
            &mut state,
        )
        .expect("decode usage");
        let done =
            decode_event(&json!({ "type": "message_stop" }), &mut state).expect("decode stop");

        assert_eq!(
            text,
            vec![ProviderStreamEvent::TextDelta("hello".to_string())]
        );
        assert_eq!(
            thinking,
            vec![ProviderStreamEvent::ReasoningDelta("think".to_string())]
        );
        assert!(usage.iter().any(|event| matches!(
            event,
            ProviderStreamEvent::Usage(usage)
                if usage.input_tokens == Some(1) && usage.output_tokens == Some(2)
        )));
        assert!(done
            .iter()
            .any(|event| matches!(event, ProviderStreamEvent::Done { .. })));
    }

    #[test]
    fn anthropic_accumulates_split_tool_input() {
        let mut state = ProviderStreamDecodeState::new("anthropic_messages_events");
        let _ = decode_event(
            &json!({
                "type": "content_block_start",
                "index": 1,
                "content_block": {
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "search_sdk"
                }
            }),
            &mut state,
        )
        .expect("decode tool start");
        let first = decode_event(
            &json!({
                "type": "content_block_delta",
                "index": 1,
                "delta": {
                    "type": "input_json_delta",
                    "partial_json": "{\"query\":"
                }
            }),
            &mut state,
        )
        .expect("decode input delta");
        let _ = decode_event(
            &json!({
                "type": "content_block_delta",
                "index": 1,
                "delta": {
                    "type": "input_json_delta",
                    "partial_json": "\"rust\"}"
                }
            }),
            &mut state,
        )
        .expect("decode second input delta");
        let done = decode_event(
            &json!({
                "type": "content_block_stop",
                "index": 1
            }),
            &mut state,
        )
        .expect("decode tool stop");

        assert!(first.iter().any(|event| matches!(
            event,
            ProviderStreamEvent::ToolCallDelta { arguments_delta, .. }
                if arguments_delta == "{\"query\":"
        )));
        assert!(done.contains(&ProviderStreamEvent::ToolCallDone {
            call_id: "toolu_1".to_string(),
            name: "search_sdk".to_string(),
            arguments: json!({ "query": "rust" }),
        }));
    }
}
