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

    let Some(choices) = value.get("choices").and_then(|value| value.as_array()) else {
        return Ok(events);
    };

    for choice in choices {
        let choice_index = choice
            .get("index")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as usize;
        if let Some(delta) = choice.get("delta") {
            if let Some(content) = delta.get("content").and_then(|value| value.as_str()) {
                if !content.is_empty() {
                    events.push(ProviderStreamEvent::TextDelta(content.to_string()));
                }
            }
            if let Some(reasoning) = reasoning_delta(delta) {
                events.push(ProviderStreamEvent::ReasoningDelta(reasoning.to_string()));
            }
            if let Some(tool_calls) = delta.get("tool_calls").and_then(|value| value.as_array()) {
                for tool_call in tool_calls {
                    append_tool_call(choice_index, tool_call, state, &mut events);
                }
            }
        }

        let finish_reason = choice.get("finish_reason").and_then(|value| value.as_str());
        if matches!(finish_reason, Some("tool_calls") | Some("function_call")) {
            finish_choice_tool_calls(choice_index, state, &mut events);
        }
    }

    Ok(events)
}

fn reasoning_delta(delta: &Value) -> Option<&str> {
    delta
        .get("reasoning_content")
        .or_else(|| delta.get("reasoning"))
        .or_else(|| delta.get("reasoning_delta"))
        .and_then(|value| value.as_str())
}

fn append_tool_call(
    choice_index: usize,
    tool_call: &Value,
    state: &mut ProviderStreamDecodeState,
    events: &mut Vec<ProviderStreamEvent>,
) {
    let tool_index = tool_call
        .get("index")
        .and_then(|value| value.as_u64())
        .unwrap_or(0) as usize;
    let function = tool_call.get("function").unwrap_or(tool_call);
    let call_id = tool_call
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let name = function
        .get("name")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());
    let arguments_delta = function
        .get("arguments")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let key = index_key("openai_chat", choice_index * 1000 + tool_index);

    state.append_tool_call_delta(key, call_id.clone(), name.clone(), arguments_delta.as_str());
    if call_id.is_some() || name.is_some() || !arguments_delta.is_empty() {
        events.push(ProviderStreamEvent::ToolCallDelta {
            call_id,
            index: Some(tool_index),
            name,
            arguments_delta,
        });
    }
}

fn finish_choice_tool_calls(
    choice_index: usize,
    state: &mut ProviderStreamDecodeState,
    events: &mut Vec<ProviderStreamEvent>,
) {
    for tool_index in 0..32 {
        let key = index_key("openai_chat", choice_index * 1000 + tool_index);
        let Some(done) = state.finish_tool_call(key, None, None) else {
            continue;
        };
        events.push(done);
    }
}

#[cfg(test)]
mod tests {
    use super::decode_event;
    use crate::modules::providers::streaming::decoder::{
        ProviderStreamDecodeState, ProviderStreamEvent,
    };
    use serde_json::json;

    #[test]
    fn openai_chat_maps_text_reasoning_and_usage() {
        let mut state = ProviderStreamDecodeState::new("openai_chat_events");
        let events = decode_event(
            &json!({
                "choices": [{
                    "index": 0,
                    "delta": {
                        "content": "hello",
                        "reasoning_content": "thinking"
                    }
                }],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 2,
                    "total_tokens": 3
                }
            }),
            &mut state,
        )
        .expect("decode openai chat event");

        assert_eq!(
            events[0],
            ProviderStreamEvent::Usage(events[0].clone().into_usage())
        );
        assert!(events.contains(&ProviderStreamEvent::TextDelta("hello".to_string())));
        assert!(events.contains(&ProviderStreamEvent::ReasoningDelta("thinking".to_string())));
    }

    #[test]
    fn openai_chat_accumulates_split_tool_arguments() {
        let mut state = ProviderStreamDecodeState::new("openai_chat_events");
        let first = decode_event(
            &json!({
                "choices": [{
                    "index": 0,
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "id": "call_1",
                            "function": {
                                "name": "search_sdk",
                                "arguments": "{\"query\":"
                            }
                        }]
                    }
                }]
            }),
            &mut state,
        )
        .expect("decode first tool delta");
        let second = decode_event(
            &json!({
                "choices": [{
                    "index": 0,
                    "delta": {
                        "tool_calls": [{
                            "index": 0,
                            "function": {
                                "arguments": "\"rust\"}"
                            }
                        }]
                    },
                    "finish_reason": "tool_calls"
                }]
            }),
            &mut state,
        )
        .expect("decode second tool delta");

        assert!(first.iter().any(|event| matches!(
            event,
            ProviderStreamEvent::ToolCallDelta { arguments_delta, .. }
                if arguments_delta == "{\"query\":"
        )));
        assert!(second.contains(&ProviderStreamEvent::ToolCallDone {
            call_id: "call_1".to_string(),
            name: "search_sdk".to_string(),
            arguments: json!({ "query": "rust" }),
        }));
    }

    trait IntoUsage {
        fn into_usage(self) -> super::super::decoder::ProviderUsageDelta;
    }

    impl IntoUsage for ProviderStreamEvent {
        fn into_usage(self) -> super::super::decoder::ProviderUsageDelta {
            match self {
                ProviderStreamEvent::Usage(usage) => usage,
                _ => panic!("expected usage event"),
            }
        }
    }
}
