use serde_json::Value;

use super::decoder::{
    index_key, parse_json_or_string, usage_from_value, ProviderStreamDecodeError,
    ProviderStreamDecodeState, ProviderStreamEvent,
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
        .get("response")
        .and_then(|response| response.get("usage"))
        .and_then(usage_from_value)
    {
        events.push(ProviderStreamEvent::Usage(usage));
    }

    let Some(event_type) = value.get("type").and_then(|value| value.as_str()) else {
        return Ok(events);
    };

    match event_type {
        "response.output_text.delta" | "response.text.delta" => {
            if let Some(delta) = value.get("delta").and_then(|value| value.as_str()) {
                events.push(ProviderStreamEvent::TextDelta(delta.to_string()));
            }
        }
        "response.reasoning_text.delta"
        | "response.reasoning.delta"
        | "response.reasoning_summary_text.delta"
        | "response.output_item.reasoning.delta" => {
            if let Some(delta) = value
                .get("delta")
                .or_else(|| value.get("text"))
                .and_then(|value| value.as_str())
            {
                events.push(ProviderStreamEvent::ReasoningDelta(delta.to_string()));
            }
        }
        "response.output_item.added" => {
            append_added_function_call(value, state, &mut events);
        }
        "response.function_call_arguments.delta" => {
            append_function_arguments_delta(value, state, &mut events);
        }
        "response.function_call_arguments.done" => {
            finish_function_arguments(value, state, &mut events);
        }
        "response.output_item.done" => {
            finish_output_item(value, state, &mut events);
        }
        "response.completed" | "response.done" => {
            events.push(ProviderStreamEvent::Done {
                raw_terminal_response: value
                    .get("response")
                    .cloned()
                    .unwrap_or_else(|| value.clone()),
            });
        }
        "response.failed" => {
            let error = value.get("error").unwrap_or(value);
            events.push(ProviderStreamEvent::Error {
                message: error
                    .get("message")
                    .and_then(|value| value.as_str())
                    .unwrap_or("provider stream failed")
                    .to_string(),
                code: error
                    .get("code")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string()),
                raw: Some(value.clone()),
            });
        }
        _ => {}
    }

    Ok(events)
}

fn append_added_function_call(
    value: &Value,
    state: &mut ProviderStreamDecodeState,
    events: &mut Vec<ProviderStreamEvent>,
) {
    let Some(item) = value.get("item") else {
        return;
    };
    if item.get("type").and_then(|value| value.as_str()) != Some("function_call") {
        return;
    }

    let index = output_index(value);
    let key = item_key(value, item);
    let call_id = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let name = item
        .get("name")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    state.append_tool_call_delta(key, call_id.clone(), name.clone(), "");
    events.push(ProviderStreamEvent::ToolCallDelta {
        call_id,
        index,
        name,
        arguments_delta: String::new(),
    });
}

fn append_function_arguments_delta(
    value: &Value,
    state: &mut ProviderStreamDecodeState,
    events: &mut Vec<ProviderStreamEvent>,
) {
    let delta = value
        .get("delta")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let key = function_arguments_key(value);
    let call_id = value
        .get("call_id")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    state.append_tool_call_delta(key, call_id.clone(), None, delta.as_str());
    if !delta.is_empty() || call_id.is_some() {
        events.push(ProviderStreamEvent::ToolCallDelta {
            call_id,
            index: output_index(value),
            name: None,
            arguments_delta: delta,
        });
    }
}

fn finish_function_arguments(
    value: &Value,
    state: &mut ProviderStreamDecodeState,
    events: &mut Vec<ProviderStreamEvent>,
) {
    let key = function_arguments_key(value);
    if !state.has_tool_call(&key) {
        let arguments = value.get("arguments").and_then(|value| value.as_str());
        if let Some(arguments) = arguments {
            state.append_tool_call_delta(key.clone(), None, None, arguments);
        }
    }
    if let Some(done) = state.finish_tool_call(
        key,
        value
            .get("call_id")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        value
            .get("name")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
    ) {
        events.push(done);
    }
}

fn append_whole_function_arguments(
    key: String,
    value: &Value,
    state: &mut ProviderStreamDecodeState,
) {
    if let Some(arguments) = value.get("arguments").and_then(|value| value.as_str()) {
        state.append_tool_call_delta(key.clone(), None, None, arguments);
    }
}

fn finish_output_item(
    value: &Value,
    state: &mut ProviderStreamDecodeState,
    events: &mut Vec<ProviderStreamEvent>,
) {
    let Some(item) = value.get("item") else {
        return;
    };
    if item.get("type").and_then(|value| value.as_str()) != Some("function_call") {
        return;
    }

    let key = item_key(value, item);
    if !state.has_tool_call(&key) {
        append_whole_function_arguments(key.clone(), item, state);
    }

    let done = state.finish_tool_call(
        key.clone(),
        item.get("call_id")
            .or_else(|| item.get("id"))
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        item.get("name")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
    );
    if let Some(done) = done {
        events.push(done);
    } else if let (Some(call_id), Some(name), Some(arguments)) = (
        item.get("call_id")
            .or_else(|| item.get("id"))
            .and_then(|value| value.as_str()),
        item.get("name").and_then(|value| value.as_str()),
        item.get("arguments").and_then(|value| value.as_str()),
    ) {
        events.push(ProviderStreamEvent::ToolCallDone {
            call_id: call_id.to_string(),
            name: name.to_string(),
            arguments: parse_json_or_string(arguments),
        });
    }
}

fn item_key(value: &Value, item: &Value) -> String {
    item.get("id")
        .or_else(|| item.get("call_id"))
        .or_else(|| value.get("item_id"))
        .and_then(|value| value.as_str())
        .map(|value| format!("openai_responses:{value}"))
        .unwrap_or_else(|| index_key("openai_responses", output_index(value).unwrap_or(0)))
}

fn function_arguments_key(value: &Value) -> String {
    value
        .get("item_id")
        .or_else(|| value.get("call_id"))
        .and_then(|value| value.as_str())
        .map(|value| format!("openai_responses:{value}"))
        .unwrap_or_else(|| index_key("openai_responses", output_index(value).unwrap_or(0)))
}

fn output_index(value: &Value) -> Option<usize> {
    value
        .get("output_index")
        .or_else(|| value.get("item_index"))
        .and_then(|value| value.as_u64())
        .map(|value| value as usize)
}

#[cfg(test)]
mod tests {
    use super::decode_event;
    use crate::modules::providers::streaming::decoder::{
        ProviderStreamDecodeState, ProviderStreamEvent,
    };
    use serde_json::json;

    #[test]
    fn responses_maps_text_reasoning_usage_and_done() {
        let mut state = ProviderStreamDecodeState::new("openai_responses_events");

        let text = decode_event(
            &json!({ "type": "response.output_text.delta", "delta": "hello" }),
            &mut state,
        )
        .expect("decode text");
        let reasoning = decode_event(
            &json!({ "type": "response.reasoning_text.delta", "delta": "think" }),
            &mut state,
        )
        .expect("decode reasoning");
        let done = decode_event(
            &json!({
                "type": "response.completed",
                "response": {
                    "id": "resp_1",
                    "usage": { "input_tokens": 1, "output_tokens": 2, "total_tokens": 3 }
                }
            }),
            &mut state,
        )
        .expect("decode done");

        assert_eq!(
            text,
            vec![ProviderStreamEvent::TextDelta("hello".to_string())]
        );
        assert_eq!(
            reasoning,
            vec![ProviderStreamEvent::ReasoningDelta("think".to_string())]
        );
        assert!(done.iter().any(|event| matches!(
            event,
            ProviderStreamEvent::Usage(usage)
                if usage.input_tokens == Some(1)
                    && usage.output_tokens == Some(2)
                    && usage.total_tokens == Some(3)
        )));
        assert!(done.iter().any(|event| matches!(
            event,
            ProviderStreamEvent::Done { raw_terminal_response }
                if raw_terminal_response["id"] == json!("resp_1")
        )));
    }

    #[test]
    fn responses_accumulates_split_function_arguments() {
        let mut state = ProviderStreamDecodeState::new("openai_responses_events");

        let _ = decode_event(
            &json!({
                "type": "response.output_item.added",
                "output_index": 0,
                "item": {
                    "id": "item_1",
                    "call_id": "call_1",
                    "type": "function_call",
                    "name": "search_sdk"
                }
            }),
            &mut state,
        )
        .expect("decode function item");
        let first = decode_event(
            &json!({
                "type": "response.function_call_arguments.delta",
                "item_id": "item_1",
                "delta": "{\"query\":"
            }),
            &mut state,
        )
        .expect("decode argument delta");
        let _ = decode_event(
            &json!({
                "type": "response.function_call_arguments.delta",
                "item_id": "item_1",
                "delta": "\"rust\"}"
            }),
            &mut state,
        )
        .expect("decode second argument delta");
        let done = decode_event(
            &json!({
                "type": "response.function_call_arguments.done",
                "item_id": "item_1"
            }),
            &mut state,
        )
        .expect("decode argument done");

        assert!(first.iter().any(|event| matches!(
            event,
            ProviderStreamEvent::ToolCallDelta { arguments_delta, .. }
                if arguments_delta == "{\"query\":"
        )));
        assert!(done.contains(&ProviderStreamEvent::ToolCallDone {
            call_id: "call_1".to_string(),
            name: "search_sdk".to_string(),
            arguments: json!({ "query": "rust" }),
        }));
    }
}
