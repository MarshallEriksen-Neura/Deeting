use serde_json::{json, Value};
use crate::modules::providers::error::ProviderError;
use handlebars::Handlebars;
use log::error;

pub struct ResponseTransformer {
    hb: Handlebars<'static>,
}

impl ResponseTransformer {
    pub fn new() -> Self {
        let mut hb = Handlebars::new();
        hb.set_strict_mode(false);
        Self { hb }
    pub fn transform(
        &self,
        template_engine: &str,
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

        let result = match template_engine {
    ...
    }

    pub fn extract_error(&self, raw: &Value, status_code: u16) -> String {
        if let Some(message) = raw.pointer("/error/message")
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

            "jinja2" | "handlebars" => self.transform_handlebars(response_transform, &raw_response),
            "openai_compat" => Ok(raw_response.clone()),
            "anthropic_messages" => self.adapt_anthropic(raw_response.clone()),
            "google_gemini" => self.adapt_gemini(raw_response.clone()),
            _ => Ok(raw_response.clone()),
        };

        match result {
            Ok(val) => val,
            Err(e) => {
                error!("Response transform failed: engine={} error={}", template_engine, e);
                raw_response
            }
        }
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
                    self.hb.render_template(s, context)
                        .map(|rendered| {
                            // Try to parse back to JSON if it looks like an object or array
                            let trimmed = rendered.trim();
                            if (trimmed.starts_with('{') && trimmed.ends_with('}')) || 
                               (trimmed.starts_with('[') && trimmed.ends_with(']')) {
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

        let stop_reason = raw.get("stop_reason").and_then(|s| s.as_str()).unwrap_or("stop");
        let finish_reason = match stop_reason {
            "end_turn" => "stop",
            "max_tokens" => "length",
            "stop_sequence" => "stop",
            _ => stop_reason,
        };

        let prompt_tokens = raw.get("usage").and_then(|u| u.get("input_tokens")).and_then(|v| v.as_i64()).unwrap_or(0);
        let completion_tokens = raw.get("usage").and_then(|u| u.get("output_tokens")).and_then(|v| v.as_i64()).unwrap_or(0);

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

                if let Some(parts) = cand.get("content").and_then(|c| c.get("parts")).and_then(|p| p.as_array()) {
                    for (idx, part) in parts.iter().enumerate() {
                        if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                            text_content.push_str(text);
                        } else if let Some(thought) = part.get("thought").and_then(|t| t.as_str()) {
                            reasoning_content.push_str(thought);
                        } else if let Some(func_call) = part.get("functionCall").or(part.get("function_call")) {
                            tool_calls.push(json!({
                                "id": format!("gemini-func-{}", idx),
                                "type": "function",
                                "function": {
                                    "name": func_call.get("name"),
                                    "arguments": serde_json::to_string(func_call.get("args").unwrap_or(&json!({}))).unwrap_or_default()
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

                let finish_reason = cand.get("finishReason").and_then(|f| f.as_str()).unwrap_or("STOP").to_lowercase();
                
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
}
