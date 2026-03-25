use handlebars::Handlebars;
use log::error;
use serde_json::{json, Value};

pub struct ResponseTransformer {
    hb: Handlebars<'static>,
}

impl ResponseTransformer {
    pub fn new() -> Self {
        let mut hb = Handlebars::new();
        hb.set_strict_mode(false);
        Self { hb }
    }

    pub fn transform(
        &self,
        template_engine: &str,
        response_decoder: Option<&str>,
        response_transform: &Value,
        raw_response: Value,
        status_code: u16,
    ) -> Value {
        if status_code >= 400 {
            // 如果是错误响应，尝试提取标准错误格式
            let error_msg = self.extract_error(&raw_response, status_code);
            return json!({
                "error": {
                    "message": error_msg,
                    "status_code": status_code
                }
            });
        }

        let decoder_name = response_decoder
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(template_engine);

        let result = match decoder_name {
            "openai_responses" => self.adapt_openai_responses(raw_response.clone()),
            "anthropic_messages" => self.adapt_anthropic(raw_response.clone()),
            "google_gemini" => self.adapt_gemini(raw_response.clone()),
            _ => match template_engine {
                "jinja2" | "handlebars" => {
                    self.transform_handlebars(response_transform, &raw_response)
                }
                "anthropic_messages" => self.adapt_anthropic(raw_response.clone()),
                "google_gemini" => self.adapt_gemini(raw_response.clone()),
                _ => Ok(raw_response.clone()),
            },
        };

        match result {
            Ok(val) => val,
            Err(e) => {
                error!(
                    "Response transform failed: engine={} error={}",
                    template_engine, e
                );
                raw_response
            }
        }
    }

    pub fn extract_error(&self, raw: &Value, status_code: u16) -> String {
        if let Some(message) = raw
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .or_else(|| raw.get("error").and_then(|v| v.as_str()))
            .or_else(|| raw.get("message").and_then(|v| v.as_str()))
            .or_else(|| raw.get("detail").and_then(|v| v.as_str()))
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            return message.to_string();
        }

        // 处理可能的 HTML 响应（网关报错）
        if let Some(text) = raw.as_str() {
            let lower = text.to_ascii_lowercase();
            if !lower.contains("<!doctype html") && !lower.contains("<html") {
                return text.chars().take(300).collect();
            }
        }

        format!("Upstream error with status code {}", status_code)
    }

    fn transform_handlebars(&self, template: &Value, context: &Value) -> Result<Value, String> {
        if template.is_null() {
            return Ok(context.clone());
        }

        self.recursive_render(template, context)
    }

    fn recursive_render(&self, obj: &Value, context: &Value) -> Result<Value, String> {
        match obj {
            Value::String(s) => {
                if s.contains("{{") {
                    self.hb
                        .render_template(s, context)
                        .map(|rendered| {
                            // Try to parse back to JSON if it looks like an object or array
                            let trimmed = rendered.trim();
                            if (trimmed.starts_with('{') && trimmed.ends_with('}'))
                                || (trimmed.starts_with('[') && trimmed.ends_with(']'))
                            {
                                serde_json::from_str(&rendered).unwrap_or(Value::String(rendered))
                            } else {
                                Value::String(rendered)
                            }
                        })
                        .map_err(|e| e.to_string())
                } else {
                    Ok(Value::String(s.clone()))
                }
            }
            Value::Object(map) => {
                let mut new_map = serde_json::Map::new();
                for (k, v) in map {
                    new_map.insert(k.clone(), self.recursive_render(v, context)?);
                }
                Ok(Value::Object(new_map))
            }
            Value::Array(arr) => {
                let mut new_arr = Vec::new();
                for v in arr {
                    new_arr.push(self.recursive_render(v, context)?);
                }
                Ok(Value::Array(new_arr))
            }
            _ => Ok(obj.clone()),
        }
    }

    fn adapt_anthropic(&self, raw: Value) -> Result<Value, String> {
        let mut content_str = String::new();
        let mut reasoning_str = String::new();
        let mut tool_calls = Vec::new();

        if let Some(content) = raw.get("content").and_then(|c| c.as_array()) {
            for block in content {
                let block_type = block.get("type").and_then(|t| t.as_str()).unwrap_or("");
                match block_type {
                    "text" => {
                        if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                            content_str.push_str(text);
                        }
                    }
                    "thinking" => {
                        if let Some(thinking) = block.get("thinking").and_then(|t| t.as_str()) {
                            reasoning_str.push_str(thinking);
                        }
                    }
                    "tool_use" => {
                        tool_calls.push(json!({
                            "id": block.get("id"),
                            "type": "function",
                            "function": {
                                "name": block.get("name"),
                                "arguments": serde_json::to_string(block.get("input").unwrap_or(&json!({}))).unwrap_or_default()
                            }
                        }));
                    }
                    _ => {}
                }
            }
        }

        let mut message = json!({ "role": "assistant" });
        if !content_str.is_empty() {
            message["content"] = json!(content_str);
        }
        if !reasoning_str.is_empty() {
            message["reasoning_content"] = json!(reasoning_str);
        }
        if !tool_calls.is_empty() {
            message["tool_calls"] = json!(tool_calls);
            if content_str.is_empty() {
                message["content"] = Value::Null;
            }
        }

        let stop_reason = raw
            .get("stop_reason")
            .and_then(|s| s.as_str())
            .unwrap_or("stop");
        let finish_reason = match stop_reason {
            "end_turn" => "stop",
            "max_tokens" => "length",
            "stop_sequence" => "stop",
            _ => stop_reason,
        };

        let prompt_tokens = raw
            .get("usage")
            .and_then(|u| u.get("input_tokens"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let completion_tokens = raw
            .get("usage")
            .and_then(|u| u.get("output_tokens"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        Ok(json!({
            "id": raw.get("id"),
            "object": "chat.completion",
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": finish_reason
            }],
            "usage": {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens
            }
        }))
    }

    fn adapt_gemini(&self, raw: Value) -> Result<Value, String> {
        let mut choices = Vec::new();

        if let Some(candidates) = raw.get("candidates").and_then(|c| c.as_array()) {
            if let Some(cand) = candidates.first() {
                let mut text_content = String::new();
                let mut reasoning_content = String::new();
                let mut tool_calls = Vec::new();

                if let Some(parts) = cand
                    .get("content")
                    .and_then(|c| c.get("parts"))
                    .and_then(|p| p.as_array())
                {
                    for (idx, part) in parts.iter().enumerate() {
                        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                            text_content.push_str(text);
                        } else if let Some(thought) = part.get("thought").and_then(|t| t.as_str()) {
                            reasoning_content.push_str(thought);
                        } else if let Some(func_call) =
                            part.get("functionCall").or(part.get("function_call"))
                        {
                            let thought_signature = part
                                .get("thoughtSignature")
                                .or_else(|| part.get("thought_signature"))
                                .cloned();
                            tool_calls.push(json!({
                                "id": format!("gemini-func-{}", idx),
                                "type": "function",
                                "function": {
                                    "name": func_call.get("name"),
                                    "arguments": serde_json::to_string(func_call.get("args").unwrap_or(&json!({}))).unwrap_or_default()
                                },
                                "extra_content": {
                                    "google": {
                                        "thought_signature": thought_signature
                                    }
                                }
                            }));
                        }
                    }
                }

                let mut message = json!({ "role": "assistant" });
                if !text_content.is_empty() {
                    message["content"] = json!(text_content);
                }
                if !reasoning_content.is_empty() {
                    message["reasoning_content"] = json!(reasoning_content);
                }
                if !tool_calls.is_empty() {
                    message["tool_calls"] = json!(tool_calls);
                    if text_content.is_empty() {
                        message["content"] = Value::Null;
                    }
                }

                let finish_reason = cand
                    .get("finishReason")
                    .and_then(|f| f.as_str())
                    .unwrap_or("STOP")
                    .to_lowercase();

                choices.push(json!({
                    "index": 0,
                    "message": message,
                    "finish_reason": finish_reason
                }));
            }
        }

        let mut result = json!({
            "id": raw.get("id").unwrap_or(&json!("gemini-adapt")),
            "object": "chat.completion",
            "choices": choices
        });

        if let Some(usage_meta) = raw.get("usageMetadata").or(raw.get("usage_metadata")) {
            result["usage"] = json!({
                "prompt_tokens": usage_meta.get("promptTokenCount").and_then(|v| v.as_i64()).unwrap_or(0),
                "completion_tokens": usage_meta.get("candidatesTokenCount").and_then(|v| v.as_i64()).unwrap_or(0),
                "total_tokens": usage_meta.get("totalTokenCount").and_then(|v| v.as_i64()).unwrap_or(0)
            });
        }

        Ok(result)
    }

    fn adapt_openai_responses(&self, raw: Value) -> Result<Value, String> {
        let mut output_text = String::new();
        let mut tool_calls = Vec::new();

        if let Some(items) = raw.get("output").and_then(|value| value.as_array()) {
            for item in items {
                if !item.is_object() {
                    continue;
                }
                match item
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                {
                    "message" => {
                        if let Some(content) =
                            item.get("content").and_then(|value| value.as_array())
                        {
                            for part in content {
                                if part.get("type").and_then(|value| value.as_str())
                                    == Some("output_text")
                                {
                                    if let Some(text) =
                                        part.get("text").and_then(|value| value.as_str())
                                    {
                                        output_text.push_str(text);
                                    }
                                }
                            }
                        }
                    }
                    "function_call" | "tool_call" => {
                        let call_id = item
                            .get("call_id")
                            .and_then(|value| value.as_str())
                            .or_else(|| item.get("id").and_then(|value| value.as_str()))
                            .unwrap_or_default();
                        tool_calls.push(json!({
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": item.get("name"),
                                "arguments": item.get("arguments").cloned().unwrap_or(Value::Null),
                            },
                            "extra_content": {
                                "openai_responses": {
                                    "response_item_id": item.get("id").cloned().unwrap_or(Value::Null),
                                    "call_id": item.get("call_id").cloned().unwrap_or(Value::Null),
                                    "status": item.get("status").cloned().unwrap_or(Value::Null),
                                }
                            }
                        }));
                    }
                    _ => {}
                }
            }
        }

        let mut message = json!({ "role": "assistant" });
        if !output_text.is_empty() {
            message["content"] = json!(output_text);
        }
        if !tool_calls.is_empty() {
            message["tool_calls"] = Value::Array(tool_calls);
            if output_text.is_empty() {
                message["content"] = Value::Null;
            }
        }

        let usage = raw.get("usage").cloned().unwrap_or_else(|| json!({}));
        let input_tokens = usage
            .get("input_tokens")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let output_tokens = usage
            .get("output_tokens")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);

        Ok(json!({
            "id": raw.get("id").cloned().unwrap_or_else(|| json!("response-adapt")),
            "object": "chat.completion",
            "model": raw.get("model").cloned().unwrap_or(Value::Null),
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": raw.get("status").cloned().unwrap_or_else(|| json!("stop"))
            }],
            "usage": {
                "prompt_tokens": input_tokens,
                "completion_tokens": output_tokens,
                "total_tokens": usage
                    .get("total_tokens")
                    .and_then(|value| value.as_i64())
                    .unwrap_or(input_tokens + output_tokens)
            }
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapt_gemini_preserves_thought_signature_in_tool_call_extra_content() {
        let transformer = ResponseTransformer::new();
        let result = transformer
            .adapt_gemini(json!({
                "candidates": [{
                    "content": {
                        "parts": [{
                            "functionCall": {
                                "name": "search_docs",
                                "args": { "q": "tool replay" }
                            },
                            "thoughtSignature": "sig-123"
                        }]
                    },
                    "finishReason": "STOP"
                }]
            }))
            .expect("adapt gemini");

        assert_eq!(
            result["choices"][0]["message"]["tool_calls"][0]["extra_content"]["google"]
                ["thought_signature"],
            json!("sig-123")
        );
    }
}

#[cfg(test)]
mod openai_responses_tests {
    use super::ResponseTransformer;
    use serde_json::json;

    #[test]
    fn transform_uses_openai_responses_decoder_when_requested() {
        let transformer = ResponseTransformer::new();
        let transformed = transformer.transform(
            "openai_compat",
            Some("openai_responses"),
            &json!({}),
            json!({
                "model": "gpt-5.3-codex",
                "output": [{
                    "type": "message",
                    "content": [{ "type": "output_text", "text": "hello rust responses" }]
                }],
                "usage": { "input_tokens": 2, "output_tokens": 3, "total_tokens": 5 },
                "status": "completed"
            }),
            200,
        );

        assert_eq!(
            transformed["choices"][0]["message"]["content"],
            json!("hello rust responses")
        );
        assert_eq!(transformed["usage"]["total_tokens"], json!(5));
    }

    #[test]
    fn transform_uses_openai_responses_call_id_for_tool_replay() {
        let transformer = ResponseTransformer::new();
        let transformed = transformer.transform(
            "openai_compat",
            Some("openai_responses"),
            &json!({}),
            json!({
                "model": "gpt-5.3-codex",
                "output": [{
                    "id": "fc_123",
                    "call_id": "call_123",
                    "type": "function_call",
                    "name": "search_sdk",
                    "arguments": "{\"query\":\"tool replay\"}",
                    "status": "completed"
                }],
                "usage": { "input_tokens": 2, "output_tokens": 3, "total_tokens": 5 },
                "status": "completed"
            }),
            200,
        );

        assert_eq!(
            transformed["choices"][0]["message"]["tool_calls"][0]["id"],
            json!("call_123")
        );
        assert_eq!(
            transformed["choices"][0]["message"]["tool_calls"][0]["extra_content"]
                ["openai_responses"]["response_item_id"],
            json!("fc_123")
        );
    }
}
