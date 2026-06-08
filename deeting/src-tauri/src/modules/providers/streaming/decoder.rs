use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::sse::SseFrame;

#[derive(Debug, Clone, PartialEq)]
pub struct ProviderUsageDelta {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
    pub raw: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ProviderStreamEvent {
    TextDelta(String),
    ReasoningDelta(String),
    ToolCallDelta {
        call_id: Option<String>,
        index: Option<usize>,
        name: Option<String>,
        arguments_delta: String,
    },
    ToolCallDone {
        call_id: String,
        name: String,
        arguments: Value,
    },
    Usage(ProviderUsageDelta),
    Done {
        raw_terminal_response: Value,
    },
    Error {
        message: String,
        code: Option<String>,
        raw: Option<Value>,
    },
}

#[derive(Debug, Clone)]
pub struct ProviderStreamResponseState {
    pub decoder_name: String,
    pub status_code: u16,
    pub headers: BTreeMap<String, String>,
    pub raw_terminal_response: Value,
    pub raw_events: Vec<Value>,
    pub text: String,
    pub retry_count: i64,
}

#[derive(Debug, Clone, Default)]
struct ToolCallAccumulator {
    call_id: Option<String>,
    name: Option<String>,
    arguments: String,
}

#[derive(Debug, Clone, PartialEq)]
struct TerminalToolCall {
    call_id: String,
    name: String,
    arguments: Value,
}

#[derive(Debug, Clone)]
pub struct ProviderStreamDecodeState {
    pub decoder_name: String,
    raw_events: Vec<Value>,
    text: String,
    reasoning: String,
    usage: Option<ProviderUsageDelta>,
    terminal_tool_calls: Vec<TerminalToolCall>,
    terminal_response: Option<Value>,
    tool_calls: BTreeMap<String, ToolCallAccumulator>,
}

impl ProviderStreamDecodeState {
    pub fn new(decoder_name: impl Into<String>) -> Self {
        Self {
            decoder_name: decoder_name.into(),
            raw_events: Vec::new(),
            text: String::new(),
            reasoning: String::new(),
            usage: None,
            terminal_tool_calls: Vec::new(),
            terminal_response: None,
            tool_calls: BTreeMap::new(),
        }
    }

    pub fn record_event(&mut self, event: &ProviderStreamEvent) {
        match event {
            ProviderStreamEvent::TextDelta(delta) => self.text.push_str(delta),
            ProviderStreamEvent::ReasoningDelta(delta) => self.reasoning.push_str(delta),
            ProviderStreamEvent::Usage(usage) => {
                self.usage = Some(merge_usage_delta(self.usage.as_ref(), usage));
            }
            ProviderStreamEvent::ToolCallDone {
                call_id,
                name,
                arguments,
            } => {
                self.terminal_tool_calls.push(TerminalToolCall {
                    call_id: call_id.clone(),
                    name: name.clone(),
                    arguments: arguments.clone(),
                });
            }
            ProviderStreamEvent::Done {
                raw_terminal_response,
            } => {
                self.terminal_response = Some(raw_terminal_response.clone());
            }
            _ => {}
        }
    }

    pub fn record_raw_event(&mut self, raw: Value) {
        self.raw_events.push(raw);
    }

    pub fn append_tool_call_delta(
        &mut self,
        key: impl Into<String>,
        call_id: Option<String>,
        name: Option<String>,
        arguments_delta: impl AsRef<str>,
    ) {
        let entry = self.tool_calls.entry(key.into()).or_default();
        if call_id.as_deref().is_some_and(|value| !value.is_empty()) {
            entry.call_id = call_id;
        }
        if name.as_deref().is_some_and(|value| !value.is_empty()) {
            entry.name = name;
        }
        entry.arguments.push_str(arguments_delta.as_ref());
    }

    pub fn has_tool_call(&self, key: impl AsRef<str>) -> bool {
        self.tool_calls.contains_key(key.as_ref())
    }

    pub fn finish_tool_call(
        &mut self,
        key: impl AsRef<str>,
        fallback_call_id: Option<String>,
        fallback_name: Option<String>,
    ) -> Option<ProviderStreamEvent> {
        let key = key.as_ref();
        let mut entry = self.tool_calls.remove(key)?;
        if entry.call_id.is_none() {
            entry.call_id = fallback_call_id;
        }
        if entry.name.is_none() {
            entry.name = fallback_name;
        }
        let call_id = entry.call_id?;
        let name = entry.name?;
        let arguments = parse_json_or_string(entry.arguments.as_str());
        Some(ProviderStreamEvent::ToolCallDone {
            call_id,
            name,
            arguments,
        })
    }

    pub fn finish(self, retry_count: i64) -> ProviderStreamResponseState {
        let raw_terminal_response = self
            .terminal_response
            .clone()
            .filter(|raw| self.terminal_response_has_payload(raw))
            .unwrap_or_else(|| self.build_terminal_response());
        ProviderStreamResponseState {
            decoder_name: self.decoder_name,
            status_code: 200,
            headers: BTreeMap::new(),
            raw_terminal_response,
            raw_events: self.raw_events,
            text: self.text,
            retry_count,
        }
    }

    fn terminal_response_has_payload(&self, raw: &Value) -> bool {
        match self.decoder_name.as_str() {
            "openai_responses_events" => raw
                .get("output")
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty()),
            "anthropic_messages_events" => raw
                .get("content")
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty()),
            "openai_chat_events" => raw
                .get("choices")
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty()),
            _ => false,
        }
    }

    fn build_terminal_response(&self) -> Value {
        match self.decoder_name.as_str() {
            "openai_responses_events" => self.build_openai_responses_terminal_response(),
            "anthropic_messages_events" => self.build_anthropic_terminal_response(),
            "openai_chat_events" => self.build_openai_chat_terminal_response(),
            _ => json!({
                "stream_decoder": self.decoder_name,
                "output_text": self.text,
                "reasoning_text": self.reasoning,
                "events": self.raw_events,
            }),
        }
    }

    fn build_openai_chat_terminal_response(&self) -> Value {
        let mut message = json!({
            "role": "assistant",
            "content": if self.text.is_empty() && !self.terminal_tool_calls.is_empty() {
                Value::Null
            } else {
                Value::String(self.text.clone())
            },
        });
        if !self.reasoning.trim().is_empty() {
            message["reasoning_content"] = Value::String(self.reasoning.clone());
        }
        if !self.terminal_tool_calls.is_empty() {
            message["tool_calls"] = Value::Array(
                self.terminal_tool_calls
                    .iter()
                    .map(openai_chat_tool_call_json)
                    .collect(),
            );
        }
        let finish_reason = if self.terminal_tool_calls.is_empty() {
            "stop"
        } else {
            "tool_calls"
        };
        let mut response = json!({
            "object": "chat.completion",
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }],
        });
        if let Some(usage) = self.usage.as_ref() {
            response["usage"] = openai_chat_usage_json(usage);
        }
        response
    }

    fn build_openai_responses_terminal_response(&self) -> Value {
        let mut output = Vec::new();
        if !self.text.is_empty() {
            output.push(json!({
                "type": "message",
                "content": [{
                    "type": "output_text",
                    "text": self.text,
                }],
            }));
        }
        for tool_call in &self.terminal_tool_calls {
            output.push(json!({
                "type": "function_call",
                "id": tool_call.call_id,
                "call_id": tool_call.call_id,
                "name": tool_call.name,
                "arguments": terminal_arguments_string(&tool_call.arguments),
                "status": "completed",
            }));
        }

        let mut response = json!({
            "status": "completed",
            "output": output,
        });
        if let Some(usage) = self.usage.as_ref() {
            response["usage"] = responses_usage_json(usage);
        }
        response
    }

    fn build_anthropic_terminal_response(&self) -> Value {
        let mut content = Vec::new();
        if !self.reasoning.trim().is_empty() {
            content.push(json!({
                "type": "thinking",
                "thinking": self.reasoning,
            }));
        }
        if !self.text.is_empty() {
            content.push(json!({
                "type": "text",
                "text": self.text,
            }));
        }
        for tool_call in &self.terminal_tool_calls {
            content.push(json!({
                "type": "tool_use",
                "id": tool_call.call_id,
                "name": tool_call.name,
                "input": tool_call.arguments,
            }));
        }

        let mut response = json!({
            "content": content,
            "stop_reason": if self.terminal_tool_calls.is_empty() {
                "end_turn"
            } else {
                "tool_use"
            },
        });
        if let Some(usage) = self.usage.as_ref() {
            response["usage"] = anthropic_usage_json(usage);
        }
        response
    }
}

fn merge_usage_delta(
    current: Option<&ProviderUsageDelta>,
    next: &ProviderUsageDelta,
) -> ProviderUsageDelta {
    ProviderUsageDelta {
        input_tokens: next
            .input_tokens
            .or_else(|| current.and_then(|usage| usage.input_tokens)),
        output_tokens: next
            .output_tokens
            .or_else(|| current.and_then(|usage| usage.output_tokens)),
        total_tokens: next
            .total_tokens
            .or_else(|| current.and_then(|usage| usage.total_tokens)),
        raw: next.raw.clone(),
    }
}

fn openai_chat_tool_call_json(tool_call: &TerminalToolCall) -> Value {
    json!({
        "id": tool_call.call_id,
        "type": "function",
        "function": {
            "name": tool_call.name,
            "arguments": terminal_arguments_string(&tool_call.arguments),
        },
    })
}

fn terminal_arguments_string(arguments: &Value) -> String {
    match arguments {
        Value::String(text) => text.clone(),
        _ => serde_json::to_string(arguments).unwrap_or_else(|_| "{}".to_string()),
    }
}

fn openai_chat_usage_json(usage: &ProviderUsageDelta) -> Value {
    json!({
        "prompt_tokens": usage.input_tokens.unwrap_or(0),
        "completion_tokens": usage.output_tokens.unwrap_or(0),
        "total_tokens": usage.total_tokens.unwrap_or_else(|| {
            usage.input_tokens.unwrap_or(0) + usage.output_tokens.unwrap_or(0)
        }),
    })
}

fn responses_usage_json(usage: &ProviderUsageDelta) -> Value {
    json!({
        "input_tokens": usage.input_tokens.unwrap_or(0),
        "output_tokens": usage.output_tokens.unwrap_or(0),
        "total_tokens": usage.total_tokens.unwrap_or_else(|| {
            usage.input_tokens.unwrap_or(0) + usage.output_tokens.unwrap_or(0)
        }),
    })
}

fn anthropic_usage_json(usage: &ProviderUsageDelta) -> Value {
    json!({
        "input_tokens": usage.input_tokens.unwrap_or(0),
        "output_tokens": usage.output_tokens.unwrap_or(0),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderStreamDecodeError {
    pub decoder_name: String,
    pub message: String,
    pub raw_data: Option<String>,
}

pub fn decode_provider_stream_data(
    decoder_name: &str,
    data: &str,
    state: &mut ProviderStreamDecodeState,
) -> Result<Vec<ProviderStreamEvent>, ProviderStreamDecodeError> {
    decode_provider_stream_payload(decoder_name, None, data, state)
}

pub fn decode_provider_stream_frame(
    decoder_name: &str,
    frame: &SseFrame,
    state: &mut ProviderStreamDecodeState,
) -> Result<Vec<ProviderStreamEvent>, ProviderStreamDecodeError> {
    if frame.is_done {
        return Ok(Vec::new());
    }
    decode_provider_stream_payload(
        decoder_name,
        frame.event.as_deref(),
        frame.data.as_str(),
        state,
    )
}

fn decode_provider_stream_payload(
    decoder_name: &str,
    event_name: Option<&str>,
    data: &str,
    state: &mut ProviderStreamDecodeState,
) -> Result<Vec<ProviderStreamEvent>, ProviderStreamDecodeError> {
    let mut value =
        serde_json::from_str::<Value>(data).map_err(|err| ProviderStreamDecodeError {
            decoder_name: decoder_name.to_string(),
            message: format!("invalid provider stream JSON: {err}"),
            raw_data: Some(data.to_string()),
        })?;
    if let (Some(event_name), Some(object)) = (event_name, value.as_object_mut()) {
        object
            .entry("type")
            .or_insert_with(|| Value::String(event_name.to_string()));
    }

    state.record_raw_event(value.clone());
    match decoder_name {
        "openai_chat_events" => super::openai_chat::decode_event(&value, state),
        "openai_responses_events" => super::openai_responses::decode_event(&value, state),
        "anthropic_messages_events" => super::anthropic_messages::decode_event(&value, state),
        _ => Ok(Vec::new()),
    }
}

pub(crate) fn usage_from_value(value: &Value) -> Option<ProviderUsageDelta> {
    if !value.is_object() {
        return None;
    }
    Some(ProviderUsageDelta {
        input_tokens: get_i64(value, &["prompt_tokens", "input_tokens"]),
        output_tokens: get_i64(value, &["completion_tokens", "output_tokens"]),
        total_tokens: get_i64(value, &["total_tokens"]),
        raw: value.clone(),
    })
}

pub(crate) fn get_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(|value| value.as_i64()))
}

pub(crate) fn parse_json_or_string(raw: &str) -> Value {
    serde_json::from_str::<Value>(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
}

pub(crate) fn index_key(prefix: &str, index: usize) -> String {
    format!("{prefix}:{index}")
}

#[cfg(test)]
mod tests {
    use super::{decode_provider_stream_data, ProviderStreamDecodeState, ProviderStreamEvent};
    use serde_json::json;

    #[test]
    fn decoder_reports_json_parse_failures() {
        let mut state = ProviderStreamDecodeState::new("openai_chat_events");

        let error = decode_provider_stream_data("openai_chat_events", "{bad json", &mut state)
            .expect_err("invalid json should fail");

        assert_eq!(error.decoder_name, "openai_chat_events");
        assert!(error.message.contains("invalid provider stream JSON"));
        assert_eq!(error.raw_data.as_deref(), Some("{bad json"));
    }

    #[test]
    fn unknown_decoder_records_raw_without_events() {
        let mut state = ProviderStreamDecodeState::new("unknown_events");

        let events = decode_provider_stream_data("unknown_events", r#"{"type":"x"}"#, &mut state)
            .expect("decode unknown event");

        assert!(events.is_empty());
        assert_eq!(state.finish(0).raw_events, vec![json!({ "type": "x" })]);
    }

    #[test]
    fn state_accumulates_text_and_terminal_raw() {
        let mut state = ProviderStreamDecodeState::new("openai_responses_events");
        let events = vec![
            ProviderStreamEvent::TextDelta("he".to_string()),
            ProviderStreamEvent::TextDelta("llo".to_string()),
            ProviderStreamEvent::Done {
                raw_terminal_response: json!({ "id": "resp_1" }),
            },
        ];

        for event in &events {
            state.record_event(event);
        }
        let finished = state.finish(0);

        assert_eq!(finished.text, "hello");
        assert_eq!(
            finished.raw_terminal_response,
            json!({
                "status": "completed",
                "output": [{
                    "type": "message",
                    "content": [{ "type": "output_text", "text": "hello" }]
                }]
            })
        );
    }

    #[test]
    fn state_preserves_complete_terminal_raw() {
        let mut state = ProviderStreamDecodeState::new("openai_responses_events");
        let raw = json!({
            "id": "resp_1",
            "output": [{
                "type": "message",
                "content": [{ "type": "output_text", "text": "hello" }]
            }]
        });

        state.record_event(&ProviderStreamEvent::Done {
            raw_terminal_response: raw.clone(),
        });
        let finished = state.finish(0);

        assert_eq!(finished.raw_terminal_response, raw);
    }
}
