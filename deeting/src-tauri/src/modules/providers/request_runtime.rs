use std::collections::BTreeMap;

use handlebars::Handlebars;
use reqwest::{Client, Method, Url};
use serde_json::{json, Map, Value};

use crate::modules::providers::protocols::{
    build_canonical_request_from_value, build_protocol_profile,
};
use crate::modules::providers::types::{ProviderInstance, ProviderModel, ProviderPreset};

#[derive(Debug, Clone)]
pub struct PreparedProviderRequest {
    pub method: String,
    pub url: String,
    pub query_params: BTreeMap<String, String>,
    pub headers: BTreeMap<String, String>,
    pub body: Value,
    pub template_engine: String,
    pub response_decoder: String,
    pub response_transform: Value,
    pub async_config: Value,
}

#[derive(Debug, Clone)]
pub struct PreparedJsonResponse {
    pub status: reqwest::StatusCode,
    pub headers: BTreeMap<String, String>,
    pub text: String,
    pub json: Option<Value>,
}

pub fn prepare_provider_request(
    preset: Option<&ProviderPreset>,
    instance: &ProviderInstance,
    model: &ProviderModel,
    secret: Option<&str>,
    capability: &str,
    request_data: Value,
    tools: Option<&Value>,
    trace_id: Option<&str>,
) -> Result<PreparedProviderRequest, String> {
    let protocol = resolve_protocol(instance, preset);
    let base_url = normalize_base_url(preset, instance);
    let auto_append_v1 = instance.meta.get("auto_append_v1").and_then(value_as_bool);
    let api_version = instance.meta.get("api_version").and_then(value_as_string);
    let (upstream_url, query_params) = build_upstream_url_with_params(
        &base_url,
        model.upstream_path.as_str(),
        Some(protocol.as_str()),
        auto_append_v1,
        api_version.as_deref(),
    );

    let effective_config = build_effective_config(preset, model, capability);
    let (auth_type, auth_config, resolved_headers) = resolve_auth_for_protocol(
        Some(protocol.as_str()),
        preset.map(|item| item.provider.as_str()),
        preset.map(|item| item.auth_type.as_str()),
        preset.map(|item| &item.auth_config),
        None,
    );

    let capability_headers = effective_config
        .get("default_headers")
        .cloned()
        .or_else(|| effective_config.get("headers").cloned())
        .unwrap_or_else(|| json!({}));
    let merged_headers = deep_merge_json(&resolved_headers, &capability_headers);

    let capability_params = effective_config
        .get("default_params")
        .cloned()
        .or_else(|| effective_config.get("params").cloned())
        .unwrap_or_else(|| json!({}));
    let default_params = capability_params;
    let protocol_profile = build_protocol_profile(
        preset,
        model,
        capability,
        protocol.as_str(),
        &effective_config,
        &merged_headers,
        &default_params,
    );
    let template_engine = protocol_profile.request.template_engine.clone();
    let response_decoder = protocol_profile.response.decoder.name.clone();
    let request_template = protocol_profile.request.request_template.clone();
    let response_transform = protocol_profile.response.response_template.clone();
    let async_config = effective_config
        .get("async_config")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let http_method = protocol_profile
        .transport
        .method
        .trim()
        .to_ascii_uppercase();
    let request_builder = protocol_profile
        .request
        .request_builder
        .as_ref()
        .map(|hook| {
            let mut value = hook.config.clone();
            if !value.is_object() {
                value = json!({});
            }
            if let Some(object) = value.as_object_mut() {
                object.insert("type".to_string(), Value::String(hook.name.clone()));
            }
            value
        })
        .unwrap_or_else(|| json!({}));
    let canonical_request = build_canonical_request_from_value(
        &request_data,
        capability,
        protocol_profile.protocol_family.as_str(),
    );

    let render_context = build_render_context(
        request_data.as_object().cloned().unwrap_or_default(),
        preset.map(|item| item.provider.as_str()),
        capability,
        model,
        &canonical_request,
    );
    let hb = build_handlebars();
    let rendered_url = render_string(
        upstream_url.as_str(),
        template_engine.as_str(),
        &render_context,
        &hb,
    )?;
    let rendered_body = render_body(
        &request_template,
        &default_params,
        &request_builder,
        template_engine.as_str(),
        &render_context,
        tools,
        &hb,
    )?;

    let mut headers = BTreeMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    if let Some(trace_id) = trace_id.map(str::trim).filter(|value| !value.is_empty()) {
        headers.insert("X-Trace-Id".to_string(), trace_id.to_string());
    }
    for (key, value) in json_object_to_string_map(&merged_headers) {
        headers.insert(key, value);
    }
    apply_auth_headers(
        &mut headers,
        Some(protocol.as_str()),
        auth_type.as_str(),
        &auth_config,
        secret,
    );

    Ok(PreparedProviderRequest {
        method: http_method,
        url: rendered_url,
        query_params: json_object_to_string_map(&query_params),
        headers,
        body: drop_none_fields(rendered_body),
        template_engine,
        response_decoder,
        response_transform,
        async_config,
    })
}

pub async fn send_prepared_json_request(
    client: &Client,
    prepared: &PreparedProviderRequest,
) -> Result<PreparedJsonResponse, String> {
    let method = Method::from_bytes(prepared.method.as_bytes()).unwrap_or(Method::POST);
    let mut request = client.request(method, prepared.url.as_str());
    if !prepared.query_params.is_empty() {
        request = request.query(&prepared.query_params);
    }
    for (key, value) in &prepared.headers {
        request = request.header(key, value);
    }
    let response = request
        .json(&prepared.body)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(key, value)| {
            value
                .to_str()
                .ok()
                .map(|text| (key.as_str().to_string(), text.to_string()))
        })
        .collect();
    let text = response.text().await.map_err(|err| err.to_string())?;
    let json = serde_json::from_str::<Value>(&text).ok();
    Ok(PreparedJsonResponse {
        status,
        headers,
        text,
        json,
    })
}

impl PreparedProviderRequest {
    pub fn display_url(&self) -> String {
        if self.query_params.is_empty() {
            return self.url.clone();
        }
        let Ok(mut url) = Url::parse(self.url.as_str()) else {
            return self.url.clone();
        };
        {
            let mut pairs = url.query_pairs_mut();
            for (key, value) in &self.query_params {
                pairs.append_pair(key, value);
            }
        }
        url.to_string()
    }
}

fn build_effective_config(
    preset: Option<&ProviderPreset>,
    model: &ProviderModel,
    capability: &str,
) -> Value {
    let capability_config = preset
        .and_then(|item| {
            item.protocol_profiles
                .as_object()
                .and_then(|profiles| profiles.get(capability))
                .and_then(protocol_profile_to_effective_config)
        })
        .unwrap_or_else(|| json!({}));

    let allow_override = model
        .routing_config
        .get("allow_template_override")
        .and_then(value_as_bool)
        .unwrap_or(false);
    if allow_override {
        deep_merge_json(&capability_config, &model.config_override)
    } else {
        capability_config
    }
}

fn protocol_profile_to_effective_config(profile: &Value) -> Option<Value> {
    let request = profile.get("request")?.as_object()?;
    let response = profile
        .get("response")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    let transport = profile
        .get("transport")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    let defaults = profile
        .get("defaults")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();

    let mut config = Map::new();
    if let Some(value) = request.get("template_engine") {
        config.insert("template_engine".to_string(), value.clone());
    }
    if let Some(value) = request.get("request_template") {
        config.insert("request_template".to_string(), value.clone());
    }
    if let Some(value) = request.get("request_builder") {
        config.insert(
            "request_builder".to_string(),
            runtime_hook_to_builder(value),
        );
    }
    if let Some(value) = response.get("response_template") {
        config.insert("response_transform".to_string(), value.clone());
    }
    if let Some(value) = transport.get("method") {
        config.insert("http_method".to_string(), value.clone());
    }
    if let Some(value) = defaults.get("headers") {
        config.insert("default_headers".to_string(), value.clone());
    }
    if let Some(value) = defaults.get("body") {
        config.insert("default_params".to_string(), value.clone());
    }
    Some(Value::Object(config))
}

fn runtime_hook_to_builder(value: &Value) -> Value {
    let Some(object) = value.as_object() else {
        return json!({});
    };
    let mut out = Map::new();
    if let Some(name) = object.get("name").and_then(|value| value.as_str()) {
        out.insert("type".to_string(), Value::String(name.to_string()));
    }
    if let Some(config) = object.get("config").and_then(|value| value.as_object()) {
        for (key, value) in config {
            out.insert(key.clone(), value.clone());
        }
    }
    Value::Object(out)
}

fn normalize_base_url(preset: Option<&ProviderPreset>, instance: &ProviderInstance) -> String {
    let mut base = if !instance.base_url.trim().is_empty() {
        instance.base_url.trim().to_string()
    } else {
        preset
            .map(|item| item.base_url.trim().to_string())
            .unwrap_or_default()
    };

    if let Some(template) = preset.and_then(|item| item.url_template.as_deref()) {
        let resource_name = instance
            .meta
            .get("resource_name")
            .and_then(value_as_string)
            .or_else(|| instance.meta.get("resource").and_then(value_as_string))
            .or_else(|| {
                instance
                    .meta
                    .get("deployment_name")
                    .and_then(value_as_string)
            });
        if template.contains("{resource}") {
            if let Some(resource_name) = resource_name {
                base = template.replace("{resource}", resource_name.as_str());
            }
        }
    }

    base.trim().trim_end_matches('/').to_string()
}

fn resolve_protocol(instance: &ProviderInstance, preset: Option<&ProviderPreset>) -> String {
    instance
        .meta
        .get("protocol")
        .and_then(value_as_string)
        .filter(|value| !value.is_empty())
        .or_else(|| preset.map(|item| item.provider.clone()))
        .unwrap_or_else(|| "openai".to_string())
        .trim()
        .to_ascii_lowercase()
}

pub fn deep_merge_json(base: &Value, override_value: &Value) -> Value {
    if let (Some(base_obj), Some(override_obj)) = (base.as_object(), override_value.as_object()) {
        let mut merged = base_obj.clone();
        for (key, value) in override_obj {
            if value.is_null() {
                merged.remove(key);
                continue;
            }
            if let Some(existing) = merged.get(key) {
                if existing.is_object() && value.is_object() {
                    merged.insert(key.clone(), deep_merge_json(existing, value));
                    continue;
                }
            }
            merged.insert(key.clone(), value.clone());
        }
        return Value::Object(merged);
    }

    if override_value.is_null() {
        return base.clone();
    }

    override_value.clone()
}

fn build_render_context(
    request_data: Map<String, Value>,
    provider: Option<&str>,
    capability: &str,
    model: &ProviderModel,
    canonical_request: &crate::modules::providers::protocols::CanonicalRequest,
) -> Value {
    let mut context = request_data.clone();
    let request_value = Value::Object(request_data.clone());
    let requested_model = request_data
        .get("model")
        .and_then(|value| value.as_str())
        .unwrap_or(model.model_id.as_str())
        .to_string();

    context.insert("request".to_string(), request_value.clone());
    context.insert("input".to_string(), request_value);
    context.insert("model".to_string(), Value::String(requested_model));
    context.insert(
        "provider".to_string(),
        Value::String(provider.unwrap_or("custom").to_string()),
    );
    context.insert(
        "capability".to_string(),
        Value::String(capability.to_string()),
    );
    context.insert(
        "item_config".to_string(),
        json!({
            "model_id": model.model_id,
            "unified_model_id": model.unified_model_id,
            "upstream_path": model.upstream_path,
            "capabilities": model.capabilities,
            "routing_config": model.routing_config,
            "config_override": model.config_override,
        }),
    );
    context.insert(
        "canonical_request".to_string(),
        serde_json::to_value(canonical_request).unwrap_or_else(|_| json!({})),
    );
    Value::Object(context)
}

fn render_body(
    request_template: &Value,
    default_params: &Value,
    request_builder: &Value,
    engine: &str,
    context: &Value,
    tools: Option<&Value>,
    hb: &Handlebars<'static>,
) -> Result<Value, String> {
    let effective_template = merge_request_template(default_params, request_template);
    let mut body = if matches!(engine, "jinja2" | "handlebars") {
        recursive_render(&effective_template, engine, context, hb)?
    } else {
        simple_merge_body(&effective_template, context)
    };
    body = apply_request_builder(request_builder, body, context);
    inject_tools(&mut body, tools, engine);
    Ok(body)
}

fn merge_request_template(default_params: &Value, request_template: &Value) -> Value {
    if let Some(request_object) = request_template.as_object() {
        let mut merged = default_params.as_object().cloned().unwrap_or_default();
        for (key, value) in request_object {
            merged.insert(key.clone(), value.clone());
        }
        return Value::Object(merged);
    }
    if !request_template.is_null() {
        return request_template.clone();
    }
    default_params.clone()
}

fn simple_merge_body(template: &Value, context: &Value) -> Value {
    let Some(template_object) = template.as_object() else {
        return context.clone();
    };

    let mut body = template_object.clone();
    let input = context.get("input").and_then(|value| value.as_object());
    let request = context.get("request").and_then(|value| value.as_object());

    for (key, template_value) in template_object {
        if !template_value.is_null() {
            continue;
        }

        let value = context
            .get("request")
            .and_then(|value| value.as_object())
            .and_then(|obj| obj.get(key).cloned())
            .or_else(|| input.and_then(|obj| obj.get(key).cloned()))
            .or_else(|| request.and_then(|obj| obj.get(key).cloned()));
        if let Some(value) = value {
            body.insert(key.clone(), value);
        }
    }

    Value::Object(body)
}

fn inject_tools(body: &mut Value, tools: Option<&Value>, engine: &str) {
    let Some(body_object) = body.as_object_mut() else {
        return;
    };
    let Some(tools_value) = tools else {
        return;
    };

    let raw_tools = extract_tool_definitions(tools_value);
    if raw_tools.is_empty() {
        return;
    }

    match engine {
        "anthropic_messages" => {
            if body_object.contains_key("tools") {
                return;
            }
            let items: Vec<Value> = raw_tools
                .iter()
                .map(|tool| {
                    if tool.get("name").is_some() && tool.get("input_schema").is_some() {
                        json!({
                            "name": tool.get("name").cloned().unwrap_or(Value::Null),
                            "description": tool.get("description").cloned().unwrap_or(Value::String(String::new())),
                            "input_schema": tool.get("input_schema").cloned().unwrap_or_else(|| json!({})),
                        })
                    } else {
                        tool.clone()
                    }
                })
                .collect();
            body_object.insert("tools".to_string(), Value::Array(items));
        }
        "google_gemini" => {
            if body_object.contains_key("tools") {
                return;
            }
            let declarations: Vec<Value> = raw_tools
                .iter()
                .map(|tool| {
                    json!({
                        "name": tool.get("name").cloned().unwrap_or(Value::Null),
                        "description": tool.get("description").cloned().unwrap_or(Value::String(String::new())),
                        "parameters": tool
                            .get("input_schema")
                            .cloned()
                            .or_else(|| tool.get("parameters").cloned())
                            .unwrap_or_else(|| json!({})),
                    })
                })
                .collect();
            body_object.insert(
                "tools".to_string(),
                Value::Array(vec![json!({ "function_declarations": declarations })]),
            );
        }
        "jinja2" | "handlebars" => {}
        _ => {
            if body_object.contains_key("tools") {
                return;
            }
            let items: Vec<Value> = raw_tools
                .iter()
                .map(|tool| {
                    if tool.get("type").and_then(|value| value.as_str()) == Some("function")
                        && tool.get("function").is_some()
                    {
                        tool.clone()
                    } else {
                        json!({
                            "type": "function",
                            "function": {
                                "name": tool.get("name").cloned().unwrap_or(Value::Null),
                                "description": tool.get("description").cloned().unwrap_or(Value::String(String::new())),
                                "parameters": tool
                                    .get("input_schema")
                                    .cloned()
                                    .or_else(|| tool.get("parameters").cloned())
                                    .unwrap_or_else(|| json!({})),
                            }
                        })
                    }
                })
                .collect();
            body_object.insert("tools".to_string(), Value::Array(items));
            body_object
                .entry("tool_choice".to_string())
                .or_insert_with(|| Value::String("auto".to_string()));
        }
    }
}

fn apply_request_builder(config: &Value, rendered_body: Value, context: &Value) -> Value {
    let Some(builder_type) = config.get("type").and_then(|value| value.as_str()) else {
        return rendered_body;
    };

    let input = context
        .get("input")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();

    match builder_type.trim() {
        "openai_chat_messages_from_canonical" => {
            openai_chat_messages_from_canonical_builder(rendered_body, context)
        }
        "anthropic_messages_from_canonical" => {
            anthropic_messages_from_canonical_builder(rendered_body, context)
        }
        "google_gemini_contents_from_canonical" => {
            google_gemini_contents_from_canonical_builder(rendered_body, context)
        }
        "ark_content_array" => ark_content_array_builder(&input, config),
        "responses_input_from_messages_or_items" => {
            responses_input_from_messages_or_items_builder(rendered_body, &input)
        }
        _ => rendered_body,
    }
}

fn openai_chat_messages_from_canonical_builder(rendered_body: Value, context: &Value) -> Value {
    let mut body = rendered_body.as_object().cloned().unwrap_or_default();
    let Some(messages) = context
        .get("canonical_request")
        .and_then(|value| value.get("messages"))
        .and_then(|value| value.as_array())
    else {
        return Value::Object(body);
    };

    let rendered_messages: Vec<Value> = messages
        .iter()
        .filter_map(render_openai_chat_message_from_canonical)
        .collect();
    if !rendered_messages.is_empty() {
        body.insert("messages".to_string(), Value::Array(rendered_messages));
    }

    Value::Object(body)
}

fn render_openai_chat_message_from_canonical(message: &Value) -> Option<Value> {
    let role = message.get("role").and_then(|value| value.as_str())?;
    let mut object = Map::new();
    object.insert("role".to_string(), Value::String(role.to_string()));

    if let Some(name) = message
        .get("name")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        object.insert("name".to_string(), Value::String(name.to_string()));
    }

    if let Some(content) = message.get("content").filter(|value| !value.is_null()) {
        object.insert("content".to_string(), content.clone());
    }

    if let Some(tool_calls) = message.get("tool_calls").and_then(|value| value.as_array()) {
        let rendered_tool_calls: Vec<Value> = tool_calls
            .iter()
            .filter_map(|call| {
                let name = call.get("name").and_then(|value| value.as_str())?;
                let arguments = call.get("arguments").cloned().unwrap_or_else(|| json!({}));
                let serialized_arguments = match arguments {
                    Value::String(text) => text,
                    other => serde_json::to_string(&other).ok()?,
                };
                Some(json!({
                    "id": call.get("id").and_then(|value| value.as_str()).unwrap_or_default(),
                    "type": call.get("type").and_then(|value| value.as_str()).unwrap_or("function"),
                    "function": {
                        "name": name,
                        "arguments": serialized_arguments,
                    }
                }))
            })
            .collect();
        if !rendered_tool_calls.is_empty() {
            object.insert("tool_calls".to_string(), Value::Array(rendered_tool_calls));
            object
                .entry("content".to_string())
                .or_insert_with(|| Value::String(String::new()));
        }
    }

    if let Some(tool_call_id) = message
        .get("tool_call_id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        object.insert(
            "tool_call_id".to_string(),
            Value::String(tool_call_id.to_string()),
        );
        object
            .entry("content".to_string())
            .or_insert_with(|| Value::String(String::new()));
    }

    Some(Value::Object(object))
}

fn anthropic_messages_from_canonical_builder(rendered_body: Value, context: &Value) -> Value {
    let mut body = rendered_body.as_object().cloned().unwrap_or_default();
    let Some(messages) = context
        .get("canonical_request")
        .and_then(|value| value.get("messages"))
        .and_then(|value| value.as_array())
    else {
        return Value::Object(body);
    };

    let system_text = messages
        .iter()
        .filter(|message| message.get("role").and_then(|value| value.as_str()) == Some("system"))
        .filter_map(|message| anthropic_text_from_content(message.get("content")))
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if !system_text.trim().is_empty() && !body.contains_key("system") {
        body.insert("system".to_string(), Value::String(system_text));
    }

    let mut rendered_messages = Vec::new();
    let mut pending_tool_results = Vec::new();
    for message in messages {
        let role = message
            .get("role")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if role == "system" {
            continue;
        }
        if role == "tool" {
            if let Some(block) = render_anthropic_tool_result_block(message) {
                pending_tool_results.push(block);
            }
            continue;
        }
        if !pending_tool_results.is_empty() {
            rendered_messages.push(json!({
                "role": "user",
                "content": Value::Array(std::mem::take(&mut pending_tool_results)),
            }));
        }
        if let Some(rendered) = render_anthropic_message_from_canonical(message) {
            rendered_messages.push(rendered);
        }
    }
    if !pending_tool_results.is_empty() {
        rendered_messages.push(json!({
            "role": "user",
            "content": Value::Array(pending_tool_results),
        }));
    }

    if !rendered_messages.is_empty() {
        body.insert("messages".to_string(), Value::Array(rendered_messages));
    }
    Value::Object(body)
}

fn render_anthropic_message_from_canonical(message: &Value) -> Option<Value> {
    let role = message.get("role").and_then(|value| value.as_str())?;
    let anthropic_role = match role {
        "assistant" => "assistant",
        _ => "user",
    };

    let mut content_blocks = Vec::new();
    if let Some(text) = anthropic_text_from_content(message.get("content")).filter(|value| !value.trim().is_empty()) {
        content_blocks.push(json!({ "type": "text", "text": text }));
    }
    if let Some(tool_calls) = message.get("tool_calls").and_then(|value| value.as_array()) {
        for call in tool_calls {
            let Some(name) = call.get("name").and_then(|value| value.as_str()) else {
                continue;
            };
            let input = call.get("arguments").cloned().unwrap_or_else(|| json!({}));
            content_blocks.push(json!({
                "type": "tool_use",
                "id": call.get("id").and_then(|value| value.as_str()).unwrap_or_default(),
                "name": name,
                "input": match input {
                    Value::String(text) => serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({ "raw": text })),
                    other => other,
                }
            }));
        }
    }

    if content_blocks.is_empty() {
        return None;
    }

    Some(json!({
        "role": anthropic_role,
        "content": Value::Array(content_blocks),
    }))
}

fn render_anthropic_tool_result_block(message: &Value) -> Option<Value> {
    let tool_use_id = message
        .get("tool_call_id")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())?;
    let content = anthropic_tool_result_content(message.get("content"))?;
    Some(json!({
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content,
    }))
}

fn anthropic_tool_result_content(content: Option<&Value>) -> Option<Value> {
    let content = content?;
    match content {
        Value::Null => Some(Value::String(String::new())),
        Value::String(text) => Some(Value::String(text.clone())),
        other => serde_json::to_string(other).ok().map(Value::String),
    }
}

fn anthropic_text_from_content(content: Option<&Value>) -> Option<String> {
    let content = content?;
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Null => None,
        other => serde_json::to_string(other).ok(),
    }
}

fn google_gemini_contents_from_canonical_builder(rendered_body: Value, context: &Value) -> Value {
    let mut body = rendered_body.as_object().cloned().unwrap_or_default();
    let Some(messages) = context
        .get("canonical_request")
        .and_then(|value| value.get("messages"))
        .and_then(|value| value.as_array())
    else {
        return Value::Object(body);
    };

    let system_text = messages
        .iter()
        .filter(|message| message.get("role").and_then(|value| value.as_str()) == Some("system"))
        .filter_map(|message| anthropic_text_from_content(message.get("content")))
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if !system_text.trim().is_empty() && !body.contains_key("system_instruction") {
        body.insert(
            "system_instruction".to_string(),
            json!({
                "parts": [{ "text": system_text }]
            }),
        );
    }

    let mut contents = Vec::new();
    for message in messages {
        let Some(rendered) = render_google_gemini_message_from_canonical(message) else {
            continue;
        };
        contents.push(rendered);
    }

    if !contents.is_empty() {
        body.insert("contents".to_string(), Value::Array(contents));
    }
    Value::Object(body)
}

fn render_google_gemini_message_from_canonical(message: &Value) -> Option<Value> {
    let role = message.get("role").and_then(|value| value.as_str())?;
    if role == "system" {
        return None;
    }

    let gemini_role = if role == "assistant" { "model" } else { "user" };
    let mut parts = Vec::new();

    if role == "tool" {
        let function_name = message
            .get("name")
            .and_then(|value| value.as_str())
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                message
                    .get("tool_call_id")
                    .and_then(|value| value.as_str())
                    .filter(|value| !value.trim().is_empty())
            })?;
        parts.push(json!({
            "functionResponse": {
                "name": function_name,
                "response": parse_gemini_tool_response_payload(message.get("content")),
            }
        }));
    } else {
        if let Some(text) = anthropic_text_from_content(message.get("content")).filter(|value| !value.trim().is_empty()) {
            parts.push(json!({ "text": text }));
        }
        if let Some(tool_calls) = message.get("tool_calls").and_then(|value| value.as_array()) {
            for call in tool_calls {
                let Some(name) = call.get("name").and_then(|value| value.as_str()) else {
                    continue;
                };
                let args = call.get("arguments").cloned().unwrap_or_else(|| json!({}));
                let thought_signature = call
                    .get("extra_content")
                    .and_then(|value| value.get("google"))
                    .and_then(|value| value.get("thought_signature"))
                    .cloned();
                let mut part = json!({
                    "functionCall": {
                        "name": name,
                        "args": match args {
                            Value::String(text) => serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({ "raw": text })),
                            other => other,
                        }
                    }
                });
                if let Some(signature) = thought_signature {
                    if !signature.is_null() {
                        if let Some(object) = part.as_object_mut() {
                            object.insert("thoughtSignature".to_string(), signature);
                        }
                    }
                }
                parts.push(part);
            }
        }
    }

    if parts.is_empty() {
        return None;
    }

    Some(json!({
        "role": gemini_role,
        "parts": parts,
    }))
}

fn parse_gemini_tool_response_payload(content: Option<&Value>) -> Value {
    let Some(content) = content else {
        return json!({});
    };
    match content {
        Value::Object(object) => Value::Object(object.clone()),
        Value::String(text) => serde_json::from_str::<Value>(text)
            .unwrap_or_else(|_| json!({ "content": text })),
        other => json!({ "content": other }),
    }
}

fn responses_input_from_messages_or_items_builder(
    rendered_body: Value,
    request_data: &Map<String, Value>,
) -> Value {
    let mut body = rendered_body.as_object().cloned().unwrap_or_default();

    if body.get("input").is_some_and(|value| !value.is_null()) {
        return Value::Object(body);
    }

    if let Some(input_value) = request_data.get("input") {
        body.insert("input".to_string(), input_value.clone());
        return Value::Object(body);
    }

    if let Some(items) = request_data
        .get("input_items")
        .and_then(|value| value.as_array())
    {
        let collected: Vec<Value> = items
            .iter()
            .filter_map(|item| {
                item.get("text").cloned().or_else(|| {
                    if item.is_object() {
                        Some(item.clone())
                    } else {
                        None
                    }
                })
            })
            .collect();
        if !collected.is_empty() {
            body.insert(
                "input".to_string(),
                if collected.len() == 1 {
                    collected[0].clone()
                } else {
                    Value::Array(collected)
                },
            );
            return Value::Object(body);
        }
    }

    if let Some(messages) = request_data
        .get("messages")
        .and_then(|value| value.as_array())
    {
        let parts: Vec<String> = messages
            .iter()
            .filter(|message| {
                message
                    .get("role")
                    .and_then(|value| value.as_str())
                    .map(|role| role != "system")
                    .unwrap_or(false)
            })
            .filter_map(|message| {
                message
                    .get("content")
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string())
            })
            .filter(|value| !value.trim().is_empty())
            .collect();
        if !parts.is_empty() {
            body.insert("input".to_string(), Value::String(parts.join("\n\n")));
        }
    }

    Value::Object(body)
}

fn ark_content_array_builder(request_data: &Map<String, Value>, config: &Value) -> Value {
    let mut prompt = request_data
        .get("prompt")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();

    if let Some(flags) = config
        .get("prompt_flags")
        .and_then(|value| value.as_object())
    {
        for (field_name, flag_value) in flags {
            let Some(flag) = flag_value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            let Some(raw_value) = request_data.get(field_name) else {
                continue;
            };
            if raw_value.is_null() {
                continue;
            }
            let rendered = render_scalar(raw_value);
            if rendered.trim().is_empty() {
                continue;
            }
            if !prompt.is_empty() {
                prompt.push(' ');
            }
            prompt.push_str(flag);
            prompt.push(' ');
            prompt.push_str(rendered.as_str());
        }
    }

    let mut content = vec![json!({
        "type": "text",
        "text": prompt,
    })];

    maybe_push_media_content(
        &mut content,
        config,
        request_data,
        "image_field",
        "image_url",
        "image_content_type",
        "image_url",
        "image_url",
    );
    maybe_push_media_content(
        &mut content,
        config,
        request_data,
        "audio_field",
        "audio_url",
        "audio_content_type",
        "audio_url",
        "audio_url",
    );
    maybe_push_media_content(
        &mut content,
        config,
        request_data,
        "video_field",
        "video_url",
        "video_content_type",
        "video_url",
        "video_url",
    );
    maybe_push_media_content(
        &mut content,
        config,
        request_data,
        "end_image_field",
        "end_image_url",
        "end_image_content_type",
        "end_image_url",
        "image_url",
    );

    json!({
        "model": request_data.get("model").cloned().unwrap_or(Value::Null),
        "content": content,
    })
}

fn maybe_push_media_content(
    content: &mut Vec<Value>,
    config: &Value,
    request_data: &Map<String, Value>,
    field_key: &str,
    field_default: &str,
    type_key: &str,
    type_default: &str,
    payload_key: &str,
) {
    let field_name = config
        .get(field_key)
        .and_then(|value| value.as_str())
        .unwrap_or(field_default);
    let Some(url) = request_data
        .get(field_name)
        .and_then(|value| value.as_str())
    else {
        return;
    };
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return;
    }

    let content_type = config
        .get(type_key)
        .and_then(|value| value.as_str())
        .unwrap_or(type_default);
    content.push(json!({
        "type": content_type,
        payload_key: {
            "url": trimmed,
        }
    }));
}

fn extract_tool_definitions(value: &Value) -> Vec<Value> {
    if let Some(array) = value.get("tools").and_then(|item| item.as_array()) {
        return array.clone();
    }
    if let Some(array) = value.as_array() {
        return array.clone();
    }
    vec![]
}

fn recursive_render(
    value: &Value,
    engine: &str,
    context: &Value,
    hb: &Handlebars<'static>,
) -> Result<Value, String> {
    match value {
        Value::String(text) => {
            let rendered = render_string(text, engine, context, hb)?;
            let trimmed = rendered.trim();
            if (trimmed.starts_with('{') && trimmed.ends_with('}'))
                || (trimmed.starts_with('[') && trimmed.ends_with(']'))
            {
                if let Ok(parsed) = serde_json::from_str::<Value>(&rendered) {
                    return Ok(parsed);
                }
            }
            Ok(Value::String(rendered))
        }
        Value::Object(map) => {
            let mut rendered = Map::new();
            for (key, item) in map {
                rendered.insert(key.clone(), recursive_render(item, engine, context, hb)?);
            }
            Ok(Value::Object(rendered))
        }
        Value::Array(items) => {
            let mut rendered = Vec::with_capacity(items.len());
            for item in items {
                rendered.push(recursive_render(item, engine, context, hb)?);
            }
            Ok(Value::Array(rendered))
        }
        _ => Ok(value.clone()),
    }
}

fn render_string(
    template: &str,
    engine: &str,
    context: &Value,
    hb: &Handlebars<'static>,
) -> Result<String, String> {
    if matches!(engine, "jinja2" | "handlebars") {
        if template.contains("{{") {
            return hb
                .render_template(template, context)
                .map_err(|err| err.to_string());
        }
        return Ok(template.to_string());
    }

    let rendered = replace_delimited(template, "${", "}", context, true);
    Ok(replace_delimited(
        rendered.as_str(),
        "{{",
        "}}",
        context,
        true,
    ))
}

fn replace_delimited(
    template: &str,
    start_delim: &str,
    end_delim: &str,
    context: &Value,
    keep_unresolved: bool,
) -> String {
    let mut output = String::new();
    let mut rest = template;

    while let Some(start_idx) = rest.find(start_delim) {
        output.push_str(&rest[..start_idx]);
        let token_start = start_idx + start_delim.len();
        let after_start = &rest[token_start..];
        let Some(end_idx) = after_start.find(end_delim) else {
            output.push_str(&rest[start_idx..]);
            return output;
        };

        let raw_key = after_start[..end_idx].trim();
        let replacement = extract_path(context, raw_key)
            .map(render_scalar)
            .or_else(|| {
                if keep_unresolved {
                    Some(format!("{}{}{}", start_delim, raw_key, end_delim))
                } else {
                    None
                }
            })
            .unwrap_or_default();
        output.push_str(replacement.as_str());
        rest = &after_start[end_idx + end_delim.len()..];
    }

    output.push_str(rest);
    output
}

fn extract_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    if path.is_empty() {
        return Some(value);
    }

    let mut current = value;
    for part in path.split('.') {
        if let Some(array) = current.as_array() {
            let Ok(index) = part.parse::<usize>() else {
                return None;
            };
            current = array.get(index)?;
            continue;
        }

        let object = current.as_object()?;
        current = object.get(part)?;
    }

    Some(current)
}

fn render_scalar(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(item) => item.clone(),
        Value::Bool(item) => item.to_string(),
        Value::Number(item) => item.to_string(),
        _ => value.to_string(),
    }
}

fn resolve_auth_for_protocol(
    protocol: Option<&str>,
    provider: Option<&str>,
    auth_type: Option<&str>,
    auth_config: Option<&Value>,
    default_headers: Option<&Value>,
) -> (String, Value, Value) {
    let mut resolved_auth_type = auth_type.unwrap_or("bearer").to_string();
    let mut resolved_auth_config = auth_config.cloned().unwrap_or_else(|| json!({}));
    let mut resolved_headers = default_headers.cloned().unwrap_or_else(|| json!({}));

    let proto = protocol.unwrap_or("").trim().to_ascii_lowercase();
    let provider_lower = provider.unwrap_or("").trim().to_ascii_lowercase();
    if provider_lower != "custom" || proto.is_empty() {
        return (resolved_auth_type, resolved_auth_config, resolved_headers);
    }

    if !resolved_headers.is_object() {
        resolved_headers = json!({});
    }
    if !resolved_auth_config.is_object() {
        resolved_auth_config = json!({});
    }

    if proto.contains("anthropic") || proto.contains("claude") {
        resolved_auth_type = "api_key".to_string();
        if let Some(config) = resolved_auth_config.as_object_mut() {
            config.insert("header".to_string(), Value::String("x-api-key".to_string()));
        }
        if let Some(headers) = resolved_headers.as_object_mut() {
            headers
                .entry("anthropic-version".to_string())
                .or_insert_with(|| Value::String("2023-06-01".to_string()));
        }
    } else if proto.contains("azure") {
        resolved_auth_type = "api_key".to_string();
        if let Some(config) = resolved_auth_config.as_object_mut() {
            config.insert("header".to_string(), Value::String("api-key".to_string()));
        }
    } else if proto.contains("gemini") || proto.contains("google") || proto.contains("vertex") {
        resolved_auth_type = "api_key".to_string();
        if let Some(config) = resolved_auth_config.as_object_mut() {
            config.insert(
                "header".to_string(),
                Value::String("x-goog-api-key".to_string()),
            );
        }
    } else {
        resolved_auth_type = "bearer".to_string();
    }

    (resolved_auth_type, resolved_auth_config, resolved_headers)
}

fn apply_auth_headers(
    headers: &mut BTreeMap<String, String>,
    protocol: Option<&str>,
    auth_type: &str,
    auth_config: &Value,
    secret: Option<&str>,
) {
    let Some(secret) = secret.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };

    let proto = protocol.unwrap_or("").trim().to_ascii_lowercase();
    let auth_kind = auth_type.trim().to_ascii_lowercase();
    if auth_kind == "none" {
        return;
    }

    if auth_kind == "api_key" {
        let header_name = auth_config
            .get("header")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| {
                if proto.contains("azure") {
                    "api-key".to_string()
                } else if proto.contains("gemini")
                    || proto.contains("google")
                    || proto.contains("vertex")
                {
                    "x-goog-api-key".to_string()
                } else if proto.contains("anthropic") || proto.contains("claude") {
                    "x-api-key".to_string()
                } else {
                    "x-api-key".to_string()
                }
            });
        headers.insert(header_name, secret.to_string());
        if proto.contains("anthropic") || proto.contains("claude") {
            headers
                .entry("anthropic-version".to_string())
                .or_insert_with(|| "2023-06-01".to_string());
        }
        return;
    }

    headers.insert("Authorization".to_string(), format!("Bearer {secret}"));
}

pub fn build_upstream_url_with_params(
    base_url: &str,
    upstream_path: &str,
    protocol: Option<&str>,
    auto_append_v1: Option<bool>,
    api_version: Option<&str>,
) -> (String, Value) {
    let mut params = Map::new();
    let mut base = base_url.trim().trim_end_matches('/').to_string();
    let mut path = upstream_path.trim().trim_start_matches('/').to_string();
    let protocol = protocol.unwrap_or("openai").trim().to_ascii_lowercase();

    if protocol.contains("azure") {
        let version = api_version.unwrap_or("2023-05-15").trim();
        params.insert(
            "api-version".to_string(),
            Value::String(version.to_string()),
        );
    } else if (protocol.contains("openai") || protocol.contains("responses"))
        && !protocol.contains("azure")
    {
        let append_v1 = auto_append_v1.unwrap_or_else(|| !has_versioned_path(base.as_str()));
        if append_v1 && !base.ends_with("/v1") {
            base = format!("{base}/v1");
        }
    }

    if base.ends_with("/v1") {
        if let Some((head, tail)) = path.split_once('/') {
            if head.eq_ignore_ascii_case("v1") {
                path = tail.to_string();
            }
        } else if path.eq_ignore_ascii_case("v1") {
            path.clear();
        }
    }

    let url = if path.is_empty() {
        base
    } else {
        format!("{base}/{path}")
    };
    (url, Value::Object(params))
}

fn build_handlebars() -> Handlebars<'static> {
    let mut hb = Handlebars::new();
    hb.set_strict_mode(false);
    hb
}

fn json_object_to_string_map(value: &Value) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let Some(object) = value.as_object() else {
        return out;
    };
    for (key, value) in object {
        out.insert(key.clone(), render_scalar(value));
    }
    out
}

fn drop_none_fields(payload: Value) -> Value {
    match payload {
        Value::Object(map) => {
            let filtered = map
                .into_iter()
                .filter(|(_, value)| !value.is_null())
                .collect::<Map<String, Value>>();
            Value::Object(filtered)
        }
        _ => payload,
    }
}

fn value_as_bool(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(item) => Some(*item),
        Value::String(item) => match item.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => Some(true),
            "false" | "0" | "no" | "off" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn value_as_string(value: &Value) -> Option<String> {
    match value {
        Value::String(item) => Some(item.trim().to_string()),
        Value::Number(item) => Some(item.to_string()),
        Value::Bool(item) => Some(item.to_string()),
        _ => None,
    }
    .filter(|value| !value.is_empty())
}

fn has_versioned_path(base_url: &str) -> bool {
    let without_query = base_url.split('?').next().unwrap_or(base_url);
    let path = if let Some((_, rest)) = without_query.split_once("://") {
        if let Some(path_idx) = rest.find('/') {
            &rest[path_idx + 1..]
        } else {
            ""
        }
    } else {
        without_query.trim_start_matches('/')
    };

    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    for (idx, segment) in segments.iter().enumerate() {
        if is_version_segment(segment) {
            return true;
        }
        if segment.eq_ignore_ascii_case("api")
            && segments
                .get(idx + 1)
                .map(|next| is_version_segment(next))
                .unwrap_or(false)
        {
            return true;
        }
    }
    false
}

fn is_version_segment(segment: &str) -> bool {
    let normalized = segment.trim();
    if normalized.len() < 2 {
        return false;
    }
    let mut chars = normalized.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if first != 'v' && first != 'V' {
        return false;
    }
    chars.all(|ch| ch.is_ascii_digit() || ch == '.')
}

#[cfg(test)]
mod tests {
    use super::{
        apply_request_builder, build_effective_config, build_upstream_url_with_params,
        deep_merge_json, prepare_provider_request, resolve_auth_for_protocol,
    };
    use crate::modules::providers::types::{ProviderInstance, ProviderModel, ProviderPreset};
    use serde_json::{json, Value};
    use uuid::Uuid;

    fn mock_instance(meta: Value) -> ProviderInstance {
        ProviderInstance {
            id: Uuid::new_v4(),
            preset_slug: "openai".to_string(),
            name: "OpenAI".to_string(),
            base_url: "https://api.openai.com".to_string(),
            description: None,
            icon: None,
            priority: 0,
            meta,
            is_enabled: true,
            is_local: true,
            credential_source: "local".to_string(),
            credentials_ref: "cred".to_string(),
            updated_at: "2026-03-06T00:00:00Z".to_string(),
            created_at: "2026-03-06T00:00:00Z".to_string(),
        }
    }

    fn mock_model(capabilities: &[&str]) -> ProviderModel {
        ProviderModel {
            id: Uuid::new_v4(),
            instance_id: Uuid::new_v4(),
            model_id: "gpt-4o-mini".to_string(),
            unified_model_id: None,
            display_name: None,
            capabilities: capabilities.iter().map(|item| item.to_string()).collect(),
            upstream_path: "v1/chat/completions".to_string(),
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
            category: Some("Cloud API".to_string()),
            url_template: None,
            auth_type: "bearer".to_string(),
            auth_config: json!({}),
            protocol_schema_version: None,
            protocol_profiles: json!({
                "chat": {
                    "runtime_version": "v2",
                    "schema_version": "2026-03-07",
                    "profile_id": "openai:chat:openai_chat",
                    "provider": "openai",
                    "protocol_family": "openai_chat",
                    "capability": "chat",
                    "transport": {
                        "method": "POST",
                        "path": "v1/chat/completions",
                        "query_template": {},
                        "header_template": {}
                    },
                    "request": {
                        "template_engine": "simple_replace",
                        "request_template": {
                            "model": null,
                            "messages": null,
                            "stream": null,
                            "temperature": null,
                            "max_tokens": null
                        }
                    },
                    "response": {
                        "decoder": { "name": "openai_chat", "config": {} },
                        "response_template": {}
                    },
                    "stream": {
                        "stream_decoder": { "name": "openai_chat_events", "config": {} }
                    },
                    "auth": { "auth_policy": "inherit", "config": {} },
                    "features": {
                        "supports_messages": true,
                        "supports_input_items": false
                    },
                    "defaults": {
                        "headers": { "X-Source": "desktop" },
                        "query": {},
                        "body": {}
                    }
                }
            }),
            version: 1,
            is_active: true,
        }
    }

    #[test]
    fn deep_merge_json_merges_nested_objects() {
        let merged = deep_merge_json(
            &json!({ "headers": { "a": 1, "b": 2 }, "x": 1 }),
            &json!({ "headers": { "b": 3, "c": 4 } }),
        );
        assert_eq!(merged["headers"]["a"], json!(1));
        assert_eq!(merged["headers"]["b"], json!(3));
        assert_eq!(merged["headers"]["c"], json!(4));
    }

    #[test]
    fn resolve_auth_for_protocol_handles_custom_anthropic() {
        let (auth_type, auth_config, headers) = resolve_auth_for_protocol(
            Some("anthropic"),
            Some("custom"),
            Some("bearer"),
            Some(&json!({})),
            Some(&json!({})),
        );
        assert_eq!(auth_type, "api_key");
        assert_eq!(auth_config["header"], json!("x-api-key"));
        assert_eq!(headers["anthropic-version"], json!("2023-06-01"));
    }

    #[test]
    fn build_upstream_url_with_params_adds_azure_api_version() {
        let (url, params) = build_upstream_url_with_params(
            "https://example.openai.azure.com",
            "openai/deployments/foo/chat/completions",
            Some("azure_openai"),
            Some(false),
            Some("2024-02-01"),
        );
        assert_eq!(
            url,
            "https://example.openai.azure.com/openai/deployments/foo/chat/completions"
        );
        assert_eq!(params["api-version"], json!("2024-02-01"));
    }

    #[test]
    fn prepare_provider_request_uses_capability_template() {
        let preset = mock_preset();
        let instance = mock_instance(json!({ "protocol": "openai", "auto_append_v1": true }));
        let model = mock_model(&["chat"]);
        let prepared = prepare_provider_request(
            Some(&preset),
            &instance,
            &model,
            Some("sk-test"),
            "chat",
            json!({
                "model": "gpt-4o-mini",
                "messages": [{ "role": "user", "content": "hi" }],
                "stream": false,
                "temperature": 0.2,
                "max_tokens": 64
            }),
            None,
            Some("trace-1"),
        )
        .expect("prepare request");

        assert_eq!(prepared.url, "https://api.openai.com/v1/chat/completions");
        assert_eq!(
            prepared.headers.get("X-Source"),
            Some(&"desktop".to_string())
        );
        assert_eq!(prepared.body["model"], json!("gpt-4o-mini"));
        assert_eq!(prepared.body["max_tokens"], json!(64));
    }

    #[test]
    fn prepare_provider_request_uses_preset_template_fields_only() {
        let preset = mock_preset();
        let instance = mock_instance(json!({ "protocol": "openai", "auto_append_v1": true }));
        let model = mock_model(&["chat"]);

        let prepared = prepare_provider_request(
            Some(&preset),
            &instance,
            &model,
            Some("sk-test"),
            "chat",
            json!({
                "model": "gpt-4o-mini",
                "messages": [{ "role": "user", "content": "hi" }],
                "stream": false,
            }),
            None,
            None,
        )
        .expect("prepare request");

        assert_eq!(prepared.template_engine, "simple_replace");
        assert_eq!(prepared.response_transform, json!({}));
    }

    #[test]
    fn prepare_provider_request_injects_wrapped_tools_payload() {
        let preset = mock_preset();
        let instance = mock_instance(json!({ "protocol": "openai", "auto_append_v1": true }));
        let model = mock_model(&["chat"]);

        let prepared = prepare_provider_request(
            Some(&preset),
            &instance,
            &model,
            Some("sk-test"),
            "chat",
            json!({
                "model": "gpt-4o-mini",
                "messages": [{ "role": "user", "content": "hi" }],
                "stream": false,
            }),
            Some(&json!({
                "tools": [
                    {
                        "type": "function",
                        "function": {
                            "name": "search_sdk",
                            "description": "Search SDK signatures",
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "query": { "type": "string" }
                                },
                                "required": ["query"]
                            }
                        }
                    }
                ]
            })),
            None,
        )
        .expect("prepare request with wrapped tools");

        assert_eq!(
            prepared.body["tools"][0]["function"]["name"],
            json!("search_sdk")
        );
        assert_eq!(prepared.body["tool_choice"], json!("auto"));
    }

    #[test]
    fn prepare_provider_request_responses_family_builds_input_from_messages() {
        let mut preset = mock_preset();
        preset.provider = "openai".to_string();
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
                    "request_template": {
                        "model": null,
                        "input": null,
                        "stream": null
                    },
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
                    "stream_decoder": { "name": "openai_responses_events", "config": {} }
                },
                "auth": { "auth_policy": "inherit", "config": {} },
                "features": {
                    "supports_messages": false,
                    "supports_input_items": true
                },
                "defaults": {
                    "headers": { "X-Source": "desktop" },
                    "query": {},
                    "body": {}
                }
            }
        });
        let instance = mock_instance(json!({ "protocol": "responses", "auto_append_v1": true }));
        let mut model = mock_model(&["chat"]);
        model.upstream_path = "responses".to_string();

        let prepared = prepare_provider_request(
            Some(&preset),
            &instance,
            &model,
            Some("sk-test"),
            "chat",
            json!({
                "model": "gpt-5.3-codex",
                "messages": [{ "role": "user", "content": "hello responses" }],
                "stream": false,
            }),
            None,
            None,
        )
        .expect("prepare responses request");

        assert_eq!(prepared.url, "https://api.openai.com/v1/responses");
        assert_eq!(prepared.body["model"], json!("gpt-5.3-codex"));
        assert_eq!(prepared.body["input"], json!("hello responses"));
        assert!(prepared.body.get("messages").is_none());
    }

    #[test]
    fn prepare_provider_request_openai_chat_renders_structured_tool_replay_messages() {
        let preset = mock_preset();
        let instance = mock_instance(json!({ "protocol": "openai", "auto_append_v1": true }));
        let model = mock_model(&["chat"]);

        let prepared = prepare_provider_request(
            Some(&preset),
            &instance,
            &model,
            Some("sk-test"),
            "chat",
            json!({
                "model": "gpt-4o-mini",
                "messages": [
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "call_123",
                                "name": "search_sdk",
                                "arguments": { "query": "tool replay" }
                            }
                        ]
                    },
                    {
                        "role": "tool",
                        "tool_call_id": "call_123",
                        "content": "{\"status\":\"ok\"}"
                    }
                ],
                "stream": false
            }),
            None,
            None,
        )
        .expect("prepare request with structured tool replay");

        assert_eq!(
            prepared.body["messages"],
            json!([
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call_123",
                            "type": "function",
                            "function": {
                                "name": "search_sdk",
                                "arguments": "{\"query\":\"tool replay\"}"
                            }
                        }
                    ]
                },
                {
                    "role": "tool",
                    "tool_call_id": "call_123",
                    "content": "{\"status\":\"ok\"}"
                }
            ])
        );
    }

    #[test]
    fn prepare_provider_request_anthropic_renders_tool_use_and_tool_result_blocks() {
        let mut preset = mock_preset();
        preset.provider = "anthropic".to_string();
        preset.protocol_profiles = json!({
            "chat": {
                "runtime_version": "v2",
                "schema_version": "2026-03-07",
                "profile_id": "anthropic:chat:anthropic_messages",
                "provider": "anthropic",
                "protocol_family": "anthropic_messages",
                "capability": "chat",
                "transport": {
                    "method": "POST",
                    "path": "v1/messages",
                    "query_template": {},
                    "header_template": {}
                },
                "request": {
                    "template_engine": "anthropic_messages",
                    "request_template": {
                        "model": null,
                        "messages": null
                    }
                },
                "response": {
                    "decoder": { "name": "anthropic_messages", "config": {} },
                    "response_template": {}
                },
                "stream": {
                    "stream_decoder": { "name": "anthropic_messages_events", "config": {} }
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
        let instance = mock_instance(json!({ "protocol": "anthropic", "auto_append_v1": false }));
        let mut model = mock_model(&["chat"]);
        model.upstream_path = "v1/messages".to_string();

        let prepared = prepare_provider_request(
            Some(&preset),
            &instance,
            &model,
            Some("sk-test"),
            "chat",
            json!({
                "model": "claude-sonnet",
                "messages": [
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "call_123",
                                "name": "search_sdk",
                                "arguments": { "query": "tool replay" }
                            }
                        ]
                    },
                    {
                        "role": "tool",
                        "tool_call_id": "call_123",
                        "content": "{\"status\":\"ok\"}"
                    }
                ],
                "stream": false
            }),
            None,
            None,
        )
        .expect("prepare anthropic request with structured tool replay");

        assert_eq!(
            prepared.body["messages"],
            json!([
                {
                    "role": "assistant",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "call_123",
                            "name": "search_sdk",
                            "input": { "query": "tool replay" }
                        }
                    ]
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": "call_123",
                            "content": "{\"status\":\"ok\"}"
                        }
                    ]
                }
            ])
        );
    }

    #[test]
    fn prepare_provider_request_google_gemini_builds_contents_from_messages() {
        let mut preset = mock_preset();
        preset.provider = "google".to_string();
        preset.protocol_profiles = json!({
            "chat": {
                "runtime_version": "v2",
                "schema_version": "2026-03-07",
                "profile_id": "google:chat:google_gemini",
                "provider": "google",
                "protocol_family": "google_gemini",
                "capability": "chat",
                "transport": {
                    "method": "POST",
                    "path": "v1beta/models/gemini:generateContent",
                    "query_template": {},
                    "header_template": {}
                },
                "request": {
                    "template_engine": "google_gemini",
                    "request_template": {
                        "model": null,
                        "contents": null
                    }
                },
                "response": {
                    "decoder": { "name": "google_gemini", "config": {} },
                    "response_template": {}
                },
                "stream": {
                    "stream_decoder": { "name": "openai_chat_events", "config": {} }
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
        let instance = mock_instance(json!({ "protocol": "google", "auto_append_v1": false }));
        let mut model = mock_model(&["chat"]);
        model.upstream_path = "v1beta/models/gemini:generateContent".to_string();

        let prepared = prepare_provider_request(
            Some(&preset),
            &instance,
            &model,
            Some("sk-test"),
            "chat",
            json!({
                "model": "gemini-2.5-pro",
                "messages": [
                    { "role": "system", "content": "be concise" },
                    { "role": "user", "content": "hello gemini" }
                ],
                "stream": false
            }),
            None,
            None,
        )
        .expect("prepare gemini request");

        assert_eq!(
            prepared.body["system_instruction"],
            json!({ "parts": [{ "text": "be concise" }] })
        );
        assert_eq!(
            prepared.body["contents"],
            json!([
                {
                    "role": "user",
                    "parts": [{ "text": "hello gemini" }]
                }
            ])
        );
    }

    #[test]
    fn build_effective_config_prefers_protocol_profiles_when_present() {
        let mut preset = mock_preset();
        preset.protocol_profiles = json!({
            "chat": {
                "request": {
                    "template_engine": "openai_compat",
                    "request_template": { "model": null, "input": null },
                    "request_builder": {
                        "name": "responses_input_from_messages_or_items",
                        "config": {}
                    }
                },
                "response": {
                    "response_template": { "mode": "responses" }
                },
                "transport": { "method": "POST" },
                "defaults": {
                    "headers": { "X-Protocol": "v2" },
                    "body": { "temperature": 0.3 }
                }
            }
        });
        let mut model = mock_model(&["chat"]);
        model.upstream_path = "responses".to_string();

        let effective = build_effective_config(Some(&preset), &model, "chat");

        assert_eq!(effective["template_engine"], json!("openai_compat"));
        assert_eq!(
            effective["request_template"],
            json!({"model": null, "input": null})
        );
        assert_eq!(
            effective["request_builder"]["type"],
            json!("responses_input_from_messages_or_items")
        );
        assert_eq!(effective["default_headers"]["X-Protocol"], json!("v2"));
        assert_eq!(effective["default_params"]["temperature"], json!(0.3));
    }

    #[test]
    fn apply_request_builder_without_type_keeps_rendered_body() {
        let body = json!({ "prompt": "hello" });
        let context = json!({ "input": { "prompt": "hello" } });

        let result = apply_request_builder(&json!({}), body.clone(), &context);

        assert_eq!(result, body);
    }

    #[test]
    fn apply_request_builder_supports_ark_content_array() {
        let result = apply_request_builder(
            &json!({
                "type": "ark_content_array",
                "prompt_flags": {
                    "aspect_ratio": "--ratio",
                    "duration": "--dur"
                }
            }),
            json!({}),
            &json!({
                "input": {
                    "model": "doubao-seedance-1-5-pro-251215",
                    "prompt": "一只猫在草地上奔跑",
                    "aspect_ratio": "16:9",
                    "duration": 5,
                    "image_url": "https://example.com/input.png"
                }
            }),
        );

        assert_eq!(result["model"], json!("doubao-seedance-1-5-pro-251215"));
        assert_eq!(result["content"][0]["type"], json!("text"));
        assert_eq!(
            result["content"][0]["text"],
            json!("一只猫在草地上奔跑 --ratio 16:9 --dur 5")
        );
        assert_eq!(result["content"][1]["type"], json!("image_url"));
        assert_eq!(
            result["content"][1]["image_url"]["url"],
            json!("https://example.com/input.png")
        );
    }
}
