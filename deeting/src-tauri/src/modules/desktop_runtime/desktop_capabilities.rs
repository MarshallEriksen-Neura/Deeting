use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::time::Instant;

use crate::modules::monitor::types::{LocalMonitorListQuery, LocalMonitorTaskCreateRequest};
use crate::modules::providers::protocols::build_canonical_request_from_value;
use crate::modules::providers::types::{
    ProviderInstance, ProviderModel, ProviderPreset, ProviderVerifyRequest,
};
use chrono::Utc;
use mcp_session::assistant::CreateLocalAssistantRequest;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopCapabilityKind {
    DirectCapability,
    SystemAction,
}

#[derive(Debug, Clone, Copy)]
pub struct DesktopOfficialSkillCapabilitySpec {
    pub id: &'static str,
    pub kind: DesktopCapabilityKind,
    pub callable_from_official_skill: bool,
    pub admin_only: bool,
}

const OFFICIAL_SKILL_CAPABILITIES: &[DesktopOfficialSkillCapabilitySpec] = &[
    DesktopOfficialSkillCapabilitySpec {
        id: "skill_registry.refresh",
        kind: DesktopCapabilityKind::SystemAction,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "skill_registry.diagnostics",
        kind: DesktopCapabilityKind::SystemAction,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "monitor.create",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "monitor.list",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "provider_preset.list",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "provider_preset.upsert",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "provider.verify",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "provider.template.verify",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "web.fetch",
        kind: DesktopCapabilityKind::DirectCapability,
        callable_from_official_skill: true,
        admin_only: false,
    },
    DesktopOfficialSkillCapabilitySpec {
        id: "assistant.onboarding.submit",
        kind: DesktopCapabilityKind::SystemAction,
        callable_from_official_skill: true,
        admin_only: false,
    },
];

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct DesktopCurrentUserInfo {
    pub(crate) is_superuser: bool,
    #[serde(default)]
    pub(crate) permission_flags: HashMap<String, i64>,
}

pub fn find_official_skill_capability(
    capability_id: &str,
) -> Option<&'static DesktopOfficialSkillCapabilitySpec> {
    let normalized = capability_id.trim();
    OFFICIAL_SKILL_CAPABILITIES
        .iter()
        .find(|spec| spec.id == normalized)
}

pub async fn dispatch_official_skill_capability(
    capability_id: &str,
    arguments: &Value,
) -> Result<Option<Value>, String> {
    let Some(spec) = find_official_skill_capability(capability_id) else {
        return Ok(None);
    };

    if !spec.callable_from_official_skill {
        return Err(format!(
            "desktop capability '{}' is not callable from official skills",
            spec.id
        ));
    }
    if spec.admin_only {
        ensure_desktop_admin_role(spec.id).await?;
    }

    match spec.id {
        "skill_registry.refresh" => dispatch_skill_registry_refresh(arguments).await.map(Some),
        "skill_registry.diagnostics" => dispatch_skill_registry_diagnostics().await.map(Some),
        "monitor.create" => dispatch_monitor_create(arguments).await.map(Some),
        "monitor.list" => dispatch_monitor_list(arguments).await.map(Some),
        "provider_preset.list" => dispatch_provider_preset_list().await.map(Some),
        "provider_preset.upsert" => dispatch_provider_preset_upsert(arguments).await.map(Some),
        "provider.verify" => dispatch_provider_verify(arguments).await.map(Some),
        "provider.template.verify" => dispatch_provider_template_verify(arguments).await.map(Some),
        "web.fetch" => dispatch_web_fetch(arguments).await.map(Some),
        "assistant.onboarding.submit" => dispatch_assistant_onboarding_submit(arguments)
            .await
            .map(Some),
        _ => Ok(None),
    }
}

fn global_app_state_required() -> Result<crate::state::AppState, String> {
    crate::state::global_app_state().ok_or_else(|| "global app state is unavailable".to_string())
}

fn global_app_handle_required() -> Result<tauri::AppHandle, String> {
    crate::state::global_app_handle().ok_or_else(|| "global app handle is unavailable".to_string())
}

fn parse_provider_preset(arguments: &Value) -> Result<ProviderPreset, String> {
    let payload = arguments
        .get("preset")
        .cloned()
        .unwrap_or_else(|| arguments.clone());
    serde_json::from_value(payload).map_err(|err| err.to_string())
}

async fn desktop_cloud_base_url(app_state: &crate::state::AppState) -> Result<String, String> {
    let base_url = app_state.mcp.transport.cloud_base_url.read().await.clone();
    let normalized = base_url.trim().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        Err("cloud API base URL not configured".to_string())
    } else {
        Ok(normalized)
    }
}

async fn desktop_auth_token(app_state: &crate::state::AppState) -> Result<String, String> {
    let token = app_state
        .mcp
        .store
        .get_desktop_config("auth.token")
        .await
        .map_err(|err| err.to_string())?
        .unwrap_or_default();
    let normalized = token.trim().to_string();
    if normalized.is_empty() {
        Err("desktop auth token is missing".to_string())
    } else {
        Ok(normalized)
    }
}

pub(crate) async fn desktop_current_user_info_optional() -> Option<DesktopCurrentUserInfo> {
    desktop_current_user_info().await.ok()
}

pub(crate) fn desktop_user_can_access_restricted_asset(
    user: Option<&DesktopCurrentUserInfo>,
    restricted: bool,
    allowed_roles: &[String],
    _id_hint: Option<&str>,
) -> bool {
    if !restricted {
        return true;
    }
    let Some(current_user) = user else {
        return false;
    };
    if current_user.is_superuser {
        return true;
    }

    let allowed = allowed_roles
        .iter()
        .map(|item| item.trim().to_ascii_lowercase())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    if allowed.iter().any(|role| role == "admin") {
        return current_user
            .permission_flags
            .iter()
            .any(|(key, value)| key.starts_with("can_") && *value > 0);
    }

    false
}

async fn desktop_current_user_info() -> Result<DesktopCurrentUserInfo, String> {
    let app_state = global_app_state_required()?;
    let base_url = desktop_cloud_base_url(&app_state).await?;
    let token = desktop_auth_token(&app_state).await?;
    let response = reqwest::Client::new()
        .get(format!("{}/api/v1/users/me", base_url))
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("users/me returned {}", response.status().as_u16()));
    }
    response
        .json::<DesktopCurrentUserInfo>()
        .await
        .map_err(|err| err.to_string())
}

async fn ensure_desktop_admin_role(capability_id: &str) -> Result<(), String> {
    let current_user = desktop_current_user_info().await?;
    let allowed = current_user.is_superuser;
    if allowed {
        Ok(())
    } else {
        Err(format!(
            "desktop capability '{}' requires an administrator account",
            capability_id
        ))
    }
}

async fn dispatch_skill_registry_refresh(arguments: &Value) -> Result<Value, String> {
    let app_handle = global_app_handle_required()?;
    let app_state = global_app_state_required()?;
    let count =
        crate::modules::skills::commands::register_local_skills_inner(app_handle, &app_state)
            .await?;
    Ok(json!({
        "status": "ok",
        "registered": count,
        "arguments": arguments,
    }))
}

async fn dispatch_skill_registry_diagnostics() -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    serde_json::to_value(
        crate::modules::admin::commands::build_local_capability_registry_diagnostics(&app_state)
            .await?,
    )
    .map_err(|err| err.to_string())
}

async fn dispatch_monitor_create(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let payload: LocalMonitorTaskCreateRequest =
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?;
    let result = app_state.monitor.create_task(payload).await?;
    serde_json::to_value(result).map_err(|err| err.to_string())
}

async fn dispatch_monitor_list(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let payload = if arguments.is_null() || arguments.as_object().is_some_and(|o| o.is_empty()) {
        LocalMonitorListQuery {
            skip: None,
            limit: None,
            status: None,
        }
    } else {
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?
    };
    let result = app_state.monitor.list_tasks(payload).await?;
    serde_json::to_value(result).map_err(|err| err.to_string())
}

async fn dispatch_provider_preset_list() -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let presets = app_state
        .providers
        .store
        .list_presets()
        .await
        .map_err(|err| err.to_string())?;
    serde_json::to_value(presets).map_err(|err| err.to_string())
}

async fn dispatch_provider_preset_upsert(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let preset = parse_provider_preset(arguments)?;
    let mut presets = app_state
        .providers
        .store
        .list_presets()
        .await
        .map_err(|err| err.to_string())?;
    let mut updated = false;
    if let Some(existing) = presets.iter_mut().find(|item| item.slug == preset.slug) {
        *existing = preset.clone();
        updated = true;
    } else {
        presets.push(preset.clone());
    }
    app_state
        .providers
        .store
        .replace_presets(presets)
        .await
        .map_err(|err| err.to_string())?;
    Ok(json!({
        "status": "ok",
        "updated": updated,
        "preset": preset,
    }))
}

async fn dispatch_provider_verify(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let payload: ProviderVerifyRequest =
        serde_json::from_value(arguments.clone()).map_err(|err| err.to_string())?;
    let result =
        crate::modules::providers::commands::verify_local_provider_impl(&app_state, payload)
            .await?;
    serde_json::to_value(result).map_err(|err| err.to_string())
}

fn provider_template_verify_capability(arguments: &Value) -> String {
    arguments
        .get("capability")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("chat")
        .to_ascii_lowercase()
}

fn provider_template_verify_protocol_family(arguments: &Value, capability: &str) -> String {
    let requested = arguments
        .get("protocol_family")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_ascii_lowercase);
    if let Some(family) = requested {
        return family;
    }

    let upstream_path = arguments
        .get("upstream_path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| default_provider_template_upstream_path("openai_chat", capability));
    crate::modules::providers::protocols::infer_protocol_family("openai", upstream_path).to_string()
}

fn provider_protocol_from_family(protocol_family: &str) -> &'static str {
    match protocol_family {
        "openai_responses" => "responses",
        "anthropic_messages" => "anthropic",
        "google_gemini" => "google",
        _ => "openai",
    }
}

fn provider_name_from_family(protocol_family: &str) -> &'static str {
    match protocol_family {
        "anthropic_messages" => "anthropic",
        "google_gemini" => "google",
        _ => "openai",
    }
}

fn provider_template_engine(protocol_family: &str) -> &'static str {
    match protocol_family {
        "anthropic_messages" => "anthropic_messages",
        "google_gemini" => "google_gemini",
        _ => "openai_compat",
    }
}

fn provider_response_decoder(protocol_family: &str) -> &'static str {
    match protocol_family {
        "openai_responses" => "openai_responses",
        "anthropic_messages" => "anthropic_messages",
        _ => "openai_chat",
    }
}

fn provider_stream_decoder(protocol_family: &str) -> &'static str {
    match protocol_family {
        "openai_responses" => "openai_responses_events",
        "anthropic_messages" => "anthropic_messages_events",
        _ => "openai_chat_events",
    }
}

fn default_provider_template_upstream_path(
    protocol_family: &str,
    capability: &str,
) -> &'static str {
    match capability {
        "embedding" => "v1/embeddings",
        "image_generation" => "v1/images/generations",
        "video_generation" => "v1/videos/generations",
        "text_to_speech" => "v1/audio/speech",
        "speech_to_text" => "v1/audio/transcriptions",
        _ => match protocol_family {
            "openai_responses" => "v1/responses",
            "anthropic_messages" => "v1/messages",
            "google_gemini" => "v1beta/models/gemini-2.5-pro:generateContent",
            _ => "v1/chat/completions",
        },
    }
}

fn default_provider_template_test_payload(capability: &str, protocol_family: &str) -> Value {
    match capability {
        "embedding" => json!({
            "model": "text-embedding-3-small",
            "input": "ping"
        }),
        "image_generation" => json!({
            "model": "gpt-image-1",
            "prompt": "ping",
            "n": 1
        }),
        "video_generation" => json!({
            "model": "video-model",
            "prompt": "ping"
        }),
        "text_to_speech" => json!({
            "model": "gpt-4o-mini-tts",
            "input": "ping",
            "voice": "alloy"
        }),
        "speech_to_text" => json!({
            "model": "gpt-4o-mini-transcribe",
            "audio_data": "cGluZw==",
            "response_format": "json"
        }),
        _ => {
            let model = match protocol_family {
                "openai_responses" => "gpt-5.3-codex",
                "anthropic_messages" => "claude-3-7-sonnet-latest",
                "google_gemini" => "gemini-2.5-pro",
                _ => "gpt-4o-mini",
            };
            json!({
                "model": model,
                "messages": [{"role": "user", "content": "ping"}],
                "stream": false,
                "max_tokens": 16
            })
        }
    }
}

fn object_or_empty(arguments: &Value, key: &str) -> Value {
    arguments
        .get(key)
        .cloned()
        .filter(|value| value.is_object())
        .unwrap_or_else(|| json!({}))
}

fn value_is_empty_object(value: &Value) -> bool {
    value
        .as_object()
        .map(|object| object.is_empty())
        .unwrap_or(false)
}

fn normalize_runtime_hook(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    let name = object
        .get("name")
        .or_else(|| object.get("type"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let mut config = object.clone();
    config.remove("name");
    config.remove("type");
    Some(json!({
        "name": name,
        "config": Value::Object(config),
    }))
}

fn template_verify_error_message(
    value: &Value,
    status_code: u16,
    raw_text: &str,
) -> Option<String> {
    let message = value
        .get("error")
        .and_then(|entry| entry.get("message"))
        .and_then(Value::as_str)
        .or_else(|| value.get("message").and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    if message.is_some() {
        return message;
    }
    let text = raw_text.trim();
    if text.is_empty() {
        Some(format!("upstream status {status_code}"))
    } else {
        Some(text.to_string())
    }
}

async fn dispatch_provider_template_verify(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let capability = provider_template_verify_capability(arguments);
    let base_url = arguments
        .get("base_url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "provider.template.verify requires 'base_url'".to_string())?;
    let test_api_key = arguments
        .get("test_api_key")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "provider.template.verify requires 'test_api_key'".to_string())?;
    let request_template = arguments
        .get("request_template")
        .cloned()
        .ok_or_else(|| "provider.template.verify requires 'request_template'".to_string())?;

    let protocol_family = provider_template_verify_protocol_family(arguments, &capability);
    let upstream_path = arguments
        .get("upstream_path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            default_provider_template_upstream_path(&protocol_family, &capability).to_string()
        });
    let template_engine = arguments
        .get("template_engine")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| provider_template_engine(&protocol_family))
        .to_string();
    let test_payload = arguments
        .get("test_payload")
        .cloned()
        .unwrap_or_else(|| default_provider_template_test_payload(&capability, &protocol_family));
    let model_name = test_payload
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("template-probe-model")
        .to_string();

    let header_template = object_or_empty(arguments, "header_template");
    let default_headers = object_or_empty(arguments, "default_headers");
    let merged_headers = crate::modules::providers::request_runtime::deep_merge_json(
        &header_template,
        &default_headers,
    );
    let default_params = object_or_empty(arguments, "default_params");
    let query_template = object_or_empty(arguments, "query_template");
    let response_template = arguments
        .get("response_template")
        .cloned()
        .or_else(|| arguments.get("output_mapping").cloned())
        .unwrap_or_else(|| json!({}));
    let request_builder = arguments
        .get("request_builder")
        .and_then(normalize_runtime_hook);

    let mut warnings = Vec::new();
    if !crate::modules::providers::protocols::template_matches_family(
        &request_template,
        &capability,
        &protocol_family,
    ) {
        warnings.push(
            "request_template does not match the requested protocol_family/capability; the desktop runtime may fall back to its builtin template".to_string(),
        );
    }
    if !query_template.is_null() && !value_is_empty_object(&query_template) {
        warnings.push(
            "desktop provider template verification does not currently materialize query_template into the prepared request".to_string(),
        );
    }

    let now = Utc::now().to_rfc3339();
    let provider_name = provider_name_from_family(&protocol_family).to_string();
    let protocol = provider_protocol_from_family(&protocol_family).to_string();
    let preset_slug = format!("desktop-template-probe-{}", provider_name);
    let profile_id = format!("{provider_name}:{capability}:{protocol_family}");

    let protocol_profile = json!({
        "runtime_version": "v2",
        "schema_version": "2026-03-07",
        "profile_id": profile_id,
        "provider": provider_name,
        "protocol_family": protocol_family,
        "capability": capability,
        "transport": {
            "method": "POST",
            "path": upstream_path,
            "query_template": query_template,
            "header_template": merged_headers,
        },
        "request": {
            "template_engine": template_engine,
            "request_template": request_template,
            "request_builder": request_builder.clone(),
        },
        "response": {
            "decoder": {
                "name": provider_response_decoder(&protocol_family),
                "config": {}
            },
            "response_template": response_template,
        },
        "stream": {
            "stream_decoder": {
                "name": provider_stream_decoder(&protocol_family),
                "config": {}
            }
        },
        "auth": {
            "auth_policy": "inherit",
            "config": {}
        },
        "features": {
            "supports_messages": protocol_family != "openai_responses",
            "supports_input_items": protocol_family == "openai_responses"
        },
        "defaults": {
            "headers": merged_headers,
            "query": query_template,
            "body": default_params
        }
    });

    let mut protocol_profiles = Map::new();
    protocol_profiles.insert(capability.clone(), protocol_profile);

    let preset = ProviderPreset {
        slug: preset_slug.clone(),
        name: "Desktop Template Probe".to_string(),
        provider: provider_name.clone(),
        base_url: base_url.to_string(),
        icon: None,
        theme_color: None,
        category: Some("desktop-local".to_string()),
        url_template: None,
        auth_type: "api_key".to_string(),
        auth_config: json!({}),
        protocol_schema_version: Some("2026-03-07".to_string()),
        protocol_profiles: Value::Object(protocol_profiles),
        version: 1,
        is_active: true,
    };
    let instance_id = Uuid::new_v4();
    let instance = ProviderInstance {
        id: instance_id,
        preset_slug,
        name: "Desktop Template Probe".to_string(),
        base_url: base_url.to_string(),
        description: Some(
            "Temporary desktop-local provider template verification target".to_string(),
        ),
        icon: None,
        priority: 0,
        meta: json!({
            "protocol": protocol,
            "auto_append_v1": false,
        }),
        is_enabled: true,
        is_local: true,
        credential_source: "local".to_string(),
        credentials_ref: String::new(),
        updated_at: now.clone(),
        created_at: now,
    };
    let model = ProviderModel {
        id: Uuid::new_v4(),
        instance_id,
        model_id: model_name,
        unified_model_id: None,
        display_name: None,
        capabilities: vec![capability.clone()],
        upstream_path: upstream_path.clone(),
        pricing_config: json!({}),
        limit_config: json!({}),
        tokenizer_config: json!({}),
        routing_config: json!({
            "allow_template_override": true,
        }),
        config_override: json!({}),
        source: "manual".to_string(),
        extra_meta: json!({}),
        weight: 100,
        priority: 0,
        is_active: true,
        synced_at: None,
        created_at: None,
        updated_at: None,
    };

    let prepared = if capability == "chat" {
        let canonical_request =
            build_canonical_request_from_value(&test_payload, &capability, &protocol_family);
        crate::modules::providers::request_runtime::prepare_provider_request_from_canonical_request(
            Some(&preset),
            &instance,
            &model,
            Some(test_api_key),
            &capability,
            test_payload.clone(),
            canonical_request,
            None,
            None,
        )?
    } else {
        crate::modules::providers::request_runtime::prepare_provider_request(
            Some(&preset),
            &instance,
            &model,
            Some(test_api_key),
            &capability,
            test_payload.clone(),
            None,
            None,
        )?
    };
    let started = Instant::now();
    let response = crate::modules::providers::request_runtime::send_prepared_json_request(
        &reqwest::Client::new(),
        &prepared,
    )
    .await?;
    let latency_ms = started.elapsed().as_millis() as i64;
    let status_code = response.status.as_u16();
    let parsed_body = response
        .json
        .clone()
        .unwrap_or_else(|| json!({ "raw_text": response.text.clone() }));
    let normalized_response = if response.status.is_success() {
        Some(app_state.providers.transformer.transform(
            prepared.template_engine.as_str(),
            Some(prepared.response_decoder.as_str()),
            &prepared.response_transform,
            parsed_body.clone(),
            status_code,
        ))
    } else {
        None
    };

    Ok(json!({
        "success": response.status.is_success(),
        "status_code": status_code,
        "latency_ms": latency_ms,
        "capability": capability,
        "protocol_family": protocol_family,
        "upstream_url": prepared.display_url(),
        "request": {
            "method": prepared.method,
            "url": prepared.display_url(),
            "headers": prepared.headers,
            "body": prepared.body,
        },
        "response_body": parsed_body,
        "normalized_response": normalized_response,
        "error": if response.status.is_success() {
            Value::Null
        } else {
            json!(template_verify_error_message(&parsed_body, status_code, response.text.as_str()))
        },
        "warnings": warnings,
    }))
}

async fn dispatch_web_fetch(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let tool = crate::modules::mcp::commands::runtime::resolve_callable_mcp_tool_by_name(
        app_state.mcp.store.as_ref(),
        "fetch_web_content",
    )
    .await
    .map_err(|err| err.to_string())?;
    crate::modules::mcp::commands::runtime::execute_mcp_tool(
        Some(&app_state.mcp),
        app_state.mcp.store.as_ref(),
        &tool,
        arguments,
    )
    .await
}

async fn dispatch_assistant_onboarding_submit(arguments: &Value) -> Result<Value, String> {
    let app_state = global_app_state_required()?;
    let asset_type = arguments
        .get("asset_type")
        .and_then(Value::as_str)
        .unwrap_or("");
    if asset_type != "assistant" {
        return Err(format!(
            "desktop capability 'assistant.onboarding.submit' does not support asset_type '{}'",
            asset_type
        ));
    }
    let payload = arguments
        .get("payload")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let create_req: CreateLocalAssistantRequest =
        serde_json::from_value(payload).map_err(|err| err.to_string())?;
    let id = app_state
        .mcp
        .store
        .create_local_assistant(create_req)
        .await
        .map_err(|err| err.to_string())?;
    Ok(json!({
        "action": "created",
        "id": id,
    }))
}

#[cfg(test)]
mod tests {
    use super::{desktop_user_can_access_restricted_asset, DesktopCurrentUserInfo};
    use std::collections::HashMap;

    #[test]
    fn provider_registry_is_visible_to_desktop_admin_permissions() {
        let mut permission_flags = HashMap::new();
        permission_flags.insert("can_manage_providers".to_string(), 1);
        let user = DesktopCurrentUserInfo {
            is_superuser: false,
            permission_flags,
        };

        assert!(desktop_user_can_access_restricted_asset(
            Some(&user),
            true,
            &[String::from("admin")],
            Some("official.skills.provider_registry"),
        ));
    }
}
