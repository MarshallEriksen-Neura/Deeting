use mcp_core::types::{LocalChatInputMessage, LocalChatToolCall};
use serde_json::{json, Value};

use crate::modules::providers::protocols::canonical::{
    CanonicalClientContext, CanonicalInputItem, CanonicalMessage, CanonicalRequest,
    CanonicalToolCall,
};
use crate::modules::providers::protocols::content::normalize_message_content_value;
use crate::modules::providers::protocols::profile::{
    ProfileAuthConfig, ProfileDefaults, ProfileFeatureFlags, ProfileRequestConfig,
    ProfileResponseConfig, ProfileStreamConfig, ProfileTransport, ProtocolProfile, RuntimeHook,
};
use crate::modules::providers::types::{ProviderModel, ProviderPreset};

pub fn infer_protocol_family(protocol: &str, upstream_path: &str) -> &'static str {
    let proto = protocol.trim().to_ascii_lowercase();
    let path = upstream_path.trim().to_ascii_lowercase();
    if proto.contains("anthropic") || proto.contains("claude") {
        return "anthropic_messages";
    }
    if proto.contains("gemini") || proto.contains("google") || proto.contains("vertex") {
        return "google_gemini";
    }
    if path.contains("responses") || proto.contains("responses") {
        return "openai_responses";
    }
    "openai_chat"
}

pub fn template_matches_family(template: &Value, capability: &str, protocol_family: &str) -> bool {
    let Some(object) = template.as_object() else {
        return true;
    };
    match capability {
        "embedding" => return object.contains_key("input"),
        "image_generation" | "video_generation" => return object.contains_key("prompt"),
        "text_to_speech" => return object.contains_key("input"),
        "speech_to_text" => {
            return object.contains_key("audio_data")
                || object.contains_key("audio")
                || object.contains_key("file");
        }
        _ => {}
    }
    match protocol_family {
        "openai_responses" => object.contains_key("input"),
        "google_gemini" => object.contains_key("contents"),
        "openai_chat" | "anthropic_messages" => object.contains_key("messages"),
        _ => true,
    }
}

pub fn build_protocol_profile(
    preset: Option<&ProviderPreset>,
    model: &ProviderModel,
    capability: &str,
    protocol: &str,
    effective_config: &Value,
    resolved_headers: &Value,
    default_params: &Value,
) -> ProtocolProfile {
    let family = infer_protocol_family(protocol, model.upstream_path.as_str()).to_string();

    if let Some(stored) = preset
        .and_then(|item| item.protocol_profiles.as_object())
        .and_then(|profiles| profiles.get(capability))
        .cloned()
    {
        if let Ok(mut profile) = serde_json::from_value::<ProtocolProfile>(stored) {
            let family_changed = profile.protocol_family != family;
            profile.provider = preset
                .map(|item| item.provider.clone())
                .unwrap_or_else(|| profile.provider.clone());
            profile.profile_id = format!("{}:{}:{}", profile.provider, capability, family);
            profile.protocol_family = family.clone();
            profile.capability = capability.to_string();
            profile.transport.path = model.upstream_path.clone();
            if !template_matches_family(
                &profile.request.request_template,
                capability,
                family.as_str(),
            ) {
                profile.request.request_template =
                    builtin_request_template(capability, family.as_str());
                profile.request.template_engine =
                    builtin_template_engine(family.as_str()).to_string();
            }
            if family_changed || profile.request.request_builder.is_none() {
                profile.request.request_builder = builtin_request_builder(family.as_str());
            }
            if family_changed {
                profile.response.decoder = builtin_response_decoder(family.as_str());
                profile.stream.stream_decoder = Some(builtin_stream_decoder(family.as_str()));
                profile.features = ProfileFeatureFlags {
                    supports_messages: family != "openai_responses",
                    supports_input_items: family == "openai_responses",
                };
            }
            profile.defaults.headers = deep_merge_json(&profile.defaults.headers, resolved_headers);
            profile.defaults.body = deep_merge_json(&profile.defaults.body, default_params);
            return profile;
        }
    }

    let template_candidate = effective_config
        .get("request_template")
        .cloned()
        .or_else(|| effective_config.get("body_template").cloned());
    let request_template = template_candidate
        .clone()
        .filter(|template| template_matches_family(template, capability, family.as_str()))
        .unwrap_or_else(|| builtin_request_template(capability, family.as_str()));
    let template_engine = effective_config
        .get("template_engine")
        .and_then(|value| value.as_str())
        .filter(|_| {
            template_candidate
                .as_ref()
                .map(|template| template_matches_family(template, capability, family.as_str()))
                .unwrap_or(true)
        })
        .unwrap_or_else(|| builtin_template_engine(family.as_str()))
        .to_string();
    let request_builder = effective_config
        .get("request_builder")
        .and_then(runtime_hook_from_value)
        .or_else(|| builtin_request_builder(family.as_str()));
    let response_decoder = builtin_response_decoder(family.as_str());
    let stream_decoder = builtin_stream_decoder(family.as_str());
    let provider = preset
        .map(|item| item.provider.clone())
        .unwrap_or_else(|| "custom".to_string());

    ProtocolProfile {
        runtime_version: "v2".to_string(),
        schema_version: "2026-03-07".to_string(),
        profile_id: format!("{}:{}:{}", provider, capability, family),
        provider,
        protocol_family: family.clone(),
        capability: capability.to_string(),
        transport: ProfileTransport {
            method: effective_config
                .get("http_method")
                .and_then(|value| value.as_str())
                .or_else(|| {
                    effective_config
                        .get("method")
                        .and_then(|value| value.as_str())
                })
                .unwrap_or("POST")
                .to_string(),
            path: model.upstream_path.clone(),
            query_template: json!({}),
            header_template: resolved_headers.clone(),
        },
        request: ProfileRequestConfig {
            template_engine,
            request_template,
            request_builder,
        },
        response: ProfileResponseConfig {
            decoder: response_decoder,
            response_template: effective_config
                .get("response_transform")
                .cloned()
                .or_else(|| effective_config.get("response_template").cloned())
                .unwrap_or_else(|| json!({})),
        },
        stream: ProfileStreamConfig {
            stream_decoder: Some(stream_decoder),
        },
        auth: ProfileAuthConfig {
            auth_policy: "inherit".to_string(),
            config: json!({}),
        },
        features: ProfileFeatureFlags {
            supports_messages: family != "openai_responses",
            supports_input_items: family == "openai_responses",
        },
        defaults: ProfileDefaults {
            headers: resolved_headers.clone(),
            query: json!({}),
            body: default_params.clone(),
        },
    }
}

fn deep_merge_json(base: &Value, override_value: &Value) -> Value {
    if let (Some(base_obj), Some(override_obj)) = (base.as_object(), override_value.as_object()) {
        let mut merged = base_obj.clone();
        for (key, value) in override_obj {
            merged.insert(key.clone(), value.clone());
        }
        return Value::Object(merged);
    }
    if override_value.is_null() {
        return base.clone();
    }
    override_value.clone()
}

pub fn build_canonical_request_from_value(
    request_data: &Value,
    capability: &str,
    protocol_family: &str,
) -> CanonicalRequest {
    let model = request_data
        .get("model")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let stream = request_data
        .get("stream")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let temperature = request_data
        .get("temperature")
        .and_then(|value| value.as_f64());
    let max_output_tokens = request_data
        .get("max_output_tokens")
        .or_else(|| request_data.get("max_tokens"))
        .and_then(|value| value.as_i64());

    let messages: Vec<CanonicalMessage> = request_data
        .get("messages")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let role = item.get("role").and_then(|value| value.as_str())?;
                    Some(CanonicalMessage {
                        role: role.to_string(),
                        content: normalize_message_content_value(role, item.get("content")),
                        tool_calls: canonical_tool_calls_from_message(item),
                        tool_call_id: item
                            .get("tool_call_id")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string()),
                        name: item
                            .get("name")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string()),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let input_items = if protocol_family == "openai_responses" {
        if let Some(input) = request_data.get("input") {
            canonical_input_items_from_value(input)
        } else {
            canonical_input_items_from_messages(&messages)
        }
    } else {
        vec![]
    };

    CanonicalRequest {
        canonical_version: "2026-03-07".to_string(),
        capability: capability.to_string(),
        model,
        instructions: request_data
            .get("system")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string()),
        messages,
        input_items,
        stream,
        temperature,
        max_output_tokens,
        reasoning_enabled: None,
        reasoning_effort: None,
        metadata: json!({}),
        client_context: CanonicalClientContext::default(),
    }
}

pub fn build_canonical_chat_request_from_local_messages(
    model: &str,
    messages: &[LocalChatInputMessage],
    stream: bool,
    temperature: Option<f64>,
    max_output_tokens: Option<i64>,
) -> CanonicalRequest {
    build_canonical_chat_request_from_local_messages_with_reasoning(
        model,
        messages,
        stream,
        temperature,
        max_output_tokens,
        None,
        None,
    )
}

pub fn build_canonical_chat_request_from_local_messages_with_reasoning(
    model: &str,
    messages: &[LocalChatInputMessage],
    stream: bool,
    temperature: Option<f64>,
    max_output_tokens: Option<i64>,
    reasoning_enabled: Option<bool>,
    reasoning_effort: Option<String>,
) -> CanonicalRequest {
    CanonicalRequest {
        canonical_version: "2026-03-07".to_string(),
        capability: "chat".to_string(),
        model: model.to_string(),
        instructions: None,
        messages: messages
            .iter()
            .map(canonical_message_from_local_chat_message)
            .collect(),
        input_items: vec![],
        stream,
        temperature,
        max_output_tokens,
        reasoning_enabled,
        reasoning_effort,
        metadata: json!({}),
        client_context: CanonicalClientContext::default(),
    }
}

pub fn build_chat_request_data_from_canonical_request(request: &CanonicalRequest) -> Value {
    let mut body = json!({
        "model": request.model,
        "messages": Value::Array(
            request
                .messages
                .iter()
                .map(message_value_from_canonical_message)
                .collect(),
        ),
        "stream": request.stream,
    });

    if let Some(temperature) = request.temperature {
        body["temperature"] = json!(temperature);
    }
    if let Some(max_output_tokens) = request.max_output_tokens {
        body["max_tokens"] = json!(max_output_tokens);
    }

    body
}

fn canonical_input_items_from_value(value: &Value) -> Vec<CanonicalInputItem> {
    match value {
        Value::String(text) => vec![CanonicalInputItem {
            r#type: "text".to_string(),
            role: Some("user".to_string()),
            text: Some(text.clone()),
            mime_type: None,
            url: None,
            data: json!({}),
        }],
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if let Some(text) = item.as_str() {
                    CanonicalInputItem {
                        r#type: "text".to_string(),
                        role: Some("user".to_string()),
                        text: Some(text.to_string()),
                        mime_type: None,
                        url: None,
                        data: json!({}),
                    }
                } else {
                    CanonicalInputItem {
                        r#type: item
                            .get("type")
                            .and_then(|value| value.as_str())
                            .unwrap_or("input")
                            .to_string(),
                        role: item
                            .get("role")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string())
                            .or_else(|| Some("user".to_string())),
                        text: item
                            .get("text")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string()),
                        mime_type: item
                            .get("mime_type")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string()),
                        url: item
                            .get("url")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string()),
                        data: item.clone(),
                    }
                }
            })
            .collect(),
        Value::Object(_) => vec![CanonicalInputItem {
            r#type: "input".to_string(),
            role: Some("user".to_string()),
            text: None,
            mime_type: None,
            url: None,
            data: value.clone(),
        }],
        _ => vec![],
    }
}

fn canonical_message_from_local_chat_message(message: &LocalChatInputMessage) -> CanonicalMessage {
    CanonicalMessage {
        role: message.role.clone(),
        content: normalize_message_content_value(
            message.role.as_str(),
            Some(&Value::String(message.content.clone())),
        ),
        tool_calls: message
            .tool_calls
            .iter()
            .map(canonical_tool_call_from_local_chat_tool_call)
            .collect(),
        tool_call_id: message.tool_call_id.clone(),
        name: message.name.clone(),
    }
}

fn canonical_tool_call_from_local_chat_tool_call(call: &LocalChatToolCall) -> CanonicalToolCall {
    CanonicalToolCall {
        id: call.id.clone(),
        r#type: "function".to_string(),
        name: Some(call.name.clone()),
        arguments: Some(call.arguments.clone()),
        status: None,
        extra_content: call.extra_content.clone().unwrap_or_else(|| json!({})),
    }
}

fn message_value_from_canonical_message(message: &CanonicalMessage) -> Value {
    let mut object = serde_json::Map::new();
    object.insert("role".to_string(), Value::String(message.role.clone()));
    object.insert("content".to_string(), message.content.clone());

    if let Some(name) = message.name.as_ref() {
        object.insert("name".to_string(), Value::String(name.clone()));
    }
    if let Some(tool_call_id) = message.tool_call_id.as_ref() {
        object.insert(
            "tool_call_id".to_string(),
            Value::String(tool_call_id.clone()),
        );
    }
    if !message.tool_calls.is_empty() {
        object.insert(
            "tool_calls".to_string(),
            Value::Array(
                message
                    .tool_calls
                    .iter()
                    .map(tool_call_value_from_canonical_tool_call)
                    .collect(),
            ),
        );
    }

    Value::Object(object)
}

fn tool_call_value_from_canonical_tool_call(call: &CanonicalToolCall) -> Value {
    let mut object = serde_json::Map::new();
    object.insert("type".to_string(), Value::String(call.r#type.clone()));

    if let Some(id) = call.id.as_ref() {
        object.insert("id".to_string(), Value::String(id.clone()));
    }
    if let Some(name) = call.name.as_ref() {
        object.insert("name".to_string(), Value::String(name.clone()));
    }
    if let Some(arguments) = call.arguments.as_ref() {
        object.insert("arguments".to_string(), arguments.clone());
    }
    if let Some(status) = call.status.as_ref() {
        object.insert("status".to_string(), Value::String(status.clone()));
    }
    if !call.extra_content.is_null()
        && call
            .extra_content
            .as_object()
            .map(|object| !object.is_empty())
            .unwrap_or(true)
    {
        object.insert("extra_content".to_string(), call.extra_content.clone());
    }

    Value::Object(object)
}

fn canonical_input_items_from_messages(messages: &[CanonicalMessage]) -> Vec<CanonicalInputItem> {
    let mut items = vec![];
    for message in messages {
        if message.role == "system" {
            continue;
        }
        items.extend(canonical_input_items_from_content(
            message.role.as_str(),
            &message.content,
        ));
    }
    items
}

fn canonical_input_items_from_content(role: &str, content: &Value) -> Vec<CanonicalInputItem> {
    match content {
        Value::Null => vec![],
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                vec![]
            } else {
                vec![CanonicalInputItem {
                    r#type: "input_text".to_string(),
                    role: Some(role.to_string()),
                    text: Some(text.clone()),
                    mime_type: None,
                    url: None,
                    data: json!({ "type": "input_text", "text": text }),
                }]
            }
        }
        Value::Array(items) => items
            .iter()
            .flat_map(|item| canonical_input_items_from_content_block(role, item))
            .collect(),
        Value::Object(object) => {
            if object
                .get("type")
                .and_then(|value| value.as_str())
                .is_some()
            {
                canonical_input_items_from_content_block(role, content)
            } else {
                let text = object
                    .get("text")
                    .and_then(|value| value.as_str())
                    .or_else(|| object.get("content").and_then(|value| value.as_str()))
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                match text {
                    Some(value) => vec![CanonicalInputItem {
                        r#type: "input_text".to_string(),
                        role: Some(role.to_string()),
                        text: Some(value.to_string()),
                        mime_type: None,
                        url: None,
                        data: json!({ "type": "input_text", "text": value }),
                    }],
                    None => vec![],
                }
            }
        }
        _ => vec![],
    }
}

fn canonical_input_items_from_content_block(role: &str, item: &Value) -> Vec<CanonicalInputItem> {
    let Some(object) = item.as_object() else {
        return vec![];
    };
    let Some(block_type) = object.get("type").and_then(|value| value.as_str()) else {
        return vec![];
    };
    match block_type {
        "text" => {
            let text = object
                .get("text")
                .and_then(|value| value.as_str())
                .or_else(|| object.get("content").and_then(|value| value.as_str()))
                .map(str::trim)
                .filter(|value| !value.is_empty());
            match text {
                Some(value) => vec![CanonicalInputItem {
                    r#type: "input_text".to_string(),
                    role: Some(role.to_string()),
                    text: Some(value.to_string()),
                    mime_type: None,
                    url: None,
                    data: json!({ "type": "input_text", "text": value }),
                }],
                None => vec![],
            }
        }
        "image_url" => {
            let url = object
                .get("image_url")
                .and_then(|value| {
                    value.as_str().map(|raw| raw.to_string()).or_else(|| {
                        value
                            .get("url")
                            .and_then(|entry| entry.as_str())
                            .map(str::to_string)
                    })
                })
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            match url {
                Some(value) => vec![CanonicalInputItem {
                    r#type: "input_image".to_string(),
                    role: Some(role.to_string()),
                    text: None,
                    mime_type: None,
                    url: Some(value.clone()),
                    data: json!({ "type": "input_image", "image_url": value }),
                }],
                None => vec![],
            }
        }
        "input_file" => {
            let nested = object.get("input_file");
            let file_id = nested
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or_else(|| {
                    nested.and_then(|value| {
                        value
                            .get("file_id")
                            .and_then(|entry| entry.as_str())
                            .map(str::to_string)
                    })
                })
                .or_else(|| {
                    object
                        .get("file_id")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                })
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let filename = nested
                .and_then(|value| value.get("filename").and_then(|entry| entry.as_str()))
                .or_else(|| object.get("filename").and_then(|value| value.as_str()))
                .map(str::trim)
                .filter(|value| !value.is_empty());
            match file_id {
                Some(value) => vec![CanonicalInputItem {
                    r#type: "input_file".to_string(),
                    role: Some(role.to_string()),
                    text: None,
                    mime_type: None,
                    url: None,
                    data: json!({
                        "type": "input_file",
                        "file_id": value,
                        "filename": filename,
                    }),
                }],
                None => vec![],
            }
        }
        _ => vec![],
    }
}

fn builtin_template_engine(protocol_family: &str) -> &'static str {
    match protocol_family {
        "anthropic_messages" => "anthropic_messages",
        "google_gemini" => "google_gemini",
        _ => "openai_compat",
    }
}

fn builtin_request_template(capability: &str, protocol_family: &str) -> Value {
    match capability {
        "chat" if protocol_family == "openai_responses" => json!({
            "model": Value::Null,
            "input": Value::Null,
            "stream": Value::Null,
            "temperature": Value::Null,
            "max_output_tokens": Value::Null,
        }),
        "chat" if protocol_family == "google_gemini" => json!({
            "model": Value::Null,
            "contents": Value::Null,
        }),
        "embedding" => json!({ "model": Value::Null, "input": Value::Null }),
        "image_generation" => json!({
            "model": Value::Null,
            "prompt": Value::Null,
            "n": Value::Null,
        }),
        "video_generation" => json!({
            "model": Value::Null,
            "prompt": Value::Null,
        }),
        "text_to_speech" => json!({
            "model": Value::Null,
            "input": Value::Null,
            "voice": Value::Null,
        }),
        "speech_to_text" => json!({
            "model": Value::Null,
            "audio_data": Value::Null,
            "response_format": Value::Null,
        }),
        _ => json!({
            "model": Value::Null,
            "messages": Value::Null,
            "stream": Value::Null,
            "temperature": Value::Null,
            "max_tokens": Value::Null,
        }),
    }
}

fn builtin_request_builder(protocol_family: &str) -> Option<RuntimeHook> {
    if protocol_family == "openai_chat" {
        return Some(RuntimeHook {
            name: "openai_chat_messages_from_canonical".to_string(),
            config: json!({}),
        });
    }
    if protocol_family == "anthropic_messages" {
        return Some(RuntimeHook {
            name: "anthropic_messages_from_canonical".to_string(),
            config: json!({}),
        });
    }
    if protocol_family == "google_gemini" {
        return Some(RuntimeHook {
            name: "google_gemini_contents_from_canonical".to_string(),
            config: json!({}),
        });
    }
    if protocol_family == "openai_responses" {
        return Some(RuntimeHook {
            name: "responses_input_from_messages_or_items".to_string(),
            config: json!({}),
        });
    }
    None
}

fn canonical_tool_calls_from_message(item: &Value) -> Vec<CanonicalToolCall> {
    item.get("tool_calls")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|call| {
                    let name = call
                        .get("name")
                        .and_then(|value| value.as_str())
                        .or_else(|| {
                            call.get("function")
                                .and_then(|value| value.get("name"))
                                .and_then(|value| value.as_str())
                        })?
                        .to_string();
                    let arguments = call
                        .get("arguments")
                        .cloned()
                        .or_else(|| {
                            call.get("function")
                                .and_then(|value| value.get("arguments"))
                                .cloned()
                        })
                        .map(|value| match value {
                            Value::String(text) => serde_json::from_str::<Value>(&text)
                                .unwrap_or_else(|_| Value::String(text)),
                            other => other,
                        });
                    Some(CanonicalToolCall {
                        id: call
                            .get("id")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string()),
                        r#type: call
                            .get("type")
                            .and_then(|value| value.as_str())
                            .unwrap_or("function")
                            .to_string(),
                        name: Some(name),
                        arguments,
                        status: call
                            .get("status")
                            .and_then(|value| value.as_str())
                            .map(|value| value.to_string()),
                        extra_content: call
                            .get("extra_content")
                            .cloned()
                            .unwrap_or_else(|| json!({})),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn builtin_response_decoder(protocol_family: &str) -> RuntimeHook {
    RuntimeHook {
        name: match protocol_family {
            "openai_responses" => "openai_responses",
            "anthropic_messages" => "anthropic_messages",
            _ => "openai_chat",
        }
        .to_string(),
        config: json!({}),
    }
}

fn builtin_stream_decoder(protocol_family: &str) -> RuntimeHook {
    RuntimeHook {
        name: match protocol_family {
            "openai_responses" => "openai_responses_events",
            "anthropic_messages" => "anthropic_messages_events",
            _ => "openai_chat_events",
        }
        .to_string(),
        config: json!({}),
    }
}

fn runtime_hook_from_value(value: &Value) -> Option<RuntimeHook> {
    let Some(object) = value.as_object() else {
        return None;
    };
    let name = object
        .get("name")
        .or_else(|| object.get("type"))
        .and_then(|value| value.as_str())?;
    Some(RuntimeHook {
        name: name.to_string(),
        config: value.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_canonical_chat_request_from_local_messages, build_canonical_request_from_value,
        build_chat_request_data_from_canonical_request, build_protocol_profile,
        infer_protocol_family, template_matches_family,
    };
    use crate::modules::providers::types::{ProviderModel, ProviderPreset};
    use mcp_core::types::LocalChatInputMessage;
    use serde_json::{json, Value};
    use uuid::Uuid;

    fn mock_model(upstream_path: &str) -> ProviderModel {
        ProviderModel {
            id: Uuid::new_v4(),
            instance_id: Uuid::new_v4(),
            model_id: "gpt-5.3-codex".to_string(),
            unified_model_id: None,
            display_name: None,
            capabilities: vec!["chat".to_string()],
            upstream_path: upstream_path.to_string(),
            pricing_config: json!({}),
            limit_config: json!({}),
            tokenizer_config: json!({}),
            routing_config: json!({}),
            config_override: json!({}),
            source: "manual".to_string(),
            extra_meta: json!({}),
            weight: 100,
            priority: 0,
            is_active: true,
            synced_at: None,
            created_at: None,
            updated_at: None,
        }
    }

    fn mock_preset() -> ProviderPreset {
        ProviderPreset {
            slug: "openai".to_string(),
            name: "OpenAI".to_string(),
            provider: "openai".to_string(),
            base_url: "https://api.openai.com".to_string(),
            icon: None,
            theme_color: None,
            category: None,
            url_template: None,
            auth_type: "bearer".to_string(),
            auth_config: json!({}),
            protocol_schema_version: None,
            protocol_profiles: json!({}),
            version: 1,
            is_active: true,
        }
    }

    #[test]
    fn infer_protocol_family_prefers_responses_path() {
        assert_eq!(
            infer_protocol_family("responses", "responses"),
            "openai_responses"
        );
        assert_eq!(
            infer_protocol_family("openai", "v1/chat/completions"),
            "openai_chat"
        );
    }

    #[test]
    fn infer_protocol_family_detects_google_gemini() {
        assert_eq!(
            infer_protocol_family("google", "v1beta/models/gemini:generateContent"),
            "google_gemini"
        );
    }

    #[test]
    fn template_matches_family_rejects_chat_template_for_responses() {
        assert!(!template_matches_family(
            &json!({"messages": null}),
            "chat",
            "openai_responses"
        ));
        assert!(template_matches_family(
            &json!({"input": null}),
            "chat",
            "openai_responses"
        ));
    }

    #[test]
    fn template_matches_family_accepts_image_generation_prompt_templates() {
        assert!(template_matches_family(
            &json!({"model": null, "prompt": null, "n": 1}),
            "image_generation",
            "openai_chat"
        ));
    }

    #[test]
    fn build_protocol_profile_keeps_image_generation_prompt_template() {
        let mut model = mock_model("v1/images/generations");
        model.capabilities = vec!["image_generation".to_string()];
        model.model_id = "LongCat-Image".to_string();

        let profile = build_protocol_profile(
            Some(&mock_preset()),
            &model,
            "image_generation",
            "openai",
            &json!({
                "template_engine": "simple_replace",
                "request_template": {
                    "model": null,
                    "prompt": null,
                    "n": null
                }
            }),
            &json!({}),
            &json!({}),
        );

        assert_eq!(profile.protocol_family, "openai_chat");
        assert_eq!(profile.request.template_engine, "simple_replace");
        assert_eq!(profile.request.request_template["prompt"], Value::Null);
        assert!(profile.request.request_template.get("messages").is_none());
    }

    #[test]
    fn build_protocol_profile_uses_builtin_responses_template_when_legacy_template_mismatches() {
        let profile = build_protocol_profile(
            Some(&mock_preset()),
            &mock_model("responses"),
            "chat",
            "responses",
            &json!({
                "template_engine": "simple_replace",
                "request_template": { "messages": null }
            }),
            &json!({}),
            &json!({}),
        );

        assert_eq!(profile.protocol_family, "openai_responses");
        assert_eq!(profile.request.template_engine, "openai_compat");
        assert!(profile.request.request_template.get("input").is_some());
        assert_eq!(
            profile
                .request
                .request_builder
                .as_ref()
                .map(|item| item.name.as_str()),
            Some("responses_input_from_messages_or_items")
        );
    }

    #[test]
    fn build_canonical_request_from_messages_for_responses_creates_input_items() {
        let request = build_canonical_request_from_value(
            &json!({
                "model": "gpt-5.3-codex",
                "messages": [
                    { "role": "system", "content": "be concise" },
                    { "role": "user", "content": "hello rust" }
                ]
            }),
            "chat",
            "openai_responses",
        );

        assert_eq!(request.input_items.len(), 1);
        assert_eq!(request.input_items[0].text.as_deref(), Some("hello rust"));
    }

    #[test]
    fn build_canonical_request_parses_structured_message_content_strings() {
        let request = build_canonical_request_from_value(
            &json!({
                "model": "gpt-5.3-codex",
                "messages": [
                    {
                        "role": "user",
                        "content": "[{\"type\":\"text\",\"text\":\"describe this\"},{\"type\":\"image_url\",\"image_url\":{\"url\":\"https://example.com/image.png\"}},{\"type\":\"input_file\",\"input_file\":{\"file_id\":\"file-1\",\"filename\":\"note.txt\"}}]"
                    }
                ]
            }),
            "chat",
            "openai_responses",
        );

        assert!(request.messages[0].content.is_array());
        assert_eq!(request.input_items.len(), 3);
        assert_eq!(request.input_items[0].r#type, "input_text");
        assert_eq!(request.input_items[1].r#type, "input_image");
        assert_eq!(
            request.input_items[1].url.as_deref(),
            Some("https://example.com/image.png")
        );
        assert_eq!(request.input_items[2].r#type, "input_file");
        assert_eq!(request.input_items[2].data["file_id"], json!("file-1"));
    }

    #[test]
    fn build_canonical_request_keeps_tool_json_string_content_plain() {
        let raw_tool_content =
            "[{\"type\":\"text\",\"text\":\"Detailed Results:\"},{\"type\":\"text\",\"text\":\"1. Example\"}]";
        let request = build_canonical_request_from_value(
            &json!({
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "tool",
                        "tool_call_id": "call_123",
                        "content": raw_tool_content
                    }
                ]
            }),
            "chat",
            "openai_chat",
        );

        assert_eq!(request.messages[0].content, json!(raw_tool_content));
    }

    #[test]
    fn build_canonical_chat_request_from_local_messages_normalizes_user_and_tool_content() {
        let raw_tool_content =
            "[{\"type\":\"text\",\"text\":\"Detailed Results:\"},{\"type\":\"text\",\"text\":\"1. Example\"}]";
        let request = build_canonical_chat_request_from_local_messages(
            "gpt-4o-mini",
            &[
                LocalChatInputMessage {
                    role: "user".to_string(),
                    content:
                        "[{\"type\":\"text\",\"text\":\"describe this\"},{\"type\":\"image_url\",\"image_url\":{\"url\":\"https://example.com/image.png\"}}]"
                            .to_string(),
                    tool_calls: vec![],
                    tool_call_id: None,
                    name: None,
                },
                LocalChatInputMessage {
                    role: "tool".to_string(),
                    content: raw_tool_content.to_string(),
                    tool_calls: vec![],
                    tool_call_id: Some("call_123".to_string()),
                    name: Some("search_sdk".to_string()),
                },
            ],
            false,
            Some(0.3),
            Some(32),
        );

        assert!(request.messages[0].content.is_array());
        assert_eq!(request.messages[0].content[0]["type"], json!("text"));
        assert_eq!(request.messages[1].content, json!(raw_tool_content));
        assert_eq!(request.max_output_tokens, Some(32));
    }

    #[test]
    fn build_canonical_request_wraps_structured_object_content_for_chat_messages() {
        let request = build_canonical_request_from_value(
            &json!({
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "assistant",
                        "content": {
                            "type": "image_url",
                            "image_url": { "url": "https://example.com/image.png" }
                        }
                    }
                ]
            }),
            "chat",
            "openai_chat",
        );

        assert!(request.messages[0].content.is_array());
        assert_eq!(request.messages[0].content[0]["type"], json!("image_url"));
    }

    #[test]
    fn build_chat_request_data_from_canonical_request_preserves_normalized_message_content() {
        let request = build_canonical_chat_request_from_local_messages(
            "gpt-4o-mini",
            &[LocalChatInputMessage {
                role: "user".to_string(),
                content:
                    "[{\"type\":\"text\",\"text\":\"describe this\"},{\"type\":\"image_url\",\"image_url\":{\"url\":\"https://example.com/image.png\"}}]"
                        .to_string(),
                tool_calls: vec![],
                tool_call_id: None,
                name: None,
            }],
            false,
            None,
            Some(16),
        );

        let request_data = build_chat_request_data_from_canonical_request(&request);

        assert!(request_data["messages"][0]["content"].is_array());
        assert_eq!(request_data["max_tokens"], json!(16));
    }

    #[test]
    fn build_protocol_profile_prefers_stored_protocol_profile() {
        let mut preset = mock_preset();
        preset.protocol_profiles = json!({
            "chat": {
                "runtime_version": "v2",
                "schema_version": "2026-03-07",
                "profile_id": "openai:chat:openai_responses",
                "provider": "openai",
                "protocol_family": "openai_responses",
                "capability": "chat",
                "transport": {
                    "method": "POST",
                    "path": "responses",
                    "query_template": {},
                    "header_template": {}
                },
                "request": {
                    "template_engine": "openai_compat",
                    "request_template": { "model": null, "input": null },
                    "request_builder": {
                        "name": "responses_input_from_messages_or_items",
                        "config": {}
                    }
                },
                "response": {
                    "decoder": { "name": "openai_responses", "config": {} },
                    "response_template": {}
                },
                "stream": {
                    "stream_decoder": {
                        "name": "openai_responses_events",
                        "config": {}
                    }
                },
                "auth": { "auth_policy": "inherit", "config": {} },
                "features": {
                    "supports_messages": false,
                    "supports_input_items": true
                },
                "defaults": {
                    "headers": {},
                    "query": {},
                    "body": {}
                }
            }
        });
        let profile = build_protocol_profile(
            Some(&preset),
            &mock_model("responses"),
            "chat",
            "responses",
            &json!({}),
            &json!({ "X-Test": "1" }),
            &json!({ "temperature": 0.2 }),
        );

        assert_eq!(profile.protocol_family, "openai_responses");
        assert_eq!(profile.request.request_template["input"], Value::Null);
        assert_eq!(profile.defaults.headers["X-Test"], json!("1"));
        assert_eq!(profile.defaults.body["temperature"], json!(0.2));
    }

    #[test]
    fn build_protocol_profile_repairs_stale_stored_responses_chat_template() {
        let mut preset = mock_preset();
        preset.protocol_profiles = json!({
            "chat": {
                "runtime_version": "v2",
                "schema_version": "2026-03-07",
                "profile_id": "openai:chat:openai_responses",
                "provider": "openai",
                "protocol_family": "openai_responses",
                "capability": "chat",
                "transport": {
                    "method": "POST",
                    "path": "responses",
                    "query_template": {},
                    "header_template": {}
                },
                "request": {
                    "template_engine": "simple_replace",
                    "request_template": { "messages": null },
                    "request_builder": {
                        "name": "openai_chat_messages_from_canonical",
                        "config": {}
                    }
                },
                "response": {
                    "decoder": { "name": "openai_chat", "config": {} },
                    "response_template": {}
                },
                "stream": {
                    "stream_decoder": {
                        "name": "openai_chat_events",
                        "config": {}
                    }
                },
                "auth": { "auth_policy": "inherit", "config": {} },
                "features": {
                    "supports_messages": true,
                    "supports_input_items": false
                },
                "defaults": {
                    "headers": {},
                    "query": {},
                    "body": {}
                }
            }
        });

        let profile = build_protocol_profile(
            Some(&preset),
            &mock_model("responses"),
            "chat",
            "responses",
            &json!({}),
            &json!({}),
            &json!({}),
        );

        assert_eq!(profile.protocol_family, "openai_responses");
        assert_eq!(profile.request.template_engine, "openai_compat");
        assert_eq!(profile.request.request_template["input"], Value::Null);
        assert!(profile.request.request_template.get("messages").is_none());
        assert_eq!(
            profile
                .request
                .request_builder
                .as_ref()
                .map(|item| item.name.as_str()),
            Some("responses_input_from_messages_or_items")
        );
        assert_eq!(profile.response.decoder.name, "openai_responses");
        assert_eq!(
            profile
                .stream
                .stream_decoder
                .as_ref()
                .map(|item| item.name.as_str()),
            Some("openai_responses_events")
        );
        assert!(!profile.features.supports_messages);
        assert!(profile.features.supports_input_items);
    }

    #[test]
    fn build_protocol_profile_backfills_openai_chat_request_builder_for_stored_profile() {
        let profile = build_protocol_profile(
            Some(&mock_preset()),
            &mock_model("v1/chat/completions"),
            "chat",
            "openai",
            &json!({}),
            &json!({}),
            &json!({}),
        );

        assert_eq!(profile.protocol_family, "openai_chat");
        assert_eq!(
            profile
                .request
                .request_builder
                .as_ref()
                .map(|item| item.name.as_str()),
            Some("openai_chat_messages_from_canonical")
        );
    }
}
